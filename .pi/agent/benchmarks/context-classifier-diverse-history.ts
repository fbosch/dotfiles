import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DEFAULT_SETTINGS } from "../extensions/context-masking/policy";
import { autonomousStages } from "./context-classifier-autonomous-history";
import type { RecallFixture, RecallProbe } from "./context-classifier-recall-fixtures";

export interface DiverseStage extends RecallFixture {
  tools: Array<"read" | "bash">;
  images: Array<{ data: string; mimeType: "image/png"; label: string }>;
}

const token = (seed: string, name: string) =>
  createHash("sha256").update(`${seed}:${name}`).digest("hex").slice(0, 8);

const padded = (text: string) => {
  const background = "trace: closed background check; no decisions\n".repeat(15);
  const output = `${background}${text}\n${background}`;
  if (output.length < DEFAULT_SETTINGS.minResultChars) throw Error("Diverse output cannot be masked");
  return output;
};

function panel(code: string, color: string): string {
  return execFileSync("/run/current-system/sw/bin/magick", [
    "-size", "640x320", "xc:white", "-fill", color,
    "-draw", "rectangle 420,205 610,295", "-fill", "black",
    "-font", "DejaVu-Sans-Bold", "-pointsize", "48", "-gravity", "NorthWest",
    "-annotate", "+24+48", code, "-strip", "png:-",
  ], { maxBuffer: 2_000_000 }).toString("base64");
}

export function diverseStages(seed: string): DiverseStage[] {
  const stages = autonomousStages(seed);
  const release = `release_${token(seed, "release")}`;
  const owner = `owner_${token(seed, "owner")}`;
  const retry = String(3 + Number.parseInt(token(seed, "retry").slice(0, 2), 16) % 7);
  const batch = String(40 + Number.parseInt(token(seed, "batch").slice(0, 2), 16));
  const policyOld = `policy_${token(seed, "policy-old")}`;
  const policy = `policy_${token(seed, "policy-new")}`;
  const digest = `sha256:${token(seed, "diagnostic")}`;
  const ticket = `ticket_${token(seed, "ticket")}`;
  const oldCode = `IMG-${token(seed, "panel-old").toUpperCase()}`;
  const code = `IMG-${token(seed, "panel-new").toUpperCase()}`;
  const colors = ["blue", "green", "orange"] as const;
  const color = colors[Number.parseInt(token(seed, "color").slice(0, 2), 16) % colors.length];
  if (!color) throw Error("Missing panel color");

  const probes: RecallProbe[] = [
    { id: "release", category: "current", source: "conversation", expected: release,
      question: "What release_channel did the user approve for the ledger exporter?" },
    { id: "owner", category: "current", source: "conversation", expected: owner,
      question: "Who owns the approved rollback plan for the ledger exporter? Return the owner ID." },
    { id: "retry", category: "current", source: "read", expected: retry,
      question: "What retry_ceiling did the exporter configuration specify? Return the number as a string." },
    { id: "batch", category: "current", source: "read", expected: batch,
      question: "What batch_limit did the exporter configuration specify? Return the number as a string." },
    { id: "policy", category: "current", source: "read", expected: policy, rejected: policyOld,
      question: "What is the latest approved checkpoint_policy in the exporter configuration?" },
    { id: "diagnostic", category: "current", source: "bash", expected: digest,
      question: "What diagnostic_digest was printed by the one-time export check?" },
    { id: "ticket", category: "surprise", source: "bash", expected: ticket,
      question: "What incident_ticket did the completed one-time harbor audit print?" },
    { id: "panel", category: "current", source: "image", expected: code, rejected: oldCode,
      question: "What code is printed in the latest inspection panel image?" },
    { id: "tile", category: "current", source: "image", expected: color,
      question: "What color fills the lower-right tile of the latest inspection panel image?" },
  ];

  return stages.map((stage, phase): DiverseStage => {
    const extras = phase === 0 ? [
      `Exporter config: retry_ceiling=${retry}.`,
      `Exporter config: batch_limit=${batch}.`,
      `Exporter config revision 1: approved checkpoint_policy=${policyOld}.`,
      `One-time export check (script removed): diagnostic_digest=${digest}.`,
      `Completed harbor audit (script removed): incident_ticket=${ticket}.`,
    ] : phase === 2 ? [
      `Exporter config revision 3 FINAL APPROVED checkpoint_policy=${policy}. Explicitly replaces the earlier checkpoint_policy=${policyOld}.`,
    ] : [];
    const images = phase === 0
      ? [{ data: panel(oldCode, "red"), mimeType: "image/png" as const,
          label: "Inspection panel revision 1; later panels supersede its code and tile." }]
      : phase === 2
        ? [{ data: panel(code, color), mimeType: "image/png" as const,
            label: "Inspection panel revision 3; read its printed code and lower-right tile pixels." }]
        : [];
    const goal = phase === 0
      ? `${stage.goal} User approval: release_channel=${release}; rollback owner=${owner}. Refer to the attached inspection panel for its code and tile color.`
      : `${stage.goal} The latest inspection panel supersedes revision 1 when present; its code and tile color are visible only in its pixels.`;
    // Seeded order keeps call position from identifying which output holds an active fact.
    const pairs = [
      ...stage.outputs.map(text => ({ text, tool: "read" as const })),
      ...extras.map((text, i) => ({ text: padded(text), tool: phase === 0 && i >= 3 ? "bash" as const : "read" as const })),
    ].sort((a, b) => token(seed, `${phase}:${a.text}`).localeCompare(token(seed, `${phase}:${b.text}`)));
    return {
      ...stage, goal,
      outputs: pairs.map(pair => pair.text),
      tools: pairs.map(pair => pair.tool),
      images,
      probes: [...stage.probes, ...probes],
    };
  });
}
