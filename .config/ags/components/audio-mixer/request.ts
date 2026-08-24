import { isMatching, P } from "ts-pattern";
import { createPreparationRequestPattern } from "@/services/preparation-intent";

export const audioMixerPreparationSource = "waybar:pulseaudio" as const;
export type AudioMixerPreparationSource = typeof audioMixerPreparationSource;

const requestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "toggle" },
	{ action: "is-visible" },
	{ action: "set-tab", tab: P.union("playback", "output", "input") },
	createPreparationRequestPattern(audioMixerPreparationSource),
);

export type AudioMixerRequest = P.infer<typeof requestPattern>;

export function parseAudioMixerRequest(
	value: unknown,
): AudioMixerRequest | null {
	return isMatching(requestPattern, value) ? value : null;
}
