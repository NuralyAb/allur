import asyncio
import copy
from contextlib import asynccontextmanager
import json
import socket
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.scada import api, auth, registry
from app.scada.core import CommandError, Db, Scada
from app.scada.drivers import OpcUaDriver
from app.scada.packml import Command, Mode, State, allowed
from app.scada.plcsim import PlcSim, serve_opcua

OPERATOR = auth.User("operator", "Оператор", "operator")
ENGINEER = auth.User("engineer", "Инженер", "engineer")
VIEWER = auth.User("viewer", "Наблюдатель", "viewer")
RAW = json.loads(registry.DEFAULT_CONFIG.read_text(encoding="utf-8"))
PLANTS = []


def tearDownModule():
    for p in PLANTS:
        p.scada.db.close()


class Plant:
    """Симулятор и ядро SCADA с ручным шагом времени: без сети и без ожидания."""

    def __init__(self):
        self.reg = registry.parse(copy.deepcopy(RAW))
        self.sim = PlcSim(self.reg, seed=1)
        self.scada = Scada(self.reg, Db(":memory:"), mode="sim", sim=self.sim)
        PLANTS.append(self)
        self.scada.build_drivers()
        self.driver = self.scada.drivers["line"]
        self.driver.on_status("line", True, "test")
        self.advance(1)

    def advance(self, seconds: float):
        for _ in range(int(seconds / 0.25)):
            self.sim.scan(0.25)
            self.driver.poll()
            self.scada.evaluate()

    def state(self, cid: str) -> State:
        return State(self.sim.plcs[cid].state)

    async def run(self, user, cid, kind, name, value=None):
        cmd = await self.scada.request(user, cid, kind, name, value)
        if cmd.status == "armed":
            await self.scada.confirm(user, cmd.id, "тест")
        self.advance(2)
        return self.scada.commands[cmd.id]


class PackmlTests(unittest.TestCase):
    def test_state_machine(self):
        self.assertTrue(allowed(State.IDLE, Command.START))
        self.assertFalse(allowed(State.STOPPED, Command.START))
        self.assertTrue(allowed(State.EXECUTE, Command.STOP))
        self.assertFalse(allowed(State.ABORTED, Command.STOP))
        self.assertTrue(allowed(State.ABORTED, Command.CLEAR))
        self.assertFalse(allowed(State.ABORTED, Command.ABORT))


class RegistryTests(unittest.TestCase):
    def test_config_loads(self):
        reg = registry.load()
        self.assertIn("conveyor-03", reg.controllers)
        self.assertEqual(reg.controllers["conveyor-03"].equipment, "Конвейер-03")

    def test_invalid_config_is_rejected_at_start(self):
        raw = copy.deepcopy(RAW)
        raw["controllers"][0]["params"][0]["alarms"] = {"dev": 1}  # отклонение без уставки
        raw["controllers"][1]["connection"] = "nowhere"
        with self.assertRaises(ValueError) as e:
            registry.parse(raw)
        self.assertIn("отклонения без уставки", str(e.exception))
        self.assertIn("неизвестное подключение", str(e.exception))


