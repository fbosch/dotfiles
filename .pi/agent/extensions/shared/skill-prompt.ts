import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";

const START = "<available_skills>";
const END = "</available_skills>";

export function replaceSkillCatalog(
  prompt: string,
  skills: readonly Skill[],
  readTool: "read" | "bash",
): string {
  const start = prompt.indexOf(START);
  if (start < 0) return prompt;
  const end = prompt.indexOf(END, start);
  if (end < 0) throw new Error("Skill catalog is missing its closing tag");
  // Preserve the host's wrapper and routing prose; SDK and installed Pi versions may format them differently.
  const formatted = formatSkillsForPrompt([...skills], readTool);
  const replacementStart = formatted.indexOf(START);
  const replacementEnd = formatted.indexOf(END, replacementStart);
  const replacement =
    replacementStart < 0 ? "" : formatted.slice(replacementStart, replacementEnd + END.length);
  return prompt.slice(0, start) + replacement + prompt.slice(end + END.length);
}
