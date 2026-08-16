import tokens from "../../../design-system/tokens.json";

export const themeCss = `
:root {
  --ags-color-background-primary: ${tokens.colors.background.primary.value};
  --ags-color-background-secondary: ${tokens.colors.background.secondary.value};
  --ags-color-foreground-primary: ${tokens.colors.foreground.primary.value};
  --ags-color-foreground-secondary: ${tokens.colors.foreground.secondary.value};
  --ags-color-foreground-tertiary: ${tokens.colors.foreground.tertiary.value};
  --ags-color-accent-primary: ${tokens.colors.accent.primary.value};
  --ags-color-accent-text: ${tokens.colors.accent.text.value};
  --ags-color-state-error: ${tokens.colors.state.error.value};
  --ags-font-primary: "${tokens.typography.fontFamily.primary.value}";
}
`;