class SimulatorTests(unittest.TestCase):
    def test_fault_cascades_and_line_recovers(self):
        p = Plant()
        p.sim.inject_fault("conveyor-03", 301)
        p.advance(300)
        self.assertEqual(p.state("conveyor-03"), State.ABORTED)
        self.assertEqual(p.state("booth-02"), State.SUSPENDED)  # PBS заполнен
        self.assertEqual(p.state("brake-01"), State.SUSPENDED)  # ОТК без подачи
        for cmd in (Command.CLEAR, Command.RESET, Command.START):
            p.sim.write("conveyor-03", "Command.CntrlCmd", int(cmd))
            p.sim.write("conveyor-03", "Command.CmdChangeRequest", True)
            p.advance(3)
        p.advance(120)
        for cid in ("abb-01", "ed-10", "oven-01", "booth-02", "conveyor-03", "brake-01"):
            self.assertEqual(p.state(cid), State.EXECUTE, cid)

    def test_plc_rejects_command_in_local_mode(self):
        p = Plant()  # abb-02: ключ «Местный»
        p.sim.write("abb-02", "Command.CntrlCmd", int(Command.STOP))
        p.sim.write("abb-02", "Command.CmdChangeRequest", True)
        p.advance(3)
        self.assertEqual(p.state("abb-02"), State.STOPPED)  # стоп разрешён всегда
        p.sim.write("abb-02", "Command.CntrlCmd", int(Command.RESET))
        p.sim.write("abb-02", "Command.CmdChangeRequest", True)
        p.advance(3)
        self.assertEqual(p.state("abb-02"), State.STOPPED)  # сброс — только с местного пульта

    def test_plc_clamps_setpoint(self):
        p = Plant()
        p.sim.write("oven-01", "Command.Parameter.Temp", 900)
        p.advance(1)
        self.assertEqual(p.sim.read("oven-01", "Status.Setpoint.Temp"), 200)

    def test_wear_resets_after_clear_of_its_fault(self):
        p = Plant()
        p.sim.plcs["booth-02"].true["FilterDp"] = 290
        p.advance(2)
        self.assertEqual(p.state("booth-02"), State.ABORTED)
        self.assertEqual(p.sim.read("booth-02", "Admin.StopReason"), 201)
        p.sim.write("booth-02", "Command.CntrlCmd", int(Command.CLEAR))
        p.sim.write("booth-02", "Command.CmdChangeRequest", True)
        p.advance(3)
        self.assertLess(p.sim.read("booth-02", "Status.Parameter.FilterDp"), 130)


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_needs_confirmation_and_plc_feedback(self):
        p = Plant()
        cmd = await p.scada.request(ENGINEER, "abb-04", "mode", "PRODUCTION")
        self.assertEqual(cmd.status, "armed")
        with self.assertRaises(CommandError) as e:
            await p.scada.confirm(ENGINEER, cmd.id)
        self.assertIn("причину", e.exception.reason)
        await p.scada.confirm(ENGINEER, cmd.id, "ТО завершено, акт 42")
        p.advance(1)
        self.assertEqual(cmd.status, "done")
        self.assertEqual((await p.run(OPERATOR, "abb-04", "packml", "RESET")).status, "done")
        cmd = await p.scada.request(OPERATOR, "abb-04", "packml", "START")
        self.assertEqual(cmd.status, "armed")
        self.assertEqual(p.state("abb-04"), State.IDLE)  # без подтверждения ничего не произошло
        await p.scada.confirm(OPERATOR, cmd.id)
        p.advance(2)
        self.assertEqual(cmd.status, "done")
        self.assertEqual(p.state("abb-04"), State.EXECUTE)

    async def test_stop_is_immediate(self):
        p = Plant()
        cmd = await p.scada.request(OPERATOR, "conveyor-03", "packml", "STOP")
        self.assertEqual(cmd.status, "sent")
        p.advance(2)
        self.assertEqual(p.state("conveyor-03"), State.STOPPED)

    async def test_roles(self):
        p = Plant()
        with self.assertRaises(CommandError) as e:
            await p.scada.request(VIEWER, "conveyor-03", "packml", "STOP")
        self.assertIn("Оператор", e.exception.reason)
        with self.assertRaises(CommandError):
            await p.scada.request(OPERATOR, "booth-02", "setpoint", "Temp", 24)
        cmd = await p.scada.request(OPERATOR, "conveyor-03", "packml", "HOLD")
        p.advance(2)
        with self.assertRaises(CommandError) as e:
            await p.scada.confirm(ENGINEER, (await p.scada.request(OPERATOR, "conveyor-03", "packml", "UNHOLD")).id)
        self.assertEqual(e.exception.status, 403)
        self.assertEqual(cmd.status, "done")

    async def test_armed_command_expires_and_checks_state_again(self):
        p = Plant()
        await p.run(OPERATOR, "conveyor-03", "packml", "HOLD")
        cmd = await p.scada.request(OPERATOR, "conveyor-03", "packml", "UNHOLD")
        with patch("app.scada.core.time.time", return_value=cmd.expires + 1):
            with self.assertRaises(CommandError):
                await p.scada.confirm(OPERATOR, cmd.id)
        self.assertEqual(cmd.status, "expired")
        cmd = await p.scada.request(OPERATOR, "conveyor-03", "packml", "UNHOLD")
        p.sim.inject_fault("conveyor-03", 302)  # пока оператор думал, конвейер ушёл в аварию
        p.advance(3)
        with self.assertRaises(CommandError) as e:
            await p.scada.confirm(OPERATOR, cmd.id)
        self.assertIn("изменилось", e.exception.reason)
        self.assertEqual(p.state("conveyor-03"), State.ABORTED)

    async def test_interlocks(self):
        p = Plant()
        with self.assertRaises(CommandError) as e:
            await p.scada.request(OPERATOR, "abb-02", "packml", "RESET")
        self.assertIn("Местный", e.exception.reason)
        p.sim.set_safety("abb-01", False)
        p.advance(3)
        self.assertEqual(p.state("abb-01"), State.ABORTED)
        with self.assertRaises(CommandError) as e:
            await p.scada.request(OPERATOR, "abb-01", "packml", "CLEAR")
        self.assertIn("цепь безопасности", e.exception.reason)
        p.sim.write("abb-01", "Command.CntrlCmd", int(Command.CLEAR))  # в обход SCADA — ПЛК тоже не пустит
        p.sim.write("abb-01", "Command.CmdChangeRequest", True)
        p.advance(3)
        self.assertEqual(p.state("abb-01"), State.ABORTED)
        p.sim.set_safety("abb-01", True)
        p.advance(1)
        self.assertEqual((await p.run(OPERATOR, "abb-01", "packml", "CLEAR")).status, "done")

    async def test_oven_start_permissive(self):
        p = Plant()
        await p.run(OPERATOR, "oven-01", "packml", "STOP")
        p.advance(400)  # печь остыла
        await p.run(OPERATOR, "oven-01", "packml", "RESET")
        p.advance(2)
        self.assertIn("Печь не прогрета", p.scada.check(p.reg.controllers["oven-01"], "packml", "START"))
        p.advance(400)  # горелки работают в «Готов»
        self.assertIsNone(p.scada.check(p.reg.controllers["oven-01"], "packml", "START"))

    async def test_setpoint_limits_and_feedback(self):
        p = Plant()
        for value, text in ((26, "не более ±2"), (40, "Допустимо 19…27")):
            with self.assertRaises(CommandError) as e:
                await p.scada.request(ENGINEER, "booth-02", "setpoint", "Temp", value)
            self.assertIn(text, e.exception.reason)
        cmd = await p.run(ENGINEER, "booth-02", "setpoint", "Temp", 24.5)
        self.assertEqual(cmd.status, "done")
        self.assertEqual(p.sim.read("booth-02", "Status.Setpoint.Temp"), 24.5)

    async def test_read_only_mode(self):
        p = Plant()
        p.reg.write_enabled = False
        with self.assertRaises(CommandError) as e:
            await p.scada.request(OPERATOR, "conveyor-03", "packml", "STOP")
        self.assertIn("только чтения", e.exception.reason)


