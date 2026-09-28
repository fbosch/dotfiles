import { describe, expect, test } from "bun:test";
import {
  FACT_SELECTOR_LIMITS,
  selectFacts,
  type FactInput,
  type FactJudge,
  type FactJudgeRequest,
  type FactRelation,
} from "..";

function input(messages: FactInput["messages"], overrides: Partial<FactInput> = {}): FactInput {
  return {
    messages,
    tailEvidence: [],
    firstKeptEntryId: "kept-entry",
    piTokenBudget: 20_000,
    ...overrides,
  };
}

function replacingJudge(
  choose: (request: FactJudgeRequest, instructions: string) => FactRelation = () => "replaces",
  safetyNoul = 0.999,
): FactJudge {
  return async (request) => ({
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => [
        key,
        request.phase === "relations"
          ? choose(request, question.instructions)
          : { noul: safetyNoul },
      ]),
    ),
  });
}

function appendPadding(messages: FactInput["messages"], repetitions = 200): FactInput["messages"] {
  return [
    ...messages,
    {
      id: "padding",
      order: messages.length + 1,
      role: "assistant",
      text: "Baseline execution completed.\n".repeat(repetitions),
    },
  ];
}

function assertSourceCoverage(
  result: Extract<Awaited<ReturnType<typeof selectFacts>>, { kind: "success" }>,
  source: { id: string; text: string },
): void {
  const slices = result.coverage
    .filter((entry) => entry.sourceId === source.id)
    .toSorted((left, right) => left.start - right.start);
  expect(slices.map(({ text }) => text).join("")).toBe(source.text);
  let end = 0;
  for (const slice of slices) {
    expect(slice.start).toBe(end);
    expect(slice.end).toBeGreaterThanOrEqual(slice.start);
    expect(slice.text).toBe(source.text.slice(slice.start, slice.end));
    end = slice.end;
  }
  expect(end).toBe(source.text.length);
}

function relationFor(
  request: FactJudgeRequest,
  choose: (instructions: string) => FactRelation,
): { answers: Record<string, FactRelation | { readonly noul: number }> } {
  return {
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => [
        key,
        request.phase === "relations" ? choose(question.instructions) : { noul: 0.999 },
      ]),
    ),
  };
}

function largeReducibleInput(): FactInput {
  const messages: Array<FactInput["messages"][number]> = [];
  let order = 0;
  const push = (id: string, text: string, role: "user" | "assistant" = "user") => {
    messages.push({ id, order: order++, role, text });
  };

  push("essential-beginning", "The project objective is to preserve the event journal.");
  for (let index = 0; index < 50; index += 1) {
    const key = String(index).padStart(2, "0");
    push(`old-${key}`, `CASE_${key} atlas${key} northgrid${key} keeps 3 replicas.`);
    if (index === 24) push("essential-middle", "The migration must remain offline.");
  }
  for (let index = 0; index < 50; index += 1) {
    const key = String(index).padStart(2, "0");
    push(`correction-${key}`, `CASE_${key} atlas${key} northgrid${key} keeps 5 replicas.`);
    if (index % 7 === 3)
      push(`interlude-${index}`, "A separate checkpoint was recorded.", "assistant");
  }
  push("essential-end", "The final approval remains with the user.");

  const targetChars = 426 * 1024;
  const fixedChars = messages.reduce((sum, message) => sum + message.text.length, 0);
  const fillerLine = "Routine cache warmup completed.\n";
  const remaining = targetChars - fixedChars;
  const repetitions = Math.floor(remaining / fillerLine.length);
  const remainder = remaining - repetitions * fillerLine.length;
  const fillerMessages = Array.from({ length: 10 }, (_, index) => {
    const count = Math.floor(repetitions / 10) + (index < repetitions % 10 ? 1 : 0);
    return {
      id: `archive-${index}`,
      order: index * 4 + 1,
      role: "assistant" as const,
      text: fillerLine.repeat(count) + (index === 9 ? " ".repeat(remainder) : ""),
    };
  });
  const combined = [...messages, ...fillerMessages].toSorted(
    (left, right) => left.order - right.order,
  );
  return input(combined);
}

