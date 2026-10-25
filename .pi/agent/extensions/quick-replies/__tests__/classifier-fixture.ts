import { afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import type { ClassifierFetch } from "../../../lib/classifier";

export interface ClassifierVerdicts {
  readonly scores?: readonly number[];
  readonly labelMatches?: readonly number[];
}

const DEFAULT_SCORE = 2;
const DEFAULT_LABEL_MATCH = 0.95;
const QUESTION_ID = /^candidate_(\d+)(_label_match)?$/u;

/** Answers every question in the System One request, so candidate filtering cannot desync the answer count. */
export function classifierFetch(verdicts: ClassifierVerdicts = {}): ClassifierFetch {
  return async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { questions?: object };
    const answers = Object.fromEntries(
      Object.keys(payload.questions ?? {}).map((id) => {
        const match = QUESTION_ID.exec(id);
        if (match === null) throw new Error(`Unexpected classifier question ${id}`);
        const index = Number(match[1]);
        if (match[2] !== undefined) {
          return [
            id,
            { type: "noul", noul: verdicts.labelMatches?.[index] ?? DEFAULT_LABEL_MATCH },
          ];
        }
        return [
          id,
          { type: "score", score: verdicts.scores?.[index] ?? DEFAULT_SCORE, confidence: 0.5 },
        ];
      }),
    );
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers }));
  };
}

/** Points Pi at a temporary agent directory whose settings route classification to a native fixture. */
export async function createClassifierTestRegistry(): Promise<ModelRegistry> {
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  const agentDirectory = mkdtempSync(join(tmpdir(), "quick-replies-classifier-test-"));
  writeFileSync(
    join(agentDirectory, "settings.json"),
    JSON.stringify({
      classifier: { providers: [{ provider: "openrouter", model: "typesafe/jev-1.13" }] },
    }),
  );
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  afterAll(() => {
    if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    rmSync(agentDirectory, { recursive: true, force: true });
  });
  return createNativeClassifierRegistry();
}

export function classifierMethods(
  registry: ModelRegistry,
  onClassifierInput?: (input: ClassifierContext) => void,
): Pick<ModelRegistry, "findOfType" | "classify"> {
  return {
    findOfType: registry.findOfType.bind(registry),
    classify: (model, input, options) => {
      onClassifierInput?.(input);
      return registry.classify(model, input, options);
    },
  };
}
