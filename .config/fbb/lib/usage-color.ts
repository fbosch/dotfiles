import type { InspectColor } from "node:util";

export function usageColor(remainingPercent: number): InspectColor {
	if (remainingPercent > 50) {
		return "green";
	}
	if (remainingPercent > 20) {
		return "yellow";
	}
	return "red";
}
