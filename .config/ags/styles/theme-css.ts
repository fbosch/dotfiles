import tokens from "../../../design-system/tokens.json";

export const themeCss = `
:root {
  --ags-color-background-primary: ${tokens.colors.background.primary.value};
  --ags-color-background-secondary: ${tokens.colors.background.secondary.value};
  --ags-color-background-tertiary: ${tokens.colors.background.tertiary.value};
  --ags-color-foreground-primary: ${tokens.colors.foreground.primary.value};
  --ags-color-foreground-secondary: ${tokens.colors.foreground.secondary.value};
  --ags-color-foreground-tertiary: ${tokens.colors.foreground.tertiary.value};
  --ags-color-accent-primary: ${tokens.colors.accent.primary.value};
  --ags-color-accent-hover: ${tokens.colors.accent.hover.value};
  --ags-color-accent-text: ${tokens.colors.accent.text.value};
  --ags-color-state-error: ${tokens.colors.state.error.value};
  --ags-color-state-error-hover: ${tokens.colors.state["error-hover"].value};
  --ags-color-state-warning: ${tokens.colors.state.warning.value};
  --ags-color-state-warning-hover: ${tokens.colors.state["warning-hover"].value};
  --ags-color-state-warning-text: ${tokens.colors.state["warning-text"].value};
  --ags-color-state-purple: ${tokens.colors.state.purple.value};
  --ags-color-state-purple-hover: ${tokens.colors.state["purple-hover"].value};
  --ags-color-state-purple-text: ${tokens.colors.state["purple-text"].value};
  --ags-color-state-success: ${tokens.colors.state.success.value};
  --ags-color-state-success-text: ${tokens.colors.state["success-text"].value};
  --ags-color-border-default: ${tokens.colors.border.default.value};
  --ags-color-border-hover: ${tokens.colors.border.hover.value};
  --ags-font-primary: "${tokens.typography.fontFamily.primary.value}";
  --ags-font-button: "${tokens.typography.fontFamily.button.value}";
  --ags-font-symbols: "${tokens.typography.fontFamily.symbols.value}";
}
`;
