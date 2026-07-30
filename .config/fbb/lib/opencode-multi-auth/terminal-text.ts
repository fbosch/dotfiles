export function escapeTerminalText(value: string): string {
	return Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) || 0;
		if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
			return `\\x${codePoint.toString(16).padStart(2, "0")}`;
		}
		return character;
	}).join("");
}