class AlarmTests(unittest.IsolatedAsyncioTestCase):
    async def test_alarm_lifecycle(self):
        p = Plant()
        p.sim.inject_fault("conveyor-03", 301)
        p.advance(2)
        a = p.scada.alarms["conveyor-03:fault"]
        self.assertEqual((a.active, a.acked, a.priority), (True, False, 1))
        self.assertIn("Обрыв цепи", a.message)
        p.scada.ack(OPERATOR, "conveyor-03:fault")
        self.assertTrue(a.acked)
        for name in ("CLEAR", "RESET"):
            await p.run(OPERATOR, "conveyor-03", "packml", name)
        self.assertNotIn("conveyor-03:fault", p.scada.alarms)  # квитирована и ушла в норму

    async def test_unacked_alarm_stays_after_return_to_normal(self):
        p = Plant()
        p.sim.inject_fault("brake-01", 501)
        p.advance(2)
        for name in ("CLEAR", "RESET"):
            await p.run(OPERATOR, "brake-01", "packml", name)
        a = p.scada.alarms["brake-01:fault"]
        self.assertFalse(a.active)
        p.scada.ack(OPERATOR, a.id)
        self.assertNotIn(a.id, p.scada.alarms)

    def test_drift_raises_warning_before_trip(self):
        p = Plant()
        p.sim.plcs["booth-02"].true["FilterDp"] = 235
        p.advance(2)
        self.assertEqual(p.scada.alarms["booth-02:FilterDp.hi"].priority, 2)
        self.assertEqual(p.state("booth-02"), State.EXECUTE)

    def test_process_alarms_suppressed_when_stopped(self):
        p = Plant()  # ABB-04 в обслуживании: ток сварки 0, но тревоги «низкий ток» нет
        self.assertFalse([a for a in p.scada.alarms if a.startswith("abb-04:")])

    async def test_communication_loss(self):
        p = Plant()
        p.driver.on_status("line", False, "ConnectionRefusedError")
        p.scada.evaluate()
        self.assertIn("conveyor-03:comm", p.scada.alarms)
        with self.assertRaises(CommandError) as e:
            await p.scada.request(OPERATOR, "conveyor-03", "packml", "STOP")
        self.assertIn("Нет связи", e.exception.reason)

    def test_shelve_requires_reason_and_engineer(self):
        p = Plant()
        p.sim.inject_fault("brake-01", 501)
        p.advance(1)
        with self.assertRaises(auth.Forbidden):
            p.scada.shelve(OPERATOR, "brake-01:fault", 30, "ремонт")
        with self.assertRaises(CommandError):
            p.scada.shelve(ENGINEER, "brake-01:fault", 30, " ")
        p.scada.shelve(ENGINEER, "brake-01:fault", 30, "датчик в ремонте, заявка 118")
        self.assertIsNotNone(p.scada.alarms["brake-01:fault"].shelvedUntil)


