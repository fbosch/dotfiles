export interface Scenario {
  id: string;
  request: string;
  facts: string;
}
export interface Fixture extends Scenario {
  reply: string;
  expected: { essentialMissing: boolean; meaningChanged: boolean; usefulDetail: boolean };
}

// Authored synthetic labels, not observations from private conversations.
export const FIXTURES: readonly Fixture[] = [
  {
    id: "visible-blocker",
    request: "Can I deploy?",
    facts: "Unit checks passed. Integration checks failed. Deployment is blocked.",
    reply:
      "Unit checks passed; deployment is blocked. {{Logs.|Logs show the integration timeout.}}",
    expected: { essentialMissing: false, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "hidden-blocker",
    request: "Can I deploy?",
    facts: "Unit checks passed. Integration checks failed. Do not deploy.",
    reply:
      "{{Validation completed.|Validation completed. Unit checks passed, but integration checks failed; do not deploy.}}",
    expected: { essentialMissing: true, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "hidden-action",
    request: "Is the installed fix active?",
    facts: "The fix is installed but requires a service restart to take effect.",
    reply:
      "The fix is installed. {{Setup details.|Setup details: restart the service before the fix takes effect.}}",
    expected: { essentialMissing: true, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "visible-action",
    request: "How do I activate the installed fix?",
    facts: "Restart the service. It reads settings only at startup.",
    reply:
      "Restart the service to activate the installed fix. {{Why restart?|Why restart? The service only reads settings at startup.}}",
    expected: { essentialMissing: false, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "changed-scope",
    request: "Did every check pass?",
    facts: "Unit checks passed; integration checks failed.",
    reply: "{{Every check passed.|Every unit check passed. The integration checks failed.}}",
    expected: { essentialMissing: true, meaningChanged: true, usefulDetail: true },
  },
  {
    id: "optional-evidence",
    request: "Did the checks pass?",
    facts: "All 24 checks passed in 1.2 seconds.",
    reply:
      "All checks passed. {{Timing details.|Timing details: 24 checks finished in 1.2 seconds.}}",
    expected: { essentialMissing: false, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "redundant-detail",
    request: "Does the change work?",
    facts: "The change works. No further evidence is available.",
    reply:
      "The change is ready. {{The change works.|The change works. It works and the change is working.}}",
    expected: { essentialMissing: false, meaningChanged: false, usefulDetail: false },
  },
  {
    id: "plain-answer",
    request: "What is 2 + 2?",
    facts: "2 + 2 = 4.",
    reply: "2 + 2 = 4.",
    expected: { essentialMissing: false, meaningChanged: false, usefulDetail: false },
  },
  {
    id: "hidden-uncertainty",
    request: "What caused the failure?",
    facts: "The cache is a possible cause; the cause has not been confirmed.",
    reply:
      "{{The cache caused the failure.|The cache probably caused the failure; this is still unconfirmed.}}",
    expected: { essentialMissing: true, meaningChanged: true, usefulDetail: true },
  },
  {
    id: "requested-table",
    request: "Show the monthly prices for Basic and Team.",
    facts: "Basic costs $8 monthly. Team costs $20 monthly.",
    reply:
      "Here is the comparison. {{Prices.|Prices.\n\n| Plan | Monthly |\n|---|---:|\n| Basic | $8 |\n| Team | $20 |}}",
    expected: { essentialMissing: true, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "nested-action",
    request: "Is the installed patch active?",
    facts: "The installed patch requires restarting the service before it is active.",
    reply:
      "The patch is installed. {{Details.|Details. {{Activation.|Activation requires restarting the service.}}}}",
    expected: { essentialMissing: true, meaningChanged: false, usefulDetail: true },
  },
  {
    id: "visible-validation-limit",
    request: "Summarize verification.",
    facts:
      "Unit checks passed, but the full suite could not run because its home directory could not be created.",
    reply:
      "The unit checks passed, but the full suite could not run. {{Environment details.|Environment details: the test runner cannot create its home directory.}}",
    expected: { essentialMissing: false, meaningChanged: false, usefulDetail: true },
  },
];

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "closing-verification",
    request:
      "Summarize the fix in a brief handoff. Put verification details in a final closing block.",
    facts:
      "The config fix is implemented. All 18 unit checks passed. The integration suite could not start because its test account is unavailable. Deployment readiness is unverified. The operator must run /reload to load the config.",
  },
  {
    id: "activation",
    request: "Is the installed fix active, and what must I do next? Keep the explanation brief.",
    facts:
      "The patch is installed but not active. Restart the service to activate it. The service reads its config at startup. Restarting it takes around five seconds.",
  },
  {
    id: "uncertain-cause",
    request:
      "What caused the build failure? Give a concise answer with optional supporting detail.",
    facts:
      "The cache is a hypothesis, not a confirmed cause. Three failures occurred after cache restores. One occurred without a restore. No controlled reproduction has been run.",
  },
  {
    id: "requested-comparison",
    request: "Show the monthly price for Basic and Team and tell me which costs less.",
    facts:
      "Basic costs $8 a month and supports one member. Team costs $20 a month and supports five members. Basic costs less in total. Per-member calculations are optional.",
  },
];
