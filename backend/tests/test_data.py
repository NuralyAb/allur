import unittest

from app.repositories import store
from app.services import importers, insights, kpi, simulator


class ImportTests(unittest.TestCase):
    def test_case_docx_parsed_into_all_tables(self):
        ds = importers.case_dataset()
        self.assertEqual({k: len(v) for k, v in ds.items()}, {"lines": 6, "downtime": 4, "quality": 6, "monthPlan": 3})
        self.assertEqual(ds["lines"][0], {"date": "2026-10-01", "line": "Сварка-1", "area": "Сварка", "plan": 120,
                                          "fact": 118, "hours": 7.8, "load": 98})
        self.assertEqual(ds["quality"][-1], {"date": "2026-10-02", "area": "Сборка", "output": 119, "defects": 2})

    def test_xlsx_template_round_trip(self):
        ds = importers.case_dataset()
        batch, errors = importers.read("data.xlsx", importers.template(ds))
        self.assertEqual(errors, [])
        self.assertEqual(batch, ds)

    def test_lines_without_quality_are_rejected(self):
        tables = [[["Дата", "Линия", "План", "Факт", "Время работы, ч", "Загрузка, %"],
                   ["03.10.2026", "Сварка-1", "120", "117", "7,9", "99"]]]
        _, errors = importers.parse_tables(tables)
        self.assertTrue(errors)

    def test_bad_number_reports_row(self):
        tables = [[["Модель", "План на месяц"], ["Onix", "много"]]]
        _, errors = importers.parse_tables(tables)
        self.assertIn("строка 2", errors[0])

    def test_unknown_format(self):
        _, errors = importers.read("data.pdf", b"%PDF")
        self.assertIn(".pdf", errors[0])


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.store = store.Store(":memory:")
        self.store.write(importers.case_dataset(), "case", mode="replace")

    def test_merge_replaces_only_same_dates(self):
        day = {"lines": [{"date": "2026-10-02", "line": "Сварка-1", "area": "Сварка", "plan": 120, "fact": 100,
                          "hours": 7, "load": 88}],
               "quality": [{"date": "2026-10-02", "area": "Сварка", "output": 100, "defects": 1}]}
        self.store.write(day, "import")
        ds = self.store.dataset()
        self.assertEqual(len(ds["lines"]), 4)  # 3 строки за 01.10 + новая за 02.10
        self.assertEqual(len(ds["monthPlan"]), 3)  # план не трогали
        self.assertEqual(ds["source"], "import")


class SimulatorTests(unittest.TestCase):
    def test_shift_is_committed_and_feeds_insights(self):
        st = store.Store(":memory:")
        st.write(importers.case_dataset(), "case", mode="replace")
        sim = simulator.Simulator(st, seed=7)
        ticks = 0
        while not sim.step():
            ticks += 1
            progress = sim.progress()["shift"]
            self.assertLessEqual(progress["areas"]["Сварка"]["done"], 120)
        self.assertEqual(ticks + 1, simulator.SHIFT_MIN // simulator.MINUTES_PER_TICK)
        ds = st.dataset()
        self.assertEqual(max(r["date"] for r in ds["lines"]), "2026-10-05")  # 03–04.10 — выходные
        summary = kpi.summary(ds)
        self.assertEqual(summary["date"], "2026-10-05")
        # симулятор пишет согласованные часы и простои — неоднозначностей по новой смене нет
        self.assertFalse([i for i in summary["meta"]["issues"] if i["date"] == "2026-10-05"])
        self.assertIn(insights.summary(ds)["base"]["bottleneck"], insights.FLOW)

    def test_simulated_hours_and_downtime_fit_the_shift(self):
        sim = simulator.Simulator(store.Store(":memory:"), seed=1)
        for _ in range(50):
            shift = sim.plan_shift()
            for area, a in shift["areas"].items():
                down = sum(e["minutes"] for e in shift["events"] if e["area"] == area)
                self.assertAlmostEqual(a["hours"] * 60 + down, 480, delta=3)
                self.assertLessEqual(a["defects"], a["fact"])


if __name__ == "__main__":
    unittest.main()
