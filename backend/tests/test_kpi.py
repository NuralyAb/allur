import unittest

from app import importers, kpi

CASE = {**importers.case_dataset(), "source": "test", "updatedAt": None}


class KpiTests(unittest.TestCase):
    def test_summary_uses_assembly_without_summing_process_outputs(self):
        summary = kpi.summary(CASE)
        self.assertEqual(summary["plant"]["basis"], "Сборка-1")
        self.assertEqual(summary["plant"]["fact"], 119)
        self.assertEqual(summary["plant"]["good"], 117)
        self.assertEqual(summary["plant"]["defectRate"], 1.7)
        self.assertEqual(summary["flowMinimum"], {"area": "Сварка", "fact": 111})

    def test_limit_is_per_equipment_per_day_and_inclusive(self):
        events = [
            {"date": "2026-10-01", "area": "Сварка", "equipment": "A", "reason": "x", "minutes": 40},
            {"date": "2026-10-01", "area": "Сварка", "equipment": "A", "reason": "y", "minutes": 25},
            {"date": "2026-10-01", "area": "Сварка", "equipment": "B", "reason": "z", "minutes": 60},
            {"date": "2026-10-02", "area": "Сварка", "equipment": "A", "reason": "x", "minutes": 10},
        ]
        results = kpi.downtime_events({**CASE, "downtime": events})
        self.assertEqual([r["dailyMinutes"] for r in results], [65, 65, 60, 10])
        self.assertEqual([r["overLimit"] for r in results], [True, True, False, False])

    def test_source_plan_is_not_increased_to_match_target(self):
        plan = kpi.summary(CASE)["monthPlan"]
        self.assertEqual([m["plan"] for m in plan["models"]], [2500, 1800, 500])
        self.assertEqual((plan["total"], plan["target"], plan["gap"]), (4800, 5500, 700))

    def test_demo_oee_caps_plan_excess_but_preserves_reported_fact(self):
        row = kpi.line_metrics(CASE["lines"][2], CASE)
        self.assertEqual(row["fact"], 121)
        self.assertEqual(row["performance"], 100.8)
        self.assertEqual(row["oee"], row["quality"])

    def test_ambiguous_period_is_reported_without_changing_source(self):
        summary = kpi.summary(CASE)
        self.assertTrue(summary["meta"]["demo"])
        self.assertEqual(len(summary["meta"]["issues"]), 3)
        assembly = next(r for r in summary["meta"]["issues"] if r["line"] == "Сборка-1")
        self.assertIn("529", assembly["message"])
        self.assertEqual(CASE["lines"][-1]["hours"], 7.9)


if __name__ == "__main__":
    unittest.main()
