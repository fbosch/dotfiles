import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdrNeovimAgentState from "./neovim-agent-state";
import herdrPermissionState from "./permission-state";
import herdrSessionCwd from "./session-cwd";
import herdrSessionName from "./session-name";

export default function herdr(pi: ExtensionAPI): void {
  herdrNeovimAgentState(pi);
  herdrPermissionState(pi);
  herdrSessionCwd(pi);
  herdrSessionName(pi);
}
