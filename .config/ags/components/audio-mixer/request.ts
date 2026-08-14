import { isMatching, P } from "ts-pattern";

const requestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "toggle" },
	{ action: "is-visible" },
	{ action: "set-tab", tab: P.union("playback", "output", "input") },
);

export type AudioMixerRequest = P.infer<typeof requestPattern>;

export function parseAudioMixerRequest(
	value: unknown,
): AudioMixerRequest | null {
	return isMatching(requestPattern, value) ? value : null;
}
