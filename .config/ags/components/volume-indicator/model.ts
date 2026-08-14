export type SpeakerState =
	| "muted"
	| "verylow"
	| "low"
	| "medium"
	| "high"
	| "veryhigh";

export interface VolumeInfo {
	volume: number;
	muted: boolean;
}

export interface VolumePresentation extends VolumeInfo {
	speakerState: SpeakerState;
	icon: string;
	label: string;
	filledSegments: number;
}

export const totalSegments = 16;

const speakerIcons: Record<SpeakerState, string> = {
	muted: "\uE74F",
	verylow: "\uE992",
	low: "\uE993",
	medium: "\uE994",
	high: "\uE995",
	veryhigh: "\uE995",
};

export function parseWpctlVolume(output: string): VolumeInfo {
	const match = output.match(/Volume:\s+([\d.]+)/);
	return {
		volume: match ? Math.round(Number.parseFloat(match[1]) * 100) : 0,
		muted: output.includes("[MUTED]"),
	};
}

function getSpeakerState(
	volume: number,
	muted: boolean,
): SpeakerState {
	if (muted || volume === 0) return "muted";
	if (volume <= 15) return "verylow";
	if (volume <= 25) return "low";
	if (volume <= 50) return "medium";
	if (volume <= 75) return "high";
	return "veryhigh";
}

export function createVolumePresentation({
	volume,
	muted,
}: VolumeInfo): VolumePresentation {
	const clampedVolume = Math.max(0, Math.min(100, volume));
	const speakerState = getSpeakerState(clampedVolume, muted);
	return {
		volume: clampedVolume,
		muted,
		speakerState,
		icon: speakerIcons[speakerState],
		label: muted ? "Muted" : `${clampedVolume}%`,
		filledSegments: muted
			? 0
			: Math.round((clampedVolume / 100) * totalSegments),
	};
}

export function shouldPlayVolumeSound(
	previous: VolumePresentation | null,
	next: VolumePresentation,
): boolean {
	return (
		previous !== null &&
		next.speakerState !== "muted" &&
		previous.filledSegments !== next.filledSegments
	);
}
