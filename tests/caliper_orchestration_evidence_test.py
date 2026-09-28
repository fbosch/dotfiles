import unittest

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("orchestration_test_helpers", Path(__file__).with_name("caliper_orchestration_eval_test.py"))
if spec is None or spec.loader is None:
    raise ImportError("Missing orchestration test helpers")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
CHECK = helpers.CHECK
EXPECTED = helpers.EXPECTED
make_simple_trace = helpers.make_simple_trace
make_steering_trace = helpers.make_steering_trace


class OrchestrationEvidenceTests(unittest.TestCase):
    def test_routine_rejects_an_incorrect_decision_without_tool_calls(self):
        events = make_simple_trace("routine")
        events[-1]["text"] = '{"intervene": true}'
        with self.assertRaisesRegex(AssertionError, "incorrectly requires intervention"):
            CHECK.check_events(events, EXPECTED, "routine")

    def test_direct_read_requires_a_successful_matching_result(self):
        for mode in ("missing", "wrong", "late"):
            with self.subTest(mode=mode):
                events = make_simple_trace("direct")
                result = next(e for e in events if e["kind"] == "result")
                if mode == "missing":
                    events.remove(result)
                elif mode == "wrong":
                    result["text"] = "unrelated content"
                else:
                    events.remove(result)
                    events.append(result)
                with self.assertRaisesRegex(AssertionError, "Direct read result missing or after final"):
                    CHECK.check_events(events, EXPECTED, "direct")

    def test_nonterminal_child_or_parent_text_cannot_pass(self):
        for parent in (True, False):
            for reason in ("toolUse", "error", "aborted"):
                with self.subTest(parent=parent, reason=reason):
                    events = make_steering_trace()
                    final = next(e for e in events if e["kind"] == "assistant" and e["parent"] == parent)
                    final["stopReason"] = reason
                    with self.assertRaises(AssertionError):
                        CHECK.check_events(events, EXPECTED, "steering")

    def test_tool_calling_message_is_not_a_completed_report(self):
        events = make_steering_trace()
        final = next(e for e in events if e["kind"] == "assistant" and not e["parent"])
        final["hasToolCalls"] = True
        with self.assertRaisesRegex(AssertionError, "Worker did not report"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_child_report_must_follow_its_read_result(self):
        events = make_steering_trace()
        final = next(e for e in events if e["kind"] == "assistant" and not e["parent"])
        result = next(e for e in events if e["kind"] == "result" and e["tool"] == "read")
        events.remove(final)
        events.insert(events.index(result), final)
        with self.assertRaisesRegex(AssertionError, "report precedes read results"):
            CHECK.check_events(events, EXPECTED, "steering")


if __name__ == "__main__":
    unittest.main()
