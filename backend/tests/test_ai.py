import copy
import json
import os
import unittest
from unittest.mock import patch

import numpy as np

from app.ai import assistant, forecast, maintenance as mt
from app.ai.engine import Engine
from app.scada import registry
from app.scada.core import Db, Scada
from app.scada.plcsim import PlcSim, defect_probability
from app.services import importers

RAW = json.loads(registry.DEFAULT_CONFIG.read_text(encoding="utf-8"))
CASE = {**importers.case_dataset(), "source": "test", "updatedAt": None}
ENGINE: Engine | None = None


def setUpModule():
    global ENGINE
    ENGINE = Engine()
    ENGINE.train(registry.parse(copy.deepcopy(RAW)))


class Plant:
    """Симулятор, SCADA и движок ИИ с модельным временем: час работы линии считается за секунды."""

    def __init__(self):
        self.reg = registry.parse(copy.deepcopy(RAW))
        self.sim = PlcSim(self.reg, seed=1)
        self.scada = Scada(self.reg, Db(":memory:"), mode="sim", sim=self.sim)
        self.scada.build_drivers()
        self.driver = self.scada.drivers["line"]
        self.driver.on_status("line", True, "test")
        self.ai = Engine()
        e = ENGINE
        self.ai.failure_model, self.ai.anomaly_model, self.ai.anomaly_threshold = e.failure_model, e.anomaly_model, e.anomaly_threshold
        self.ai.quality_models, self.ai.registry, self.ai.status = e.quality_models, self.reg, "ready"
        self.t = 0.0

    def advance(self, seconds: float, each=None):
        for _ in range(int(seconds / 0.5)):
            self.sim.scan(0.5)
            self.driver.poll()
            self.scada.evaluate()
            self.t += 0.5
            if self.t % 5 == 0:
                self.ai.tick(self.scada, self.t)
                if each:
                    each()

    def close(self):
        self.scada.db.close()


class FailureModelTests(unittest.TestCase):
    def test_model_separates_failures(self):
        self.assertGreater(ENGINE.metrics["failure"]["auc"], 0.93)

    def test_linear_wear_eta(self):
        c = registry.parse(copy.deepcopy(RAW)).controllers["booth-02"]
        p = c.param("FilterDp")
        ts = np.arange(0, 600, 5.0)
        ys = 200 + 2.5 * ts / 60 + np.random.default_rng(1).normal(0, 1.5, len(ts))
        pred = mt.predict_failure(ENGINE.failure_model, c, p, mt.Series(ts, ys, None), ts[-1])
        expected = (285 - 225) / 2.5  # мин до порога 285 Па от уровня 225 Па при 2,5 Па/мин
        self.assertAlmostEqual(pred["etaMin"], expected, delta=3)
        self.assertEqual(pred["severity"], "bad")
        self.assertEqual(pred["code"], 201)

    def test_stable_param_is_not_flagged(self):
        c = registry.parse(copy.deepcopy(RAW)).controllers["abb-01"]
        p = c.param("WeldCurrent")
        ts = np.arange(0, 900, 5.0)
        ys = 9.5 + np.random.default_rng(2).normal(0, 0.12, len(ts))
        pred = mt.predict_failure(ENGINE.failure_model, c, p, mt.Series(ts, ys, None), ts[-1])
        self.assertIsNone(pred["etaMin"])
        self.assertEqual(pred["severity"], "ok")


class AnomalyTests(unittest.TestCase):
    def setUp(self):
        reg = registry.parse(copy.deepcopy(RAW))
        self.c = reg.controllers["conveyor-03"]
        self.p = self.c.param("MotorCurrent")
        self.ts = np.arange(0, 120, 5.0)

    def check(self, ys):
        return mt.detect_anomaly(ENGINE.anomaly_model, ENGINE.anomaly_threshold, self.c, self.p, mt.Series(self.ts, ys, None), self.ts[-1])

    def test_normal_noise_is_quiet(self):
        rng = np.random.default_rng(3)
        flagged = sum(self.check(42 + rng.normal(0, 0.8, len(self.ts)))["anomalous"] for _ in range(300))
        self.assertLessEqual(flagged, 1)

    def test_drifting_current_is_anomalous(self):
        ys = 42 + 1.5 * self.ts / 60 + np.random.default_rng(4).normal(0, 0.8, len(self.ts))
        self.assertTrue(self.check(ys)["anomalous"])


