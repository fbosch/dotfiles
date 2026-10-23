import { expect, test } from "bun:test";
import { workerMetadata } from "../metadata";
import type { LiveSessionAvailability, WorkerSnapshot, WorkerStatus } from "../owner";
import { cancellable, statusGlyph, widgetLines } from "../presentation";

function worker(
  status: WorkerStatus,
  liveSession: LiveSessionAvailability = "available",
): WorkerSnapshot {
  return {
    id: `policy-${status}`,
    parentSessionId: "parent",
    specialist: "fixture",
    status,
    liveSession,
    currentAssignmentId: "assignment",
    createdAt: 0,
    config: {
      name: "fixture",
      description: "Fixture",
      prompt: "Role",
      model: "fixture/model",
      maxTurns: 2,
      tools: [],
      excludeTools: [],
      extensions: [],
      skills: [],
    },
    assignments: [
      {
        id: "assignment",
        prompt: "Task",
        outcome: "completed",
        maxTurns: 2,
        turnsUsed: 1,
        remainingTurns: 1,
        persistence: "saved",
        transcript: [],
      },
    ],
  };
}

const policies: Array<[WorkerStatus, string, boolean, boolean, string]> = [
  ["queued", "◦", true, true, "Queued"],
  ["running", "◍", true, true, "Running"],
  ["waiting-question", "!", true, true, "Waiting question"],
  ["stopping", "!", false, true, "Stopping"],
  ["idle", "○", false, false, "Completed · Ready to continue"],
  ["cancelled", "■", false, false, "Cancelled"],
  ["cleanup-unknown", "✗", false, false, "Cleanup unknown"],
  ["releasing", "!", false, true, "Releasing"],
  ["released", "■", false, false, "Released"],
  ["historical", "○", false, false, "Completed"],
];

test.each(policies)(
  "state %s preserves its glyph, cancellation policy, visibility, and outcome label",
  (status, glyph, canCancel, visible, heading) => {
    const current = worker(status);
    expect(statusGlyph(status)).toBe(glyph);
    expect(cancellable(current)).toBe(canCancel);
    const rows = widgetLines({
      workers: [current],
      observation: () => undefined,
      width: 120,
      terminalRows: 30,
      now: 0,
    });
    expect(rows.some((row) => row.includes("fixture/model"))).toBe(visible);
    expect(workerMetadata(current)[0]).toBe(heading);
    for (const availability of ["released", "historical", "none"] as const) {
      expect(cancellable({ ...current, liveSession: availability })).toBe(false);
    }
  },
);

const availability: Array<[LiveSessionAvailability, string]> = [
  ["available", "Completed · Ready to continue"],
  ["historical", "Completed · Historical"],
  ["released", "Completed · Session released"],
  ["none", "Completed"],
];

test.each(availability)(
  "session availability %s preserves its metadata label",
  (state, heading) => {
    expect(workerMetadata(worker("idle", state))[0]).toBe(heading);
  },
);

test("running glyphs retain both animation frames and unknown saved states retain a neutral glyph", () => {
  expect([0, 1, 2].map((frame) => statusGlyph("running", undefined, frame))).toEqual([
    "◍",
    "●",
    "◍",
  ]);
  expect(statusGlyph("saved-extension-state")).toBe("○");
});
