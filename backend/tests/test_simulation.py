import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import data_source
from app.services.simulation import Engine, SimulationConfig, CompareRequest, Session, compare

data_source.seed_if_empty()  # compare() читает общее хранилище; в чистом окружении оно пустое


class SimulationTests(unittest.TestCase):
    def test_conservation_and_finite_buffers_through_failure_and_repair(self):
        engine = Engine(SimulationConfig())
        for minute in range(481):
            engine.advance(minute)
            s = engine.snapshot()
            self.assertEqual(s['started'], s['good'] + s['rejected'] + s['wip'])
            self.assertEqual(len({v['id'] for v in s['vehicles']}), s['wip'])
            for stage in s['stages']:
                self.assertLessEqual(stage['queue'], stage['capacity'])
                self.assertAlmostEqual(sum(stage['durations'].values()), minute, places=6)

    def test_failure_preserves_processing_progress(self):
        engine = Engine(SimulationConfig())
        engine.advance(30)
        first = engine.snapshot()
        self.assertEqual(first['stages'][2]['state'], 'FAULT')
        body = next(v for v in first['vehicles'] if v['stage'] == 'assembly' and v['status'] == 'processing')
        engine.advance(60)
        paused = next(v for v in engine.snapshot()['vehicles'] if v['id'] == body['id'])
        self.assertEqual(body['progress'], paused['progress'])
        engine.advance(85)
        resumed = next(v for v in engine.snapshot()['vehicles'] if v['id'] == body['id'])
        self.assertAlmostEqual(resumed['progress'], body['progress'], places=6)

    def test_failure_propagates_upstream_and_downstream(self):
        engine = Engine(SimulationConfig())
        engine.advance(60)
        stages = engine.snapshot()['stages']
        self.assertEqual(stages[1]['state'], 'BLOCKED')
        self.assertEqual(stages[2]['queue'], 6)
        self.assertEqual(stages[3]['state'], 'STARVED')

    def test_repair_happens_at_exact_boundary(self):
        engine = Engine(SimulationConfig())
        engine.advance(84.999)
        self.assertTrue(engine.stations[2].failed)
        engine.advance(85)
        self.assertFalse(engine.stations[2].failed)
        self.assertAlmostEqual(engine.stations[2].durations['FAULT'], 55)

    def test_incremental_and_single_run_are_identical(self):
        one, stepped = Engine(SimulationConfig()), Engine(SimulationConfig())
        one.advance(480)
        for t in range(1, 481):
            stepped.advance(t)
        self.assertEqual(one.snapshot(), stepped.snapshot())

    def test_zero_repair_is_control_without_failure(self):
        engine = Engine(SimulationConfig(repairMinutes=0))
        engine.advance(480)
        self.assertEqual(engine.stations[2].durations['FAULT'], 0)
        self.assertFalse(engine.journal)

    def test_end_of_shift_cannot_be_advanced_or_reversed(self):
        engine = Engine(SimulationConfig())
        engine.advance(999)
        original = engine.snapshot()
        engine.advance(0)
        self.assertEqual(engine.snapshot(), original)
        self.assertTrue(original['completed'])

    def test_quality_zero_and_hundred_percent(self):
        # The engine supports full rejection; the public UI caps user parameters at 20%.
        engine = Engine(SimulationConfig(defectPercent=0))
        engine.advance(480)
        self.assertEqual(engine.rejected, 0)
        engine.config.defectPercent = 100
        other = Engine(engine.config)
        other.advance(480)
        self.assertEqual(other.good, 0)

    def test_config_rejects_invalid_values(self):
        for value in ({'bufferCapacity': 0}, {'bufferCapacity': 1.5}, {'assemblyCycle': 0}, {'repairMinutes': -1}, {'defectPercent': 101}, {'repairMinutes': float('nan')}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                SimulationConfig(**value)

    def test_comparison_uses_results_and_margin_without_double_counting(self):
        result = compare(CompareRequest())
        self.assertEqual(result['deltaGood'], result['alternative']['good'] - result['baseline']['good'])
        self.assertEqual(result['savedMinutes'], 35)
        self.assertEqual(result['effectKzt'], result['deltaGood'] * 150_000 - 30_000)
        self.assertGreater(result['month']['alternative'], result['month']['baseline'])
        self.assertNotEqual(result['month']['baseline'], result['baseline']['good'] * 46)

    def test_equal_and_slower_repairs_are_not_claimed_as_improvement(self):
        same = compare(CompareRequest(alternativeRepair=55))
        self.assertEqual(same['deltaGood'], 0)
        self.assertEqual(same['effectKzt'], -30_000)
        slower = compare(CompareRequest(alternativeRepair=100))
        self.assertLessEqual(slower['deltaGood'], 0)
        self.assertLess(slower['savedMinutes'], 0)

    def test_constraint_is_measured_and_changes_with_stage_capacity(self):
        original = compare(CompareRequest())['bottleneck']
        self.assertEqual(original['assetId'], 'Конвейер-03')
        self.assertGreater(original['extraGood'], 0)
        faster_assembly = compare(CompareRequest(assemblyCycle=2))['bottleneck']
        self.assertEqual(faster_assembly['assetId'], 'Камера-02')
        self.assertGreater(faster_assembly['extraGood'], 0)

    def test_pause_reset_speed_and_monotonic_versions(self):
        with patch('app.services.simulation.time.monotonic', return_value=0):
            session = Session(SimulationConfig())
            initial = session.snapshot()
            session.control('resume')
        with patch('app.services.simulation.time.monotonic', return_value=10):
            state = session.control('pause')
            self.assertEqual(state['time'], 20)
        with patch('app.services.simulation.time.monotonic', return_value=100):
            self.assertEqual(session.snapshot()['time'], 20)
            reset = session.control('reset')
            self.assertEqual(reset['time'], 0)
            self.assertFalse(reset['running'])
            self.assertGreater(reset['version'], initial['version'])


if __name__ == '__main__':
    unittest.main()
