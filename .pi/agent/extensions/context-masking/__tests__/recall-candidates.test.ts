import { afterEach, expect, test } from "bun:test";
import { recallSession } from "../../../benchmarks/context-recall-offline";
import { RECALL_LIMITS, recallUnified } from "../recall";

const sessions: Awaited<ReturnType<typeof recallSession>>[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.cleanup();
});

for (const count of [7, 8]) {
  test(`classifier receives evidence for all ${count} identifier-only queries`, async () => {
    const subjects = Array.from({ length: count }, (_, index) => `subject${index}`);
    const texts = [
      ...subjects.map((subject) => `${subject}: approved receipt value-${subject}.`),
      ...Array.from({ length: 6 }, (_, index) => `Unrelated completed diagnostic ${index}.`),
    ];
    const session = await recallSession(
      texts.map((text, index) => ({
        tool: "read",
        args: { path: `opaque/archive-${index}.txt` },
        text,
      })),
    );
    sessions.push(session);
    let excerpts: string[] = [];
    const report = await recallUnified(
      session.manager.getBranch(),
      session.root,
      session.manager.getSessionId(),
      subjects,
      3,
      {
        classifier: async (input) => {
          const candidates = input.state.text_candidates;
          excerpts = Array.isArray(candidates)
            ? candidates.map((candidate) =>
                typeof candidate === "object" && candidate !== null && "excerpt" in candidate
                  ? String(candidate.excerpt)
                  : "",
              )
            : [];
          return { ok: false, reason: "disabled", stage: "config" };
        },
      },
    );
    expect(report.candidateCount.text).toBeLessThanOrEqual(RECALL_LIMITS.textCandidates);
    for (const subject of subjects) expect(excerpts.join("\n")).toContain(`value-${subject}.`);
  });
}
