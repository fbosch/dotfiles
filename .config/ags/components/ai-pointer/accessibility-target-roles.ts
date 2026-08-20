const eligibleRoles = new Set([
	"article",
	"check box",
	"combo box",
	"entry",
	"heading",
	"icon",
	"image",
	"link",
	"list item",
	"menu item",
	"page tab",
	"paragraph",
	"push button",
	"radio button",
	"section",
	"slider",
	"spin button",
	"table cell",
	"text",
	"toggle button",
]);

const actionRoles = new Set([
	"check box",
	"combo box",
	"entry",
	"link",
	"menu item",
	"page tab",
	"push button",
	"radio button",
	"slider",
	"spin button",
	"toggle button",
]);

export const commonAncestorRoles = new Set(["article", "list item", "section"]);
export const directTargetPriority = new Map([
	["link", 0],
	["image", 1],
]);

export function isEligibleAccessibilityRole(role: string): boolean {
	return eligibleRoles.has(role.trim().toLowerCase());
}

export function accessibilityRegionRolePriority(role: string): number {
	const normalized = role.trim().toLowerCase();
	if (actionRoles.has(normalized)) return 0;
	if (normalized === "icon" || normalized === "image") return 1;
	if (commonAncestorRoles.has(normalized)) return 3;
	return 2;
}
