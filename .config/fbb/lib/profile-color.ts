const darkPalette = [
	39, 45, 51, 75, 81, 87, 111, 117, 123, 159, 195, 214, 220, 226,
];
const lightPalette = [18, 19, 20, 22, 23, 24, 52, 53, 54, 88, 89, 90, 94, 124];

export function profileColor(accountId: string): number {
	const seed = accountId.replace(/[^0-9a-fA-F]/g, "") || "00";
	const palette = backgroundMode() === "light" ? lightPalette : darkPalette;
	return palette[byteAt(seed, 4) % palette.length];
}

export function colorProfileName(
	name: string,
	color: number | null,
	colorEnabled: boolean,
): string {
	if (color === null || colorEnabled === false) {
		return name;
	}
	return `\u001b[1;38;5;${color}m${name}\u001b[0m`;
}

function backgroundMode(): "dark" | "light" {
	const background = process.env.COLORFGBG?.split(";").at(-1);
	return background && /^\d+$/.test(background) && Number(background) > 7
		? "light"
		: "dark";
}

function byteAt(seed: string, offset: number): number {
	return Number.parseInt(seed.slice(offset, offset + 2) || "00", 16);
}
