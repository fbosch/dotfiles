"""Offline contracts for the isolated A/B launcher and grader."""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
from scenarios import CASES, WARM, COLD, scenario  # noqa: E402, I001


def load(name):
    spec = importlib.util.spec_from_file_location('suggestions_' + name, SOURCE / (name + '.py'))
    if spec is None or spec.loader is None:
        raise RuntimeError('Cannot load eval module')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


launcher = load('launch')
grader = load('check')
comparison = load('compare')


class EvalTests(unittest.TestCase):
    def expected(self, case='ledger-positive-warm', arm='baseline'):
        return {**scenario(case), 'case': case, 'arm': arm, 'model': 'provider/model', 'thinking': 'low', 'warm': WARM, 'cold': COLD}

    def events(self, case='ledger-positive-warm', skill: str | None = 'ledger-reconciliation'):
        spec = scenario(case)
        return [{'kind': 'execution', 'model': 'provider/model', 'thinking': 'low'},
                {'kind': 'context', 'catalogVisibility': {s: s in WARM for s in WARM + COLD}, 'advisoryPresent': False},
                *([{'kind': 'read', 'scope': 'skill', 'skill': skill}] if skill else []),
                *[{'kind': 'read', 'scope': 'workspace', 'path': path} for path in spec['read_order']],
                {'kind': 'assistant', 'hasToolCalls': False, 'stopReason': 'stop',
                 'text': 'Matched: R-11 120 ledger.csv incoming.csv\nNeeds review: R-12 120 121 ledger.csv incoming.csv', 'usage': {'totalTokens': 100}}]

    def test_all_twelve_scenarios_have_artifacts_and_rubrics(self):
        self.assertEqual(len(CASES), 12)
        for case in CASES:
            spec = scenario(case)
            self.assertTrue(spec['files'])
            self.assertTrue(spec['outcome_patterns'])
            self.assertTrue(set(spec['read_order']) <= set(spec['files']))

    def test_alternative_skill_is_accepted(self):
        verdict = grader.evaluate(self.events(skill='record-audit'), self.expected())
        self.assertTrue(verdict['selectionPass'])
        self.assertTrue(verdict['applicationPass'])
        self.assertTrue(verdict['outcomePass'])

    def test_correct_outcome_without_read_is_not_skill_selection(self):
        verdict = grader.evaluate(self.events(skill=None), self.expected())
        self.assertTrue(verdict['outcomePass'])
        self.assertFalse(verdict['selectionPass'])

    def test_unnecessary_skill_is_independent_of_outcome(self):
        verdict = grader.evaluate(self.events(skill='backup-inventory'), self.expected())
        self.assertTrue(verdict['outcomePass'])
        self.assertEqual(verdict['unnecessaryReads'], ['backup-inventory'])

    def test_wrong_read_order_fails_application_only(self):
        events = self.events()
        events[3], events[4] = events[4], events[3]
        verdict = grader.evaluate(events, self.expected())
        self.assertTrue(verdict['outcomePass'])
        self.assertFalse(verdict['applicationPass'])

    def test_treatment_unavailable_is_not_semantic_no_match(self):
        verdict = grader.evaluate(self.events(), self.expected(arm='treatment'))
        self.assertIn('treatment input classifier unavailable', verdict['infrastructureErrors'])

    def test_baseline_rejects_automatic_advice(self):
        events = self.events()
        events[1]['advisoryPresent'] = True
        self.assertIn('baseline received automatic advice', grader.evaluate(events, self.expected())['infrastructureErrors'])

    def test_arms_only_differ_in_skill_selection_enablement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = root / 'evidence'
            evidence.mkdir()
            (evidence / 'models.json').write_text('{}')
            (evidence / 'models-store.json').write_text('{}')
            import shutil
            shutil.copytree(SOURCE / 'skills', evidence / 'skills')
            settings = []
            for arm in ('baseline', 'treatment'):
                home = root / arm
                agent = home / '.pi/agent'
                config = {'arm': arm, 'evidence': str(evidence), 'extensions': ['fixture.ts', 'skill-discovery/index.ts'],
                          'classifierProviders': None, 'model': 'provider/model', 'thinking': 'low'}
                launcher.configure_attempt(home, agent, config, root / (arm + '.jsonl'), 'ledger-positive-warm')
                value = json.loads((agent / 'settings.json').read_text())
                self.assertEqual(value['classifier']['skillSelection'].pop('enabled'), arm == 'treatment')
                settings.append(value)
            self.assertEqual(*settings)

    def test_agent_directory_must_be_isolated(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
            root = Path(tmp)
            launcher.configure_attempt(root / 'a', root / 'b', {}, root / 'trace', CASES[0])

    def test_ungraded_attempts_count_as_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'attempt-1.expected.json').write_text('{}')
            result = comparison.summary(path)
            self.assertEqual(result['unavailableOrUngraded'], 1)
            self.assertIsNone(result['outcomeRate'])


if __name__ == '__main__':
    unittest.main()
