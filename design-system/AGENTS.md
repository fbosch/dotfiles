# Design System - Agent Guide

## 🎯 Design Goal

This design system creates a familiar yet refined desktop environment for tech-savvy users transitioning from or using both Windows 11 and macOS.

**Target Audience:** Technical users (developers, power users, system administrators) who:

- Are comfortable with Windows 11's interface patterns
- Appreciate macOS's polish and attention to detail
- Value efficiency and customization over hand-holding

**Design Philosophy:**

- **Familiar foundation:** Windows 11 spatial layout and organization patterns (taskbar positioning, window controls, system tray)
- **macOS refinement:** Subtle animations, refined typography, thoughtful spacing, and premium feel
- **Technical transparency:** Surface system information, expose power-user controls, support keyboard-driven workflows
- **Consistent theming:** Zenwritten Dark colorscheme across all applications and components

**Visual Language:**

- Clean, modern interfaces with purposeful use of space
- Subtle depth through layering (backgrounds: primary → secondary → tertiary)
- Accent colors used sparingly for interactive elements and state indication
- Typography that balances readability with information density
- Smooth, non-distracting transitions that provide feedback without slowing workflow

## 🎨 Design Patterns Observed

### Color System Architecture

**Hierarchical Color Palette:**

- **Background layers** (`primary` → `secondary` → `tertiary`): Progressive lightening (#202020 → #2d2d2d → #373737) creates depth through subtle contrast
- **Foreground tiers** (`primary` → `secondary` → `tertiary`): Decreasing opacity (#ffffff → #cccccc → #999999) establishes typographic hierarchy
- **Accent system**: Single blue accent (#0067c0) with hover and active states provides consistent interaction color
- **Semantic states**: Dedicated colors for success, warning, error, and info contexts

**Token Pattern:**

- Base tokens in `tokens.json` as single source of truth
- Mapped to Tailwind in `tailwind.config.js` for utility class generation
- Hover states defined as separate tokens (e.g., `accent-hover`, `state-success-hover`) rather than computed values
- Ensures consistency and prevents magic numbers in components

### Interactive Element Patterns

**Button Hierarchy (7 variants, decreasing visual weight):**

1. **Default**: Solid tertiary background - standard actions
2. **Primary**: Solid accent background - main call-to-action
3. **Success/Warning/Danger**: Semantic solid backgrounds - state-specific actions
4. **Outline**: Transparent with border - secondary emphasis
5. **Ghost**: Minimal background - tertiary actions

**Interaction States:**

- **Hover**: Color shift + optional shadow enhancement
- **Focus**: 2px outline with offset for keyboard navigation visibility
- **Active**: Subtle scale transform (0.98) for tactile feedback
- **Disabled**: 40% opacity with cursor change

**Micro-interactions:**

- `transition-all duration-150`: Fast enough to feel responsive, slow enough to perceive
- `active:scale-[0.98]`: macOS-inspired press feedback
- `shadow-sm hover:shadow`: Windows 11-inspired elevation on interaction
- `focus-visible` instead of `focus`: Only show outline for keyboard navigation

### Accessibility Considerations

**Current Contrast Issues Identified:**

- Success button: 2.29:1 (fails WCAG AA)
- Warning button: 2.17:1 (fails WCAG AA)
- Danger button: 3.78:1 (fails WCAG AA)
- **Recommendation**: Darken state colors or adjust text color to achieve 4.5:1 minimum

**Accessibility Features Implemented:**

- Fixed heights for consistent click targets
- `focus-visible` for keyboard-only focus indication
- Semantic HTML (`type="button"` attributes)
- Gap utilities (`gap-2`) for icon spacing

### Spacing System

**Consistent rhythm:**

- Button sizes: `h-7` (sm), `h-9` (md), `h-11` (lg) - 2-unit increments
- Horizontal padding: `px-3` (sm), `px-4` (md), `px-6` (lg) - 1-2 unit steps
- Dialog padding: `p-4` (sm), `p-6` (md), `p-8` (lg) - 2-unit increments
- Uses Tailwind's default 0.25rem scale (no custom spacing tokens)

### Component Composition Pattern

**CVA-based Variant System:**

- Base styles contain shared properties (layout, typography, transitions)
- Variants only define what changes (colors, sizes)
- Boolean variants preferred over multiplicative variants
- Compound variants for specific combinations

**Example Pattern:**

```typescript
const componentVariants = cva("shared-base-styles", {
  variants: {
    variant: {
      /* visual styles */
    },
    size: {
      /* dimensions */
    },
    fullWidth: {
      /* layout modifier */
    },
  },
});
```

### Typography System

**Font Stack:**

- Primary: SF Pro Text (macOS native feel)
- Mono: JetBrains Mono (developer-friendly)
- Specialized: Nerd Font symbols, Fluent icons

**Icon Fonts:**

- **Segoe Fluent Icons** (`font-fluent`): Primary icon font for UI elements
- **Segoe MDL2 Assets**: Legacy icon font (use Fluent Icons instead when possible)
- Icon reference: [Segoe MDL2 Assets Documentation](https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/apps/design/style/segoe-ui-symbol-font.md)
- Use unicode characters directly in JSX: `<span className="font-fluent"></span>` (E713 = Settings icon)

**Size Scale:**

- Uses Tailwind defaults: `text-xs` (0.75rem), `text-sm` (0.875rem), `text-base` (1rem)
- No custom font sizes - maintains consistency with broader ecosystem
- Medium weight (500) for buttons and emphasis, normal (400) for body

### State Management Pattern

**Semantic Color Variants:**

- Each semantic state (success, warning, danger) has matching hover state
- Provides clear visual feedback for state-specific actions
- Consistent with both Windows 11 (clear semantics) and macOS (subtle refinement)

## ⚠️ Core Principles

### No Custom CSS Classes

- **ALWAYS use Tailwind utility classes** - Never create custom CSS files or classes
- **Exception:** Global styles in `src/index.css` for base resets only
- Use `clsx`, `tailwind-merge`, and `cva` for dynamic styling

### Style Management Tools

```typescript
import { clsx } from "clsx"; // Conditional class names
import { twMerge } from "tailwind-merge"; // Merge Tailwind classes safely
import { cva } from "class-variance-authority"; // Component variants
```

**Pattern: Create a `cn()` utility**

```typescript
// src/utils/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Component Structure with CVA

**Use CVA composition properly - avoid duplicating styles across variants.**

**CRITICAL: Keep variants minimal. Only create variants that are truly needed.**

### Variant Guidelines

- **Minimal variants**: Only add variants when specifically requested or absolutely necessary
- **Essential only**: Prefer 2-4 variants maximum per component
- **Don't over-engineer**: Avoid creating variants for every possible visual state
- **User can extend**: Users can add more variants if needed; start minimal

**DON'T:**

```typescript
// ❌ Too many variants without being asked
variants: {
  variant: {
    primary: '...',
    secondary: '...',
    ghost: '...',
    danger: '...',
    warning: '...',
    info: '...',
    success: '...',
    outline: '...',
    link: '...',
  },
  size: {
    xs: '...',
    sm: '...',
    md: '...',
    lg: '...',
    xl: '...',
    '2xl': '...',
  },
}
```

**DO:**

```typescript
// ✅ Essential variants only (2-4 per property)
variants: {
  variant: {
    primary: 'bg-accent-primary hover:bg-accent-hover',
    secondary: 'bg-background-tertiary hover:bg-background-tertiary/80',
    ghost: 'bg-transparent hover:bg-white/5',
  },
  size: {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-1.5 text-sm',
    lg: 'px-6 py-2 text-base',
  },
}
```

```typescript
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/utils/cn';

// ❌ BAD: Duplicating styles across variants
const buttonVariants = cva('base', {
  variants: {
    variant: {
      primary: 'flex items-center gap-2 px-4 py-2 bg-blue-500',
      secondary: 'flex items-center gap-2 px-4 py-2 bg-gray-500',
      ghost: 'flex items-center gap-2 px-4 py-2 bg-transparent',
    },
  },
});

// ✅ GOOD: Use base styles and composition
const buttonVariants = cva(
  // Base styles (always applied)
  'inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-accent-primary hover:bg-accent-hover',
        secondary: 'bg-gray-500 hover:bg-gray-600',
        ghost: 'bg-transparent hover:bg-white/5',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-lg',
      },
      active: {
        true: 'ring-2 ring-accent-primary',
        false: '',
      },
    },
    compoundVariants: [
      {
        variant: 'ghost',
        active: true,
        className: 'bg-white/10',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      active: false,
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  // additional props
}

export const Button = ({ variant, size, active, className, ...props }: ButtonProps) => (
  <button
    className={cn(buttonVariants({ variant, size, active }), className)}
    {...props}
  />
);
```

**Key principles:**

- Put shared styles in the base string (first argument)
- Create boolean variants (like `active`) instead of duplicate variants (like `primaryActive`, `secondaryActive`)
- Use `compoundVariants` for specific combinations
- Compose variants together: `variant="primary" active={true}` instead of `variant="primaryActive"`

## 🎨 Design Tokens

### Token Consistency Principle

**CRITICAL: Do not create custom tokens for single-use cases or specific features.**

- **Use standard Tailwind spacing scale** (`p-1`, `p-2`, `p-3`, `m-1`, `m-2`, etc.)
- **Use standard Tailwind font sizes** (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, etc.)
- **Use standard Tailwind letter spacing** (`tracking-tighter`, `tracking-tight`, `tracking-normal`, `tracking-wide`, `tracking-wider`, `tracking-widest`)
- Only add new tokens when they will be **reused across multiple components**
- The goal is **consistency across the design system**, not feature-specific customization

**DON'T:**

```typescript
// ❌ Creating custom tokens for one feature
spacing: {
  'waybar-1': '0.2rem',    // Only used in Waybar
  'waybar-2': '0.33rem',   // Only used in Waybar
  'waybar-3': '0.6rem',    // Only used in Waybar
}
fontSize: {
  'waybar-sm': '0.8rem',   // Only used in Waybar
  'waybar-xl': '1.4rem',   // Only used in Waybar
}
letterSpacing: {
  'waybar': '0.05em',      // Only used in Waybar
}
```

**DO:**

```typescript
// ✅ Use standard Tailwind scales
<div className="p-1 m-2 text-xs tracking-wide">     // 0.25rem, 0.5rem, 0.75rem, 0.025em
<div className="p-2 m-3 text-sm tracking-normal">   // 0.5rem, 0.75rem, 0.875rem, 0em
<div className="p-3 m-4 text-base tracking-tight">  // 0.75rem, 1rem, 1rem, -0.025em
<div className="px-4 text-2xl">                      // 1rem horizontal, 1.5rem font

// ✅ If you MUST use arbitrary values, they should be exceptional
<div className="px-[1.1rem]">  // Only when standard scale doesn't fit
```

**When to add custom tokens:**

- **Colors** that are part of your brand palette (reused across components)
- **Font families** used throughout the application
- **Specific utilities** that appear in 3+ components (text-shadow, etc.)

### Using Tokens in Tailwind

Design tokens from `tokens.json` should be mapped in `tailwind.config.js`:

```javascript
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        background: {
          primary: "#202020",
          secondary: "#2d2d2d",
          tertiary: "#373737",
        },
        foreground: {
          primary: "#ffffff",
          secondary: "#cccccc",
          tertiary: "#999999",
        },
        accent: {
          primary: "#0067c0",
          hover: "#106ebe",
          active: "#1a7fd4",
        },
        state: {
          success: "#73bc6f",
          warning: "#dea721",
          error: "#e35245",
          info: "#0067c0",
        },
      },
      fontFamily: {
        primary: ["Zenbones Brainy", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
};
```

**Usage in components:**

```typescript
<div className="bg-background-primary text-foreground-primary">
  <button className="bg-accent-primary hover:bg-accent-hover">
    Click me
  </button>
</div>
```

## 📁 File Organization

```
design-system/
  src/
    components/
      {ComponentName}/
        {ComponentName}.tsx       # Component with CVA variants
        {ComponentName}.stories.tsx # Storybook stories
    utils/
      cn.ts                       # Utility for merging classes
    index.css                     # Global styles only (minimal)
  tokens.json                     # Design tokens source of truth
  tailwind.config.js              # Maps tokens to Tailwind theme
```

## 📝 React/TypeScript Conventions

- **Imports:** `import type React from 'react';` for type-only
- **Function components:** Use `React.FC<Props>` or explicit return types
- **Props interfaces:** Export interfaces for composition
- **Button elements:** Always include `type="button"` attribute
- **Conditional classes:** Use `cn()` utility for merging
- **Unicode characters in JSX:** When editing JSX that contains unicode characters (icons, symbols, emojis), be extremely careful to preserve them EXACTLY. If using the Edit tool, ensure the oldString includes the unicode character verbatim. If uncertain about the exact character, use Read tool first or use a different approach that doesn't risk losing the character.
- **Preserve user changes:** If the user makes manual edits to files between agent edits, those changes MUST be preserved. Always read the file before making edits to see the current state. User edits take precedence over agent suggestions.

## 🎭 Storybook Stories

**IMPORTANT: Keep stories minimal and essential. Only create what's truly needed to demonstrate the component.**

### Story Guidelines

- **One story per essential variant/state**: Create individual stories for each important variant (primary, danger, etc.)
- **No "All Variants" showcases**: Don't create composite stories showing all variants together
- **No redundant combinations**: Don't create stories for every size × variant combination
- **Use args and controls**: Let users explore size, disabled, and other properties through Storybook controls

**DON'T:**

```typescript
// ❌ Unnecessary showcase stories
export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
};

// ❌ Redundant size stories when controls work fine
export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
export const Large: Story = { args: { size: 'lg' } };

// ❌ Over-specific use case stories
export const DeleteConfirmation: Story = { ... };
export const LogoutConfirmation: Story = { ... };
```

**DO:**

```typescript
// ✅ Essential individual variant stories
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Button>;

// One story per essential variant
export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Primary Button",
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Secondary Button",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "Ghost Button",
  },
};

