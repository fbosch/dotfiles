# Interactions and Spacing

## Button hierarchy

Seven variants with decreasing visual weight:

1. Default
2. Primary
3. Success
4. Warning
5. Danger
6. Outline
7. Ghost

## Interaction states

- Hover: color shift + optional shadow enhancement
- Focus: 2px outline with offset for keyboard visibility
- Active: scale 0.98 for press feedback
- Disabled: 40% opacity with cursor change

## Micro-interactions

- `transition-all duration-150`
- `active:scale-[0.98]`
- `shadow-sm hover:shadow`
- `focus-visible` (avoid `focus`)

## Accessibility considerations

Contrast issues to address:

- Success button: 2.29:1
- Warning button: 2.17:1
- Danger button: 3.78:1

Recommendation: darken state colors or adjust text color to achieve 4.5:1.

Accessibility features:

- Fixed heights for consistent click targets
- `focus-visible` for keyboard-only indication
- `type="button"` on buttons
- `gap-2` for icon spacing

## Spacing system

- Button sizes: `h-7` (sm), `h-9` (md), `h-11` (lg)
- Horizontal padding: `px-3` (sm), `px-4` (md), `px-6` (lg)
- Dialog padding: `p-4` (sm), `p-6` (md), `p-8` (lg)
- Uses Tailwind default 0.25rem scale
