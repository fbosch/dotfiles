# Validation Checklist

Before committing components:

1. No custom CSS classes (except global resets)
2. All styles use Tailwind utilities
3. CVA uses proper composition (no duplicate styles)
4. `cn()` used for conditional classes
5. Design tokens referenced via Tailwind theme
6. No custom spacing/font-size/letter-spacing tokens for single features
7. Standard Tailwind scales used (`text-sm`, `p-2`, `tracking-wide`)
8. All buttons have `type` attribute
9. Storybook story created with multiple variants
10. Component exports interface for composition