class AuditTests(unittest.IsolatedAsyncioTestCase):
    async def test_audit_chain_detects_tampering(self):
        p = Plant()
        await p.run(OPERATOR, "conveyor-03", "packml", "STOP")
        self.assertTrue(p.scada.db.verify()["ok"])
        actions = [r["action"] for r in p.scada.db.audit_rows()]
        self.assertIn("Стоп", actions)
        with p.scada.db.lock, p.scada.db.db:
            p.scada.db.db.execute("UPDATE audit SET user = 'кто-то' WHERE action = 'Стоп'")
        self.assertFalse(p.scada.db.verify()["ok"])

    async def test_downtime_event_recorded(self):
        p = Plant()
        p.sim.inject_fault("conveyor-03", 301)
        p.advance(5)
        events = [e for e in p.scada.db.events() if e["controller"] == "conveyor-03"]
        self.assertEqual(events[0]["reason"], "Обрыв цепи")


class AuthTests(unittest.TestCase):
    def test_login_and_lockout(self):
        a = auth.Auth()
        token, user = a.login("operator", "operator")
        self.assertEqual(a.user(token).role, "operator")
        self.assertIs(a.user("wrong"), auth.GUEST)
        for _ in range(auth.MAX_FAILS):
            with self.assertRaises(auth.Forbidden):
                a.login("engineer", "bad")
        with self.assertRaises(auth.Forbidden) as e:
            a.login("engineer", "engineer")
        self.assertIn("попыток", str(e.exception))
        with patch("app.scada.auth.time.time", return_value=__import__("time").time() + auth.LOCK_SECONDS + 1):
            for _ in range(auth.MAX_FAILS):  # после окна блокировки счёт идёт заново и снова блокирует
                with self.assertRaises(auth.Forbidden):
                    a.login("engineer", "bad")
            with self.assertRaises(auth.Forbidden) as e:
                a.login("engineer", "engineer")
            self.assertIn("попыток", str(e.exception))

    def test_malformed_commands_are_422(self):
        async def run():
            p = Plant()
            for kind, name, value in (("mode", "TURBO", None), ("setpoint", "Temp", None), ("setpoint", "FilterDp", 1)):
                with self.assertRaises(CommandError) as e:
                    await p.scada.request(ENGINEER, "booth-02", kind, name, value)
                self.assertEqual(e.exception.status, 422)
        asyncio.run(run())


