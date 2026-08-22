import { queryHyprlandJson } from "@/services/hyprland-ipc";
import type { PointerPosition } from "./selection";

export function readPointerPosition(): PointerPosition | null {
	const position = queryHyprlandJson<{ x?: unknown; y?: unknown }>("j/cursorpos", {
		component: "ai-pointer",
		metric: "strokeCursorPosition",
	});
	if (
		typeof position?.x !== "number" ||
		typeof position.y !== "number" ||
		Number.isSafeInteger(position.x) === false ||
		Number.isSafeInteger(position.y) === false
	)
		return null;
	return { x: position.x, y: position.y };
}
