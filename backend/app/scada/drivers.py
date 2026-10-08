"""Драйверы связи с контроллерами. Ядро SCADA видит только интерфейс Driver: подписка на теги и запись.

OpcUaDriver — основной промышленный путь (IEC 62541): ПЛК с собственным OPC UA-сервером (S7-1500, ABB OmniCore,
Beckhoff и др.) или шлюз (Kepware, Ignition, SIMATIC) для старых ПЛК и протоколов Modbus, S7, EtherNet/IP.
SimDriver подключается к симулятору в памяти процесса — для тестов и запуска без сети.
Ключ тега в ядре: "<id контроллера>/<суффикс PackTags>", например "conveyor-03/Status.StateCurrent".
"""
import asyncio
import logging
import os
import time
from collections.abc import Callable

from .registry import Connection, Controller

log = logging.getLogger("scada.driver")
OnValues = Callable[[dict[str, tuple[object, str, float]]], None]  # ключ -> (значение, качество, время)
OnStatus = Callable[[str, bool, str], None]  # id подключения, есть связь, текст


def key(cid: str, suffix: str) -> str:
    return f"{cid}/{suffix}"


class Driver:
    def __init__(self, conn: Connection, controllers: list[Controller], on_values: OnValues, on_status: OnStatus):
        self.conn, self.controllers, self.on_values, self.on_status = conn, controllers, on_values, on_status
        self.by_id = {c.id: c for c in controllers}
        self.task: asyncio.Task | None = None

    def start(self):
        self.task = asyncio.get_running_loop().create_task(self.run())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
            self.task = None

    async def run(self):
        raise NotImplementedError

    async def write(self, cid: str, suffix: str, value) -> None:
        raise NotImplementedError


class SimDriver(Driver):
    """Чтение памяти симулятора с периодом публикации подключения — как подписка OPC UA."""

    def __init__(self, conn, controllers, on_values, on_status, sim, scan: bool = True):
        super().__init__(conn, controllers, on_values, on_status)
        self.sim, self.scan = sim, scan  # scan — драйвер сам крутит цикл ПЛК (нет отдельного OPC UA-сервера)
        self.last: dict[str, object] = {}

    def poll(self):
        changed, now = {}, time.time()
        for c in self.controllers:
            for suffix in c.read_tags():
                v = self.sim.read(c.id, suffix)
                k = key(c.id, suffix)
                if self.last.get(k, ...) != v:
                    self.last[k] = v
                    changed[k] = (v, "good", now)
        if changed:
            self.on_values(changed)

    async def run(self):
        self.on_status(self.conn.id, True, "Симулятор ПЛК в памяти процесса")
        period = self.conn.publishingMs / 1000
        loop = asyncio.get_running_loop()
        last = loop.time()
        while True:
            if self.scan:
                now = loop.time()
                self.sim.scan(min(1.0, now - last))
                last = now
            self.poll()
            await asyncio.sleep(period)

    async def write(self, cid, suffix, value):
        self.sim.write(cid, suffix, value)


class OpcUaDriver(Driver):
    """OPC UA-клиент: подписка на изменения, переподключение с нарастающей паузой, запись с типом узла ПЛК."""

    def __init__(self, conn, controllers, on_values, on_status):
        super().__init__(conn, controllers, on_values, on_status)
        self.client = None
        self.nodes: dict[str, object] = {}
        self.vtypes: dict[str, object] = {}

    def node_id(self, c: Controller, suffix: str, ns: int):
        from asyncua import ua
        mapped = c.map.get(suffix)  # сопоставление с адресом реального ПЛК, например ns=3;s="DB_PackML"."State"
        return ua.NodeId.from_string(mapped) if mapped else ua.NodeId(f"{c.path}.{suffix}", ns)

    async def run(self):
        from asyncua import Client, ua

        for name in ("asyncua", "asyncua.client.ua_client", "asyncua.client.client", "asyncua.common.subscription"):
            logging.getLogger(name).setLevel(logging.ERROR)
        driver = self

        class Handler:
            def __init__(self, keys):
                self.keys = keys

            def datachange_notification(self, node, val, data):
                dv = data.monitored_item.Value
                quality = "good" if dv.StatusCode is None or dv.StatusCode.is_good() else "bad"
                ts = dv.SourceTimestamp or dv.ServerTimestamp
                driver.on_values({self.keys[node.nodeid]: (val, quality, ts.timestamp() if ts else time.time())})

            def status_change_notification(self, status):
                driver.on_status(driver.conn.id, False, f"Подписка: {status}")

        backoff = 1
        while True:
            client = Client(self.conn.endpoint, timeout=4)
            try:
                if self.conn.security:
                    await client.set_security_string(self.conn.security)
                if self.conn.user:
                    client.set_user(self.conn.user)
                    client.set_password(os.environ.get(self.conn.passwordEnv or "", ""))
                async with client:
                    ns = await client.get_namespace_index(self.conn.namespace) if self.conn.namespace else 0
                    nodes, keys = {}, {}
                    for c in self.controllers:
                        for suffix in c.read_tags() + c.write_tags():
                            node = client.get_node(self.node_id(c, suffix, ns))
                            nodes[key(c.id, suffix)] = node
                            if suffix in c.write_tags():
                                continue
                            keys[node.nodeid] = key(c.id, suffix)
                    sub = await client.create_subscription(self.conn.publishingMs, Handler(keys))
                    read_nodes = [nodes[k] for k in keys.values()]
                    results = await sub.subscribe_data_change(read_nodes)
                    missing = {keys[n.nodeid]: (None, "bad", time.time()) for n, r in zip(read_nodes, results)
                               if isinstance(r, ua.StatusCode) or not isinstance(r, int)}
                    if missing:
                        self.on_values(missing)
                        log.warning("%s: нет узлов в ПЛК: %s", self.conn.id, ", ".join(list(missing)[:10]))
                    self.client, self.nodes = client, nodes
                    self.on_status(self.conn.id, True, f"OPC UA · {self.conn.endpoint}"
                                   + (f" · нет {len(missing)} узлов" if missing else ""))
                    backoff = 1
                    while True:
                        await asyncio.sleep(2)
                        await client.check_connection()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # обрыв связи, ПЛК недоступен, отказ авторизации
                self.on_status(self.conn.id, False, f"{type(e).__name__}: {e}"[:200] or "нет связи")
            finally:
                self.client = None
                self.nodes = {}
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 15)

    async def write(self, cid, suffix, value):
        from asyncua import ua

        if self.client is None:
            raise ConnectionError("Нет связи с OPC UA-сервером")
        k = key(cid, suffix)
        node = self.nodes[k]
        if k not in self.vtypes:  # тип узла берём у ПЛК: Int16/Int32, Float/Double различаются у производителей
            self.vtypes[k] = await node.read_data_type_as_variant_type()
        vt = self.vtypes[k]
        if vt == ua.VariantType.Boolean:
            value = bool(value)
        elif vt in (ua.VariantType.Float, ua.VariantType.Double):
            value = float(value)
        else:
            value = int(value)
        await node.write_value(ua.DataValue(ua.Variant(value, vt)))
