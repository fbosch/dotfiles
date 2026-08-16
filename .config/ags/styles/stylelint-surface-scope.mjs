import stylelint from "stylelint";

const ruleName = "ags/feature-surface-scope";
const messages = stylelint.utils.ruleMessages(ruleName, {
	structure:
		'Feature styles must contain only @use "../../styles/surface" as ags and one @include ags.surface("feature-class") block',
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
	const includes = nodes.filter(
		(node) => node.type === "atrule" && node.name === "include",
	);
	const surface = includes[0];
	const surfaceNodes = surface?.nodes?.filter((node) => node.type !== "comment");
	const validStructure =
		nodes.length === 2 &&
		uses.length === 1 &&
		uses[0].params === surfaceUse &&
		includes.length === 1 &&
		surfaceInclude.test(surface?.params ?? "") &&
		Array.isArray(surfaceNodes) &&
		surfaceNodes.length > 0;

	if (validStructure === false)
		stylelint.utils.report({
			ruleName,
			result,
			node: root,
			message: messages.structure,
		});

	root.walkAtRules((atRule) => {
		if (atRule === uses[0] || atRule === surface) return;
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
