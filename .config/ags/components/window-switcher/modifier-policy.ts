const modifierKeys = {
	SUPER: [65515, 65516],
	ALT: [65513, 65514],
	CTRL: [65507, 65508],
	SHIFT: [65505, 65506],
} as const;

export type ModifierName = keyof typeof modifierKeys;

export function normalizeModifier(name: string): ModifierName {
	const normalized = name.toUpperCase();
	if (normalized === "SUPER" || normalized === "SHIFT") return normalized;
	if (normalized === "CTRL" || normalized === "CONTROL") return "CTRL";
	return "ALT";
}

export function isTriggerModifierKey(name: string, keyval: number): boolean {
	return modifierKeys[normalizeModifier(name)].includes(keyval as never);
}