describe("offline fact selector", () => {
  test("retires a copied older fact only through a later same-authority witness", async () => {
    const messages = appendPadding([
      { id: "old", order: 1, role: "user", text: "The cache TTL is 3 seconds." },
      { id: "new", order: 2, role: "user", text: "The cache TTL is 7 seconds." },
    ]);
    const result = await selectFacts(input(messages), replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).toContain("The cache TTL is 7 seconds.");
    expect(result.summary).not.toContain("The cache TTL is 3 seconds.");
    expect(result.firstKeptEntryId).toBe("kept-entry");
    expect(result.coverage.find((entry) => entry.sourceId === "old")?.disposition).toBe("retired");
    expect(result.coverage.find((entry) => entry.sourceId === "new")?.disposition).toBe("retained");
  });

  test("compresses a 426 KiB transcript with distributed corrections and beginning/middle/end essentials", async () => {
    const prepared = largeReducibleInput();
    expect(prepared.messages.reduce((sum, message) => sum + message.text.length, 0)).toBe(
      426 * 1024,
    );
    const requests: FactJudgeRequest[] = [];
    const result = await selectFacts(prepared, async (request) => {
      requests.push(request);
      return relationFor(request, () => "replaces");
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success")
      throw new Error(`expected success, got ${result.kind}/${result.reason}`);
    expect(result.summary).toContain("The project objective is to preserve the event journal.");
    expect(result.summary).toContain("The migration must remain offline.");
    expect(result.summary).toContain("The final approval remains with the user.");
    expect(result.summary).toContain("CASE_00 atlas00 northgrid00 keeps 5 replicas.");
    expect(result.summary).toContain("CASE_49 atlas49 northgrid49 keeps 5 replicas.");
    expect(result.summary).not.toContain("CASE_00 atlas00 northgrid00 keeps 3 replicas.");
    expect(result.wrappedChars).toBeLessThanOrEqual(Math.floor(result.sourceChars * 0.2));
    expect(result.estimatedTokens).toBe(
      Math.ceil(new TextEncoder().encode(result.summary).byteLength / 3),
    );
    expect(result.estimatedTokens).toBeLessThanOrEqual(prepared.piTokenBudget);
    expect(requests.filter((request) => request.phase === "relations")).toHaveLength(4);
    expect(requests.filter((request) => request.phase === "safety")).toHaveLength(4);
    expect(result.pairs).toHaveLength(50);
    expect(result.pairs.every((pair) => pair.relation === "replaces" && pair.retired)).toBe(true);
    expect(
      requests.every(
        (request) =>
          request.serializedBytes <= FACT_SELECTOR_LIMITS.maxRequestBytes &&
          request.estimatedTokens <= FACT_SELECTOR_LIMITS.maxRequestEstimatedTokens &&
          Object.keys(request.questions).length <= FACT_SELECTOR_LIMITS.maxQuestionsPerRequest,
      ),
    ).toBe(true);
    for (const source of prepared.messages) assertSourceCoverage(result, source);
  });

  test("keeps conditional, attributed, ambiguous, and code evidence intact with complete range coverage", async () => {
    const content = [
      "Do not deploy unless I approve. According to Ada, rollout is delayed.",
      "Maybe the cron target is wrong.",
      "```ts",
      'const endpoint = "/v1/private";',
      "```",
    ].join("\n");
    const messages = appendPadding([{ id: "context", order: 1, role: "user", text: content }]);
    const result = await selectFacts(input(messages), replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    const sourceEntries = result.coverage.filter((entry) => entry.sourceId === "context");
    expect(sourceEntries.map((entry) => entry.text).join("")).toBe(content);
    expect(
      sourceEntries.every((entry) => result.summary.includes(JSON.stringify(entry.text))),
    ).toBe(true);
    expect(sourceEntries.filter((entry) => entry.disposition === "retained")).toHaveLength(3);
    expect(sourceEntries.every((entry) => entry.disposition === "retained")).toBe(true);
    assertSourceCoverage(result, { id: "context", text: content });
  });

  test("does not let assistant or tool evidence replace a user's approval constraint", async () => {
    const approval = "Production deploy requires my approval. Do not deploy without my approval.";
    const messages = appendPadding([
      { id: "approval", order: 1, role: "user", text: approval },
      {
        id: "assistant-claim",
        order: 2,
        role: "assistant",
        text: "Production deploy has approval.",
      },
      { id: "tool-claim", order: 3, role: "tool", text: "Production deploy was approved." },
    ]);
    const result = await selectFacts(input(messages), replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).toContain(approval);
    expect(result.coverage.find((entry) => entry.sourceId === "approval")?.disposition).toBe(
      "retained",
    );
    expect(result.pairs).toHaveLength(0);
  });

  test("does not require the latest user message as a witness", async () => {
    const messages = appendPadding([
      { id: "old-assistant", order: 1, role: "assistant", text: "The cache TTL is 3 seconds." },
      { id: "new-assistant", order: 2, role: "assistant", text: "The cache TTL is 7 seconds." },
    ]);
    const result = await selectFacts(input(messages), replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).not.toContain("The cache TTL is 3 seconds.");
    expect(result.coverage.find((entry) => entry.sourceId === "old-assistant")?.disposition).toBe(
      "retired",
    );
  });

  test("makes independent decisions for multiple facts in one message", async () => {
    const text =
      "Cache TTL is 3 seconds. Retry delay is 1 second. Cache TTL is 7 seconds. Retry delay is 5 seconds.";
    const result = await selectFacts(
      input(appendPadding([{ id: "multi", order: 1, role: "user", text }])),
      replacingJudge(),
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).toContain("Cache TTL is 7 seconds.");
    expect(result.summary).toContain("Retry delay is 5 seconds.");
    expect(result.summary).not.toContain("Cache TTL is 3 seconds.");
    expect(result.summary).not.toContain("Retry delay is 1 second.");
    expect(
      result.coverage.filter(
        (entry) => entry.sourceId === "multi" && entry.disposition === "retired",
      ),
    ).toHaveLength(2);
    assertSourceCoverage(result, { id: "multi", text });
  });

  test("uses explicit tail evidence as a retained witness without copying it into the summary", async () => {
    const prepared = input(
      appendPadding([
        { id: "old", order: 1, role: "assistant", text: "The migration batch has 4 jobs." },
      ]),
      {
        tailEvidence: [
          {
            id: "tail-witness",
            order: 2,
            role: "user",
            text: "The migration batch now has 2 jobs.",
          },
        ],
      },
    );
    const result = await selectFacts(prepared, replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).not.toContain("The migration batch now has 2 jobs.");
    expect(result.coverage.find((entry) => entry.sourceId === "old")?.disposition).toBe("retired");
    expect(result.coverage.find((entry) => entry.sourceId === "tail-witness")).toMatchObject({
      disposition: "retained",
      rendered: false,
    });
    expect(result.firstKeptEntryId).toBe("kept-entry");
  });

  test("resolves witness chains to a retained terminal fact", async () => {
    const messages = appendPadding([
      { id: "a", order: 1, role: "user", text: "Artifact retention is 7 days." },
      { id: "b", order: 2, role: "user", text: "Artifact retention is 30 days." },
      { id: "c", order: 3, role: "user", text: "Artifact retention is 45 days." },
    ]);
    const result = await selectFacts(input(messages), replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).toContain("Artifact retention is 45 days.");
    expect(result.summary).not.toContain("Artifact retention is 7 days.");
    expect(result.summary).not.toContain("Artifact retention is 30 days.");
    const terminal = result.coverage.find((entry) => entry.sourceId === "c");
    expect(result.coverage.find((entry) => entry.sourceId === "a")).toMatchObject({
      disposition: "retired",
      witnessId: terminal?.unitId,
    });
    expect(result.coverage.find((entry) => entry.sourceId === "b")).toMatchObject({
      disposition: "retired",
      witnessId: terminal?.unitId,
    });
  });

  test("reviews more than 64 pairs and eight per-request-bounded calls without a global deadline", async () => {
    const messages: Array<FactInput["messages"][number]> = [];
    for (let index = 0; index < 65; index += 1) {
      const key = String(index).padStart(2, "0");
      messages.push({
        id: `old-${key}`,
        order: index,
        role: "user",
        text: `CASE_${key} shard${key} partition${key} segment${key} stores 3 replicas.`,
      });
    }
    for (let index = 0; index < 65; index += 1) {
      const key = String(index).padStart(2, "0");
      messages.push({
        id: `new-${key}`,
        order: index + 100,
        role: "user",
        text: `CASE_${key} shard${key} partition${key} segment${key} stores 5 replicas.`,
      });
    }
    messages.push({
      id: "padding",
      order: 200,
      role: "assistant",
      text: "Routine cache warmup completed.\n".repeat(4_000),
    });
    const observed: FactJudgeRequest[] = [];
    const perRequestTimeouts: number[] = [];
    let activeRequests = 0;
    let peakConcurrency = 0;
    const startedAt = performance.now();
    const result = await selectFacts(input(messages), async (request, _signal, remainingMs) => {
      observed.push(request);
      perRequestTimeouts.push(remainingMs);
      activeRequests += 1;
      peakConcurrency = Math.max(peakConcurrency, activeRequests);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return relationFor(request, () => "replaces");
      } finally {
        activeRequests -= 1;
      }
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result.kind).toBe("success");
    if (result.kind !== "success")
      throw new Error(`expected success, got ${result.kind}/${result.reason}`);
    expect(result.pairs).toHaveLength(65);
    expect(result.pairs.every((pair) => pair.relation === "replaces" && pair.retired)).toBe(true);
    expect(result.requests).toBe(observed.length);
    expect(result.requests).toBeGreaterThan(8);
    expect(elapsedMs).toBeGreaterThan(20);
    expect(peakConcurrency).toBe(FACT_SELECTOR_LIMITS.maxConcurrentRequests);
    expect(
      perRequestTimeouts.every((timeout) => timeout === FACT_SELECTOR_LIMITS.requestTimeoutMs),
    ).toBe(true);
    expect(observed.filter((request) => request.phase === "relations")).toHaveLength(5);
    expect(observed.filter((request) => request.phase === "safety")).toHaveLength(5);
    expect(
      observed.every(
        (request) =>
          request.serializedBytes <= FACT_SELECTOR_LIMITS.maxRequestBytes &&
          request.estimatedTokens <= FACT_SELECTOR_LIMITS.maxRequestEstimatedTokens &&
          Object.keys(request.questions).length <= FACT_SELECTOR_LIMITS.maxQuestionsPerRequest,
      ),
    ).toBe(true);
    expect(result.coverage.find((entry) => entry.sourceId === "old-64")?.disposition).toBe(
      "retired",
    );
    expect(result.coverage.find((entry) => entry.sourceId === "new-64")?.disposition).toBe(
      "retained",
    );
    expect(result.summary).toContain("CASE_64 shard64 partition64 segment64 stores 5 replicas.");
    expect(result.summary).not.toContain(
      "CASE_64 shard64 partition64 segment64 stores 3 replicas.",
    );
    for (const source of messages) assertSourceCoverage(result, source);
  });

  test("keeps support-only relations and low safety verification scores", async () => {
    const messages = appendPadding([
      { id: "support-old", order: 1, role: "user", text: "Search index retains 4 segments." },
      {
        id: "support-new",
        order: 2,
        role: "user",
        text: "Search index retains 4 segments and adds a checksum.",
      },
      { id: "unsafe-old", order: 3, role: "user", text: "Worker timeout is 8 seconds." },
      { id: "unsafe-new", order: 4, role: "user", text: "Worker timeout is 12 seconds." },
    ]);
    const result = await selectFacts(
      input(messages),
      replacingJudge(
        (request, instructions) =>
          request.phase === "relations" && instructions.includes('"support-old"')
            ? "supports"
            : "replaces",
        0.5,
      ),
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.summary).toContain("Search index retains 4 segments.");
    expect(result.summary).toContain("Worker timeout is 8 seconds.");
    expect(result.coverage.find((entry) => entry.sourceId === "support-old")?.disposition).toBe(
      "retained",
    );
    expect(result.coverage.find((entry) => entry.sourceId === "unsafe-old")?.disposition).toBe(
      "retained",
    );
  });

  test("rejects source identity collisions before calling the judge", async () => {
    let calls = 0;
    const result = await selectFacts(
      input([{ id: "duplicate", order: 1, role: "user", text: "A source." }], {
        tailEvidence: [{ id: "duplicate", order: 2, role: "user", text: "A different source." }],
      }),
      async () => {
        calls += 1;
        return { answers: {} };
      },
    );

    expect(result).toMatchObject({ kind: "refused", reason: "identity-collision", requests: 0 });
    expect(calls).toBe(0);
  });

  test("deduplicates exact text only when authority, scope, dependencies, and origin match", async () => {
    const fact = "The queue drains every 5 seconds.";
    const messages = appendPadding([
      { id: "same-a", order: 1, role: "user", text: fact },
      { id: "same-b", order: 2, role: "user", text: fact },
      { id: "other-scope", order: 3, role: "user", scope: "other", text: fact },
      { id: "other-authority", order: 4, role: "assistant", text: fact },
    ]);
    const result = await selectFacts(input(messages), replacingJudge());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(result.coverage.find((entry) => entry.sourceId === "same-b")?.disposition).toBe(
      "exact-dedup",
    );
    expect(result.coverage.find((entry) => entry.sourceId === "other-scope")?.disposition).toBe(
      "retained",
    );
    expect(result.coverage.find((entry) => entry.sourceId === "other-authority")?.disposition).toBe(
      "retained",
    );
  });

  test("includes named fact IDs and source metadata inside questions, not only question keys", async () => {
    const messages = appendPadding([
      {
        id: "older",
        order: 1,
        role: "user",
        dependencies: ["approval-v2"],
        text: "Cache region is north.",
      },
      {
        id: "newer",
        order: 2,
        role: "user",
        dependencies: ["approval-v2"],
        text: "Cache region is south.",
      },
    ]);
    const requests: FactJudgeRequest[] = [];
    const result = await selectFacts(input(messages), async (request) => {
      requests.push(request);
      return relationFor(request, () => "replaces");
    });

    expect(result.kind).toBe("success");
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      for (const [key, question] of Object.entries(request.questions)) {
        expect(key).toMatch(/^q\d+$/u);
        expect(question.instructions).toContain('SOURCE_FACT_ID="f');
        expect(question.instructions).toContain('WITNESS_FACT_ID="f');
        expect(question.instructions).toContain('"sourceIdentity":"older"');
        expect(question.instructions).toContain('"sourceIdentity":"newer"');
        expect(question.instructions).toContain('"dependencies":["approval-v2"]');
      }
      expect(request.serializedBytes).toBeLessThanOrEqual(FACT_SELECTOR_LIMITS.maxRequestBytes);
      expect(request.estimatedTokens).toBeLessThanOrEqual(
        FACT_SELECTOR_LIMITS.maxRequestEstimatedTokens,
      );
      expect(request.estimatedTokens).toBe(Math.ceil(request.serializedBytes / 3));
    }
  });

  test("splits large evidence into bounded requests", async () => {
    const messages: Array<FactInput["messages"][number]> = [];
    for (let index = 0; index < 18; index += 1) {
      const key = String(index).padStart(2, "0");
      const padding = "note ".repeat(1_000);
      messages.push({
        id: `large-old-${key}`,
        order: index,
        role: "user",
        text: `Service shard CASE_${key} uses a legacy region ${padding}old.`,
      });
      messages.push({
        id: `large-new-${key}`,
        order: index + 100,
        role: "user",
        text: `Service shard CASE_${key} uses a current region ${padding}new.`,
      });
    }
    messages.push({
      id: "padding",
      order: 200,
      role: "assistant",
      text: "Routine cache warmup completed.\n".repeat(3_000),
    });
    let calls = 0;
    const result = await selectFacts(input(messages), async (request) => {
      expect(request.serializedBytes).toBeLessThanOrEqual(FACT_SELECTOR_LIMITS.maxRequestBytes);
      expect(Object.keys(request.questions).length).toBeLessThanOrEqual(16);
      calls += 1;
      return relationFor(request, () => "replaces");
    });

    expect(result.kind).toBe("success");
    expect(calls).toBeGreaterThan(8);
    if (result.kind === "success") {
      for (const source of messages) assertSourceCoverage(result, source);
    }
  });

  test("rejects malformed wave answers atomically", async () => {
    let calls = 0;
    const result = await selectFacts(
      input(
        appendPadding([
          { id: "old", order: 1, role: "user", text: "The cache TTL is 3 seconds." },
          { id: "new", order: 2, role: "user", text: "The cache TTL is 7 seconds." },
        ]),
      ),
      async () => {
        calls += 1;
        return { answers: {} };
      },
    );

    expect(result).toMatchObject({ kind: "refused", reason: "malformed-judge", requests: 1 });
    expect(result).not.toHaveProperty("summary");
    expect(calls).toBe(1);
  });

  test("treats cancellation during a request as terminal with no fallback", async () => {
    const controller = new AbortController();
    const request = selectFacts(
      input(
        appendPadding([
          { id: "old", order: 1, role: "assistant", text: "The cache TTL is 3 seconds." },
          { id: "new", order: 2, role: "assistant", text: "The cache TTL is 7 seconds." },
        ]),
      ),
      (judgeRequest, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve(relationFor(judgeRequest, () => "replaces")),
            {
              once: true,
            },
          );
        }),
      { signal: controller.signal },
    );
    controller.abort();
    const result = await request;

    expect(result).toMatchObject({ kind: "cancelled", reason: "caller-cancellation" });
    expect(result).not.toHaveProperty("summary");
  });

  test("reports a per-request timeout as unavailable without retrying", async () => {
    let calls = 0;
    const result = await selectFacts(
      input(
        appendPadding([
          { id: "old", order: 1, role: "assistant", text: "The cache TTL is 3 seconds." },
          { id: "new", order: 2, role: "assistant", text: "The cache TTL is 7 seconds." },
        ]),
      ),
      async () => {
        calls += 1;
        return new Promise(() => {});
      },
    );

    expect(result).toMatchObject({ kind: "unavailable", reason: "timeout" });
    expect(result).not.toHaveProperty("summary");
    expect(calls).toBe(1);
  });

  test("refuses irreducible content and insufficient supplied Pi capacity without truncation", async () => {
    const large = Array.from(
      { length: 120 },
      (_, index) => `Legal obligation ${index} must be retained verbatim.\n`,
    ).join("");
    const irreducible = await selectFacts(
      input([{ id: "legal", order: 1, role: "user", text: large }]),
      replacingJudge(() => "unknown"),
    );
    expect(irreducible).toMatchObject({ kind: "refused", reason: "irreducible" });

    const reducible = await selectFacts(
      input(
        appendPadding([
          { id: "old", order: 1, role: "user", text: "The cache TTL is 3 seconds." },
          { id: "new", order: 2, role: "user", text: "The cache TTL is 7 seconds." },
        ]),
        { piTokenBudget: 1 },
      ),
      replacingJudge(),
    );
    expect(reducible).toMatchObject({ kind: "refused", reason: "capacity" });
    expect(reducible).not.toHaveProperty("summary");
  });
});