export const Danger: Story = {
  args: {
    variant: "danger",
    children: "Danger Button",
  },
};
```

## ✅ Validation Checklist

Before committing components:

1. [ ] No custom CSS classes (except global resets)
2. [ ] All styles use Tailwind utilities
3. [ ] CVA used for component variants **with proper composition** (no duplicate styles)
4. [ ] `cn()` utility used for conditional classes
5. [ ] Design tokens referenced via Tailwind theme
6. [ ] **No custom spacing, font-size, or letter-spacing tokens** for single features
7. [ ] Standard Tailwind scales used (`text-sm`, `p-2`, `tracking-wide`, etc.)
8. [ ] All buttons have `type` attribute
9. [ ] Storybook story created with multiple variants
10. [ ] Component exports interface for composition

## 🚫 Anti-Patterns

**DON'T:**

```typescript
// ❌ Custom CSS file
import './Component.css';

// ❌ Inline styles for design system values
<div style={{ backgroundColor: '#202020' }}>

// ❌ String concatenation for classes
className={`base ${active ? 'active' : ''}`}

// ❌ Duplicate styles across CVA variants
const variants = cva('', {
  variants: {
    variant: {
      primary: 'flex items-center gap-2 px-4 bg-blue-500',
      secondary: 'flex items-center gap-2 px-4 bg-gray-500', // Duplicated layout styles
    }
  }
});

