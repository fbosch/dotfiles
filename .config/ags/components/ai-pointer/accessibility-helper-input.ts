import {
	accessibilityCoordinateSpace,
	accessibilityProtocolVersion,
} from "./accessibility-helper-protocol";
import { maximumStrokePoints } from "./stroke";

const maximumBrushRadius = 128;

export interface HelperGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface HelperPoint {
	x: number;
	y: number;
}

export interface AccessibilityHelperInput {
	protocolVersion: typeof accessibilityProtocolVersion;
	coordinateSpace: typeof accessibilityCoordinateSpace;
	pid: number;
	windowWidth: number;
	windowHeight: number;
	windowTitle?: string;
	selection: HelperGeometry;
	stroke: {
		points: HelperPoint[];
		radius: number;
	};
}

export function parseAccessibilityHelperInput(args: string[]): AccessibilityHelperInput | null {
	if (args.length !== 1) return null;
	try {
		const input: unknown = JSON.parse(args[0]);
		if (!isRecord(input) || !isRecord(input.selection) || !isRecord(input.stroke)) return null;
		if (
			input.protocolVersion !== accessibilityProtocolVersion ||
			input.coordinateSpace !== accessibilityCoordinateSpace ||
			validInteger(input.pid) === false ||
			input.pid <= 0 ||
			validInteger(input.windowWidth) === false ||
			validInteger(input.windowHeight) === false ||
			input.windowWidth <= 0 ||
			input.windowHeight <= 0 ||
			(input.windowTitle !== undefined &&
				(typeof input.windowTitle !== "string" ||
					input.windowTitle.length === 0 ||
					input.windowTitle.length > 160 ||
					/[\u0000-\u001f\u007f]/.test(input.windowTitle))) ||
			validInteger(input.selection.x) === false ||
			validInteger(input.selection.y) === false ||
			validInteger(input.selection.width) === false ||
			validInteger(input.selection.height) === false ||
			input.selection.width <= 0 ||
			input.selection.height <= 0
		)
			return null;
		if (
			Array.isArray(input.stroke.points) === false ||
			input.stroke.points.length < 2 ||
			input.stroke.points.length > maximumStrokePoints ||
			validInteger(input.stroke.radius) === false ||
			input.stroke.radius <= 0 ||
			input.stroke.radius > maximumBrushRadius ||
			input.stroke.points.some(
				(point) =>
					!isRecord(point) ||
					validInteger(point.x) === false ||
					validInteger(point.y) === false,
			)
		)
			return null;
		return {
			protocolVersion: accessibilityProtocolVersion,
			coordinateSpace: accessibilityCoordinateSpace,
			pid: input.pid,
			windowWidth: input.windowWidth,
			windowHeight: input.windowHeight,
			windowTitle: input.windowTitle,
			selection: {
				x: input.selection.x,
				y: input.selection.y,
				width: input.selection.width,
				height: input.selection.height,
			},
			stroke: {
				points: input.stroke.points.map((point) => ({
					x: (point as { x: number }).x,
					y: (point as { y: number }).y,
				})),
				radius: input.stroke.radius,
			},
		};
	} catch {
		return null;
	}
}

function validInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