class PlantTests(unittest.TestCase):
    def test_bearing_wear_seen_before_plc_alarm(self):
        plant = Plant()
        self.addCleanup(plant.close)
        plant.advance(4 * 60)
        self.assertEqual([a for a in plant.ai.anomalies if a["controller"] == "conveyor-03"], [])
        plant.sim.degrade("conveyor-03", "MotorCurrent", 1.5)
        start, marks = plant.t, {}

        def watch():
            if any(a["param"] == "MotorCurrent" for a in plant.ai.anomalies):
                marks.setdefault("ai", plant.t - start)
            if "conveyor-03:MotorCurrent.hi" in plant.scada.alarms:
                marks.setdefault("plc", plant.t - start)
        plant.advance(11 * 60, watch)
        self.assertIn("ai", marks)
        self.assertIn("plc", marks)
        self.assertLess(marks["ai"], marks["plc"] - 5 * 60)  # ИИ раньше тревоги ПЛК минимум на 5 мин

    def test_no_false_anomalies_in_normal_work(self):
        plant = Plant()
        self.addCleanup(plant.close)
        seen = set()
        plant.advance(20 * 60, lambda: seen.update((a["controller"], a["param"]) for a in plant.ai.anomalies))
        self.assertEqual(seen, set())
        filt = next(p for p in plant.ai.predictions if (p["controller"], p["param"]) == ("booth-02", "FilterDp"))
        self.assertLess(filt["etaMin"], 30)  # фильтр Камеры-02 к 20-й минуте — в получасе от аварии


class QualityTests(unittest.TestCase):
    def test_filter_drives_paint_defects(self):
        q = ENGINE.quality_models["booth-02"]
        self.assertEqual(q.drivers[0]["param"], "FilterDp")
        self.assertTrue(215 <= q.drivers[0]["doubleAbove"] <= 250)  # по закону симулятора удвоение ~230 Па

    def test_explain_points_at_clogged_filter(self):
        q = ENGINE.quality_models["booth-02"]
        ex = q.explain({**q.nominal, "FilterDp": 270})
        self.assertGreater(ex["risk"], 2 * ex["baseline"])
        self.assertEqual(ex["factors"][0]["param"], "FilterDp")

    def test_simulator_defects_follow_process(self):
        c = registry.parse(copy.deepcopy(RAW)).controllers["booth-02"]
        clean = defect_probability(c, {"FilterDp": 150, "Humidity": 65, "Temp": 23})
        dirty = defect_probability(c, {"FilterDp": 270, "Humidity": 65, "Temp": 23})
        self.assertAlmostEqual(clean, c.sim["defectRate"])
        self.assertGreater(dirty, 3 * clean)


class ForecastTests(unittest.TestCase):
    def test_monte_carlo_is_stable_and_ordered(self):
        a, b = forecast.monthly(CASE), forecast.monthly(CASE)
        self.assertEqual(a, b)
        base, ai = a["scenarios"]
        self.assertLessEqual(base["p10"], base["p50"])
        self.assertLessEqual(base["p50"], base["p90"])
        self.assertGreater(ai["p50"], base["p50"])
        self.assertAlmostEqual(sum(base["bottleneck"].values()), 1.0, places=2)
        self.assertAlmostEqual(sum(base["hist"]), 1.0, places=2)

    def test_variability_costs_output(self):
        f = forecast.monthly(CASE)
        self.assertLess(f["scenarios"][0]["p50"], f["deterministic"])


class AssistantTests(unittest.TestCase):
    def test_offline_answer_without_llm(self):
        with patch.dict(os.environ, {"AI_LLM": "off"}):
            r = assistant.chat([{"role": "user", "content": "Выполним ли план месяца?"}])
        self.assertEqual(r["mode"], "offline")
        self.assertIn("Узкое место", r["reply"])
        self.assertIn("Монте-Карло", r["reply"])

    def test_tools_are_read_only(self):
        names = {t["name"] for t in assistant.TOOLS}
        self.assertFalse({n for n in names if any(w in n for w in ("command", "start", "stop", "write", "set_"))})
        self.assertIn("run_scenario", names)  # расчёт, а не управление