// ❌ Creating separate variants for state combinations
const variants = cva('', {
  variants: {
    variant: {
      task: 'px-2 py-1',
      taskActive: 'px-2 py-1 bg-white/5 font-bold', // Should use composition
      workspace: 'px-3 py-1',
      workspaceActive: 'px-3 py-1 bg-white/5 font-bold', // Should use composition
    }
  }
});

// ❌ Custom tokens for single features
fontSize: {
  'component-sm': '0.8rem',  // Only used in one component
  'component-lg': '1.2rem',  // Only used in one component
}
```

**DO:**

```typescript
// ✅ Tailwind utilities only
<div className="bg-background-primary text-foreground-primary">

// ✅ CVA with proper composition
const variants = cva(
  'flex items-center gap-2 px-4', // Shared base styles
  {
    variants: {
      variant: {
        primary: 'bg-blue-500',
        secondary: 'bg-gray-500',
      },
      active: {
        true: 'bg-white/5 font-bold',
        false: '',
      }
    }
  }
);

// ✅ Composable variants with boolean states
<Component variant="task" active={true} />
<Component variant="workspace" active={false} />

// ✅ Standard Tailwind scales
<div className="text-sm text-xl">  // Use built-in sizes
<div className="p-2 m-4">          // Use built-in spacing

// ✅ cn() for conditional classes
className={cn('base', active && 'bg-accent-primary')}
```
