import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

const runtimeArtifactVariables = {
	aboutThisPCExecutable: "AGS_ABOUT_THIS_PC_EXECUTABLE_PATH",
	aiPointerAccessibilityHelper: "AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH",
	aiPointerModule: "AGS_AI_POINTER_MODULE_PATH",
} as const;

export type RuntimeArtifactId = keyof typeof runtimeArtifactVariables;

export function runtimeArtifactPath(id: RuntimeArtifactId): string | null {
	return GLib.getenv(runtimeArtifactVariables[id]);
}

export function requireRuntimeArtifactPath(id: RuntimeArtifactId): string {
	const variable = runtimeArtifactVariables[id];
	const path = GLib.getenv(variable);
	if (!path) throw new Error(`${variable} is unavailable`);
	return path;
}

export function requireRuntimeArtifactUri(id: RuntimeArtifactId): string {
	return Gio.File.new_for_path(requireRuntimeArtifactPath(id)).get_uri();
}
