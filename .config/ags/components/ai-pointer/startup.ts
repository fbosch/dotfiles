import { evaluateHyprland } from "@/services/hyprland-ipc";
import { prepareCaptureDirectory } from "./capture";

export function resetAiPointerStartupState(): void {
	prepareCaptureDirectory();
	evaluateHyprland("hl.plugin.cursor_outline.off()", {
		component: "ai-pointer",
		metric: "cursorOutline",
	});
}
