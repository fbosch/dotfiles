/** @type {import("stylelint").Config} */
export default {
	extends: ["stylelint-config-standard-scss"],
	plugins: ["./styles/stylelint-surface-scope.mjs"],
	rules: {
		"alpha-value-notation": null,
		"color-function-notation": null,
		"font-family-name-quotes": null,
		"no-descending-specificity": null,
		"selector-type-no-unknown": [
			true,
			{
				ignoreTypes: [
					"box",
					"button",
					"image",
					"label",
					"overlay",
					"picture",
					"scrolledwindow",
					"separator",
					"window",
				],
			},
		],
	},
	overrides: [
		{
			files: ["components/**/*.scss"],
			rules: {
				"ags/feature-surface-scope": true,
				"max-nesting-depth": 4,
			},
		},
	],
};
