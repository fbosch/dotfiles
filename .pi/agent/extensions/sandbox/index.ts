import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSandboxGuidance } from "./prompt";

export default function sandbox(pi: ExtensionAPI): void {
  registerSandboxGuidance(pi);
}
