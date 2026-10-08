import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.repositories import store
from app.services import accounts, importers, plant, settings

USERS_SRC = Path(__file__).resolve().parents[1] / "app" / "data" / "scada_users.json"


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.st = store.Store(":memory:")

    def test_defaults_and_partial_update(self):
        self.assertEqual(settings.current(self.st)["targets"]["oee"], 85.0)
        out = settings.update({"targets": {"oee": 90}, "calc": {"workDays": 22}}, self.st)
        self.assertEqual((out["targets"]["oee"], out["targets"]["defect"], out["calc"]["workDays"]), (90.0, 2.0, 22))
        self.assertEqual(settings.reset("calc", self.st)["calc"]["workDays"], 21)
        self.assertEqual(settings.current(self.st)["targets"]["oee"], 90.0)

    def test_validation(self):
        for patch in ({"targets": {"oee": 150}}, {"calc": {"workDays": 0}}, {"scene": {"mood": "night"}},
                      {"scene": {"labels": "yes"}}, {"other": {"x": 1}}, {"targets": {"unknown": 1}}, {"targets": {"shifts": "2"}}):
            with self.assertRaises(settings.Invalid, msg=patch):
                settings.update(patch, self.st)
        self.assertEqual(settings.current(self.st), settings.DEFAULTS)

    def test_settings_bump_store_version(self):
        before = self.st.version
        settings.update({"scene": {"labels": True}}, self.st)
        self.assertEqual(self.st.version, before + 1)


class PlantOverrideTests(unittest.TestCase):
    def setUp(self):
        self.st = store.Store(":memory:")
        self.hall = plant.hall_frame()
        self.zones = {z["id"] for z in plant.ZONES}
        self.outdoor = {z["id"] for z in plant.OUTDOOR}
        self._default = store._default
        store._default = self.st

    def tearDown(self):
        store._default = self._default

    def test_zone_fields_merge_and_reset(self):
        settings.update_plant({"zones": {"welding": {"name": "Сварка кузовов", "color": "#FF0000", "rect": [60, 150, 5, 80]}}, "name": "Завод"},
                              self.hall, self.zones, self.outdoor, self.st)
        merged = plant.plant()
        welding = next(z for z in merged["zones"] if z["id"] == "welding")
        self.assertEqual((welding["name"], welding["color"], welding["rect"]), ("Сварка кузовов", "#ff0000", [60.0, 150.0, 5.0, 80.0]))
        self.assertEqual(welding["basis"], "ndv")  # нередактируемые поля сохраняются
        self.assertEqual(merged["name"], "Завод")
        self.assertTrue(merged["customized"])
        self.assertEqual(plant.original()["name"], "Автомобильный завод Allur")
        settings.update_plant({"zones": {"welding": {"name": ""}}}, self.hall, self.zones, self.outdoor, self.st)
        self.assertEqual(next(z for z in plant.plant()["zones"] if z["id"] == "welding")["name"], "Цех сварки кузовов (ЦСК)")
        settings.reset_plant(self.st)
        self.assertFalse(plant.plant()["customized"])

    def test_rejects_bad_values(self):
        for patch in ({"zones": {"nope": {"name": "x"}}}, {"zones": {"welding": {"basis": "logic"}}},
                      {"zones": {"welding": {"rect": [10, 5, 0, 10]}}}, {"zones": {"welding": {"rect": [0, 9999, 0, 10]}}},
                      {"zones": {"welding": {"color": "red"}}}, {"zones": {"welding": {"kpiArea": "ОТК"}}},
                      {"outdoor": {"finished": {"size": [0, 10]}}}, {"facts": [{"label": "", "value": "x"}]}):
            with self.assertRaises(settings.Invalid, msg=patch):
                settings.update_plant(patch, self.hall, self.zones, self.outdoor, self.st)
        self.assertEqual(settings.plant_overrides(self.st), {})


class AccountsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.users = self.tmp / "users.json"
        shutil.copy(USERS_SRC, self.users)
        accounts.configure(self.users)

    def tearDown(self):
        accounts.configure(USERS_SRC)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_create_block_reset_delete(self):
        created = accounts.create_user("Master.1", "Мастер", "operator", "secret1")
        self.assertEqual((created["login"], created["role"], created["blocked"]), ("master.1", "operator", False))
        token, _ = accounts.service().login("master.1", "secret1")
        self.assertEqual(accounts.service().user(token).login, "master.1")
        accounts.update_user("master.1", actor="admin", blocked=True)
        self.assertIs(accounts.service().user(token), accounts.auth.GUEST)  # сессии отозваны
        with self.assertRaises(accounts.auth.Forbidden):
            accounts.service().login("master.1", "secret1")
        accounts.update_user("master.1", actor="admin", blocked=False, role="engineer")
        accounts.reset_password("master.1", "newpass1")
        self.assertEqual(accounts.service().login("master.1", "newpass1")[1].role, "engineer")
        accounts.delete_user("master.1", actor="admin")
        self.assertNotIn("master.1", [u["login"] for u in accounts.list_users()])
        self.assertNotIn("hash", json.dumps(accounts.list_users()))

    def test_guards(self):
        with self.assertRaises(accounts.AccountError):
            accounts.create_user("operator", "Дубль", "operator", "secret1")
        with self.assertRaises(accounts.AccountError):
            accounts.create_user("x", "Короткий пароль", "viewer", "123")
        with self.assertRaises(accounts.AccountError):
            accounts.update_user("admin", actor="admin", blocked=True)  # сам себя
        with self.assertRaises(accounts.AccountError):
            accounts.update_user("admin", actor="root", role="viewer")  # последний администратор
        with self.assertRaises(accounts.AccountError):
            accounts.delete_user("admin", actor="root")


class AdminApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copy(USERS_SRC, self.tmp / "users.json")
        accounts.configure(self.tmp / "users.json")
        self._default = store._default
        store._default = store.Store(":memory:")
        store._default.write(importers.case_dataset(), "test", mode="replace")
        self._mode = os.environ.get("SCADA_MODE")
        os.environ["SCADA_MODE"] = "off"

    def tearDown(self):
        store._default = self._default
        accounts.configure(USERS_SRC)
        if self._mode is None:
            os.environ.pop("SCADA_MODE", None)
        else:
            os.environ["SCADA_MODE"] = self._mode
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_admin_flow(self):
        from app.main import app
        with TestClient(app) as c:
            overview = c.get("/api/admin/overview").json()
            self.assertEqual(overview["insights"]["base"]["bottleneck"], "Окраска")
            self.assertEqual(overview["downtime"]["total"], 150)
            self.assertEqual(c.post("/api/data/reset").status_code, 401)
            self.assertEqual(c.post("/api/live/start").status_code, 401)
            self.assertEqual(c.post("/api/admin/login", json={"login": "operator", "password": "operator"}).status_code, 403)
            token = c.post("/api/admin/login", json={"login": "admin", "password": "admin"}).json()["token"]
            h = {"Authorization": f"Bearer {token}"}
            self.assertTrue(c.get("/api/admin/me", headers=h).json()["admin"])
            # настройки меняют цели в KPI и допущения в решениях
            r = c.put("/api/admin/settings", json={"targets": {"oee": 90, "monthly_output": 5000}, "calc": {"workDays": 22}}, headers=h)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(c.get("/api/kpi").json()["targets"]["oee"], 90.0)
            self.assertEqual(c.get("/api/insights").json()["base"]["days"], 22)
            self.assertEqual(c.put("/api/admin/settings", json={"targets": {"oee": 500}}, headers=h).status_code, 422)
            self.assertEqual(c.put("/api/admin/settings", json={"targets": {"oee": 70}}).status_code, 401)
            # паспорт завода
            r = c.put("/api/admin/plant", json={"zones": {"paint": {"name": "Окраска кузовов", "kpiArea": "Окраска"}}}, headers=h)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(next(z for z in c.get("/api/plant").json()["zones"] if z["id"] == "paint")["name"], "Окраска кузовов")
            self.assertEqual(c.put("/api/admin/plant", json={"zones": {"paint": {"rect": [1, 0, 0, 1]}}}, headers=h).status_code, 422)
            c.delete("/api/admin/plant", headers=h)
            self.assertFalse(c.get("/api/plant").json()["customized"])
            # пользователи
            self.assertEqual(c.get("/api/admin/users").status_code, 401)
            r = c.post("/api/admin/users", json={"login": "shift", "name": "Начальник смены", "role": "operator", "password": "shift123"}, headers=h)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(c.patch("/api/admin/users/shift", json={"blocked": True}, headers=h).json()["blocked"], True)
            self.assertEqual(c.patch("/api/admin/users/admin", json={"blocked": True}, headers=h).status_code, 422)
            self.assertEqual(c.post("/api/admin/users/shift/password", json={"password": "shift456"}, headers=h).status_code, 200)
            self.assertEqual(c.delete("/api/admin/users/shift", headers=h).status_code, 200)
            # действия с данными разрешены администратору и попадают в аудит
            self.assertEqual(c.post("/api/data/reset", headers=h).status_code, 200)
            self.assertEqual(c.post("/api/live/start", headers=h).status_code, 200)
            self.assertEqual(c.post("/api/live/stop", headers=h).status_code, 200)
            actions = [row["action"] for row in c.get("/api/admin/audit", headers=h).json()]
            for expected in ("login", "settings.update", "plant.update", "plant.reset", "user.create", "user.update", "user.password", "user.delete", "data.reset", "live.start"):
                self.assertIn(expected, actions)
            self.assertEqual(c.post("/api/admin/logout", headers=h).status_code, 200)
            self.assertEqual(c.get("/api/admin/users", headers=h).status_code, 401)


if __name__ == "__main__":
    unittest.main()
