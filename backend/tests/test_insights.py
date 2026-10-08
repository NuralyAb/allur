import unittest
from app.services import importers, insights

CASE = {**importers.case_dataset(), "source": "test", "updatedAt": None}


class InsightsTests(unittest.TestCase):
    def test_base_reproduces_source_facts(self):
        areas = insights.simulate(ds=CASE)["areas"]
        self.assertEqual([areas[a]["output"] for a in insights.FLOW], [114.5, 115.5, 120.0])

    def test_bottleneck_is_lowest_good_output(self):
        base = insights.simulate(ds=CASE)
        self.assertEqual(base["bottleneck"], "Окраска")
        self.assertEqual(base["perShift"], 110.5)
        self.assertEqual(base["month"], round(110.5 * 2 * insights.WORK_DAYS))

    def test_improving_non_bottleneck_gives_nothing(self):
        levers = {lever["id"]: lever for lever in insights.summary(CASE)["levers"]}
        self.assertEqual(levers["quality:Сварка"]["effect"], 0)
        self.assertGreater(levers["quality:Окраска"]["effect"], 0)

    def test_fixing_bottleneck_moves_constraint(self):
        after = insights.simulate(["quality:Окраска"], ds=CASE)
        self.assertEqual(after["bottleneck"], "Сварка")
        self.assertEqual(after["perShift"], 112.0)

    def test_output_is_capped_by_takt(self):
        after = insights.simulate(["planned"], ds=CASE)
        self.assertLessEqual(after["areas"]["Окраска"]["output"], 120)

    def test_extra_shifts_close_target_gap(self):
        base = insights.simulate(ds=CASE)
        closed = insights.simulate(extra_shifts=base["extraShiftsForTarget"], ds=CASE)
        self.assertGreaterEqual(closed["vsTarget"], 0)

    def test_high_risk_is_unplanned_near_limit(self):
        risks = insights.summary(CASE)["risks"]
        self.assertEqual((risks[0]["equipment"], risks[0]["level"]), ("Конвейер-03", "high"))
        filter_ = next(r for r in risks if r["equipment"] == "Камера-02")
        self.assertTrue(filter_["onBottleneck"])
        self.assertEqual(filter_["plantCarsLost"], 10.0)

    def test_unknown_reason_is_treated_as_unplanned(self):
        events = CASE["downtime"] + [{"date": "2026-10-02", "area": "Окраска", "equipment": "X", "reason": "Новая", "minutes": 50}]
        risk = next(r for r in insights.summary({**CASE, "downtime": events})["risks"] if r["equipment"] == "X")
        self.assertFalse(risk["planned"])
        self.assertEqual(risk["level"], "high")


if __name__ == "__main__":
    unittest.main()
