import stylelint from "stylelint";

const ruleName = "ags/feature-surface-scope";
const messages = stylelint.utils.ruleMessages(ruleName, {
	structure:
		'Feature styles must use "../../styles/surface" as ags and contain one top-level @include ags.surface("feature-class") block',
	unsafeInclude: "Feature styles cannot include mixins outside the surface block",
});

const surfaceUse = '"../../styles/surface" as ags';
const surfaceInclude = /^ags\.surface\("[a-z][a-z0-9-]*"\)$/;

const rule = (enabled) => (root, result) => {
	if (enabled !== true) return;

	const nodes = root.nodes.filter((node) => node.type !== "comment");
	const uses = nodes.filter(
		(node) => node.type === "atrule" && node.name === "use",
	);
	const topLevelIncludes = nodes.filter(
		(node) => node.type === "atrule" && node.name === "include",
	);
	const surface = topLevelIncludes.find((node) =>
		surfaceInclude.test(node.params),
	);
	const surfaceNodes = surface?.nodes?.filter((node) => node.type !== "comment");
	const validStructure =
		uses.some((node) => node.params === surfaceUse) &&
		topLevelIncludes.length === 1 &&
		nodes.every((node) => node.name === "use" || node === surface) &&
		Array.isArray(surfaceNodes) &&
		surfaceNodes.length > 0;

	if (validStructure === false)
		stylelint.utils.report({
			ruleName,
			result,
			node: root,
			message: messages.structure,
		});

	topLevelIncludes.forEach((atRule) => {
		if (atRule === surface) return;
		stylelint.utils.report({
			ruleName,
			result,
			node: atRule,
			message: messages.unsafeInclude,
		});
	});
};

rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
