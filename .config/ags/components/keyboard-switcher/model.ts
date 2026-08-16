export type KeyboardSwitcherSize = "sm" | "md" | "lg";

export interface LayoutSwitchConfig {
	layouts: string[];
	activeLayout: string;
	size?: KeyboardSwitcherSize;
}

interface SizeConfig {
	containerPadding: string;
	badgePaddingX: string;
	badgePaddingY: string;
	fontSize: string;
	minWidth: string;
	gap: string;
}

export interface CalculatedDimensions {
	fullBadgeWidth: number;
	fullBadgeHeight: number;
	pillOffset: number;
	innerWidth: number;
	containerWidth: number;
	gap: number;
}

const sizeConfigs: Record<KeyboardSwitcherSize, SizeConfig> = {
	sm: {
		containerPadding: "4px",
		badgePaddingX: "8px",
		badgePaddingY: "6px",
		fontSize: "14px",
		minWidth: "56px",
		gap: "4px",
	},
	md: {
		containerPadding: "6px",
		badgePaddingX: "20px",
		badgePaddingY: "8px",
		fontSize: "16px",
		minWidth: "64px",
		gap: "6px",
	},
	lg: {
		containerPadding: "8px",
		badgePaddingX: "24px",
		badgePaddingY: "12px",
		fontSize: "18px",
		minWidth: "80px",
		gap: "8px",
	},
};

function calculateDimensions(config: SizeConfig): CalculatedDimensions {
	const badgeWidth = Number.parseInt(config.minWidth, 10);
	const badgePaddingX = Number.parseInt(config.badgePaddingX, 10);
	const badgePaddingY = Number.parseInt(config.badgePaddingY, 10);
	const gap = Number.parseInt(config.gap, 10);
	const fontSize = Number.parseInt(config.fontSize, 10);
	const fullBadgeWidth = badgeWidth + badgePaddingX * 2 + 2;
	const fullBadgeHeight = fontSize + badgePaddingY * 2 + 2;
	const innerWidth = fullBadgeWidth * 2;
	const containerPadding = Number.parseInt(config.containerPadding, 10);
	return {
		fullBadgeWidth,
		fullBadgeHeight,
		pillOffset: fullBadgeWidth + gap,
		innerWidth,
		containerWidth: innerWidth + containerPadding * 2,
		gap,
	};
}

export const calculatedSizes: Record<
	KeyboardSwitcherSize,
	CalculatedDimensions
> = {
	sm: calculateDimensions(sizeConfigs.sm),
	md: calculateDimensions(sizeConfigs.md),
	lg: calculateDimensions(sizeConfigs.lg),
};

const maxLayoutCount = 8;
const layoutCodePattern = /^[A-Za-z0-9]{1,3}$/;

export function haveSameLayouts(current: string[], next: string[]): boolean {
	return (
		current.length === next.length &&
		current.every((layout, index) => layout === next[index])
	);
}

export function isValidLayoutSwitchConfig(config: LayoutSwitchConfig): boolean {
	return (
		config.layouts.length > 0 &&
		config.layouts.length <= maxLayoutCount &&
		new Set(config.layouts).size === config.layouts.length &&
		config.layouts.every((layout) => layoutCodePattern.test(layout)) &&
		config.layouts.includes(config.activeLayout)
	);
}

export function layoutGeometry(
	size: KeyboardSwitcherSize,
	layoutCount: number,
): { innerWidth: number; containerWidth: number; offsets: number[] } {
	const dimensions = calculatedSizes[size];
	const count = Math.max(1, layoutCount);
	// Gtk.Box already includes child spacing in its natural width.
	const innerWidth = dimensions.fullBadgeWidth * count;
	const containerPadding = Number.parseInt(
		sizeConfigs[size].containerPadding,
		10,
	);
	return {
		innerWidth,
		containerWidth: innerWidth + containerPadding * 2,
		offsets: Array.from(
			{ length: count },
			(_, index) => index * dimensions.pillOffset,
		),
	};
}
