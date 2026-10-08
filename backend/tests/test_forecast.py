import time
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.services import forecast, importers, insights

CASE = {**importers.case_dataset(), "source": "test", "updatedAt": None}


class ForecastTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cal = forecast.calibrate(CASE)

    def test_calibration_reproduces_decision_center(self):
        det = forecast.deterministic(self.cal, forecast.Scenario())
        base = insights.simulate(ds=CASE)
        self.assertEqual(det["bottleneck"], base["bottleneck"])
        self.assertAlmostEqual(det["perShift"], base["perShift"], places=6)
        self.assertEqual(round(det["month"]), base["month"])

    def test_deterministic_levers_match_decision_center(self):
        levers = {lever["id"]: lever["effect"] for lever in insights.summary(CASE)["levers"]}
        base = forecast.deterministic(self.cal, forecast.Scenario())["month"]
        for action in forecast.actions(self.cal):
            if action["id"] in levers:
                after = forecast.deterministic(self.cal, forecast._combine(forecast.Scenario(), [action]))["month"]
                self.assertEqual(round(after - base), levers[action["id"]], action["id"])

    def test_failures_come_from_downtime_log(self):
        failures = {f.equipment: f for s in self.cal["stages"] for f in s.failures}
        conveyor = failures["Конвейер-03"]
        self.assertFalse(conveyor.planned)
        self.assertEqual((conveyor.rate, conveyor.minutes), (0.5, 55))
        self.assertTrue(failures["Камера-02"].planned)

    def test_randomness_costs_output_and_is_reproducible(self):
        one = forecast.forecast(forecast.Scenario(), runs=200, ds=CASE)
        two = forecast.forecast(forecast.Scenario(), runs=200, ds=CASE)
        self.assertEqual(one, two)
        self.assertLessEqual(one["p10"], one["p50"])
        self.assertLessEqual(one["p50"], one["p90"])
        self.assertLess(one["mean"], one["deterministic"])
        self.assertGreater(one["variabilityLoss"], 0)
        self.assertAlmostEqual(sum(b["share"] for b in one["histogram"]), 1, places=3)
        self.assertAlmostEqual(sum(one["bottleneckShare"].values()), 1, places=3)
        self.assertEqual(max(one["bottleneckShare"], key=one["bottleneckShare"].get), "Окраска")

    def test_without_failures_and_with_large_buffers_matches_deterministic(self):
        sc = forecast.Scenario(plannedOutside=True, predictive=1.0, buffer=60)
        mc = forecast.monte_carlo(self.cal, [sc], 50)[0]
        det = forecast.deterministic(self.cal, sc)["month"]
        self.assertAlmostEqual(float(mc["month"].mean()) / det, 1, delta=0.01)

    def test_downstream_failure_reaches_bottleneck_through_finite_buffer(self):
        # формула центра решений не видит эффекта (сборка — не узкое место), модель с буферами видит
        sc = forecast.Scenario(repair={"Конвейер-03": 10})
        self.assertEqual(forecast.deterministic(self.cal, sc)["month"], forecast.deterministic(self.cal, forecast.Scenario())["month"])
        base, faster = forecast.monte_carlo(self.cal, [forecast.Scenario(), sc], 200)
        self.assertGreater(float(faster["month"].mean()), float(base["month"].mean()))

    def test_bigger_buffer_absorbs_failures(self):
        small, big = forecast.monte_carlo(self.cal, [forecast.Scenario(buffer=3), forecast.Scenario(buffer=40)], 200)
        self.assertGreater(float(big["month"].mean()), float(small["month"].mean()))

    def test_plan_reaches_target_with_confidence(self):
        result = forecast.plan_to_target(confidence=0.8, margin=150_000, runs=200, ds=CASE)
        self.assertEqual(result["target"], 5500)
        self.assertEqual(result["baseProb"], 0)
        self.assertTrue(result["plans"])
        costs = [p["cost"] for p in result["plans"] if p["reached"]]
        self.assertEqual(costs, sorted(costs))
        for plan in result["plans"]:
            if plan["reached"]:
                self.assertGreaterEqual(plan["probTarget"], 0.8)
                self.assertEqual(plan["net"], plan["gain"] * 150_000 - plan["cost"])

    def test_sensitivity_ranks_actions(self):
        result = forecast.sensitivity(runs=100, ds=CASE)
        gains = [i["gain"] for i in result["items"]]
        self.assertEqual(gains, sorted(gains, reverse=True))
        quality_welding = next(i for i in result["items"] if i["id"] == "quality:Сварка")
        self.assertLessEqual(abs(quality_welding["gain"]), 5)

    def test_forecast_is_fast_enough_for_interactive_use(self):
        start = time.perf_counter()
        forecast.forecast(forecast.Scenario(plannedOutside=True), runs=400, ds=CASE)
        self.assertLess(time.perf_counter() - start, 3)


class ForecastApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_model_describes_calibration(self):
        body = self.client.get("/api/forecast/model").json()
        self.assertEqual([s["area"] for s in body["stages"]], insights.FLOW)
        self.assertTrue(body["actions"])
        self.assertTrue(body["assumptions"])

    def test_forecast_endpoint_and_validation(self):
        ok = self.client.post("/api/forecast", json={"defect": {"Окраска": 2}, "runs": 100})
        self.assertEqual(ok.status_code, 200)
        self.assertGreater(ok.json()["gain"], 0)
        self.assertEqual(self.client.post("/api/forecast", json={"defect": {"Окраска": 50}}).status_code, 422)
        self.assertEqual(self.client.post("/api/forecast", json={"unknown": 1}).status_code, 422)

    def test_plan_rejects_unknown_costs(self):
        self.assertEqual(self.client.post("/api/forecast/plan", json={"costs": {"x": 1}}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