class ApiTests(unittest.TestCase):
    def test_http_flow(self):
        @asynccontextmanager
        async def lifespan(_):
            await api.start("sim", db_path=":memory:")
            yield
            await api.stop()

        app = FastAPI(lifespan=lifespan)
        app.include_router(api.router)
        with TestClient(app) as client:
            self.assertEqual(len(client.get("/api/scada/config").json()["controllers"]), 12)
            body = {"controller": "conveyor-03", "kind": "packml", "name": "STOP"}
            self.assertEqual(client.post("/api/scada/commands", json=body).status_code, 401)
            token = client.post("/api/scada/login", json={"login": "operator", "password": "operator"}).json()["token"]
            headers = {"Authorization": f"Bearer {token}"}
            self.assertEqual(client.post("/api/scada/commands", json=body, headers=headers).json()["status"], "sent")
            r = client.post("/api/scada/commands", json={**body, "controller": "booth-02", "kind": "setpoint", "name": "Temp", "value": 24}, headers=headers)
            self.assertEqual(r.status_code, 409)
            self.assertIn("Инженер", r.json()["detail"])
            client.post("/api/scada/sim/conveyor-03", json={"action": "fault", "code": 301})
            api.rt.sim.scan(2)
            api.rt.scada.drivers["line"].poll()
            api.rt.scada.evaluate()
            alarms = client.get("/api/scada/alarms").json()
            self.assertEqual(alarms[0]["title"], "Конвейер-03: обрыв цепи")
            self.assertEqual(alarms[0]["area"], "Сборка")
            with client.websocket_connect("/api/scada/stream") as ws:
                self.assertIn("conveyor-03", ws.receive_json()["controllers"])
            self.assertTrue(client.get("/api/scada/audit/verify").json()["ok"])


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OpcUaTests(unittest.IsolatedAsyncioTestCase):
    async def test_driver_talks_to_plc_over_opcua(self):
        reg = registry.parse(copy.deepcopy(RAW))
        sim = PlcSim(reg, seed=2)
        endpoint = f"opc.tcp://127.0.0.1:{free_port()}/allur/plcsim"
        ready = asyncio.Event()
        server = asyncio.create_task(serve_opcua(sim, endpoint, "urn:allur:plcsim", ready))
        await asyncio.wait_for(ready.wait(), 15)
        conn = reg.connections["line"]
        conn.endpoint = endpoint
        values, status = {}, {}
        driver = OpcUaDriver(conn, [reg.controllers["conveyor-03"]], values.update, lambda c, ok, t: status.update(ok=ok, text=t))
        driver.start()
        try:
            for _ in range(60):
                if values.get("conveyor-03/Status.StateCurrent", (None,))[0] == State.EXECUTE:
                    break
                await asyncio.sleep(0.1)
            self.assertTrue(status["ok"], status)
            await driver.write("conveyor-03", "Command.CntrlCmd", int(Command.STOP))
            await driver.write("conveyor-03", "Command.CmdChangeRequest", True)
            for _ in range(60):
                if values["conveyor-03/Status.StateCurrent"][0] == State.STOPPED:
                    break
                await asyncio.sleep(0.1)
            self.assertEqual(values["conveyor-03/Status.StateCurrent"][0], State.STOPPED)
            self.assertEqual(values["conveyor-03/Status.UnitModeCurrent"][0], Mode.PRODUCTION)
        finally:
            await driver.stop()
            server.cancel()
            try:
                await server
            except (asyncio.CancelledError, Exception):
                pass


if __name__ == "__main__":
    unittest.main()
