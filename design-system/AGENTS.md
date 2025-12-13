# Design System - Agent Guide

## ⚠️ Core Principles

### No Custom CSS Classes
- **ALWAYS use Tailwind utility classes** - Never create custom CSS files or classes
- **Exception:** Global styles in `src/index.css` for base resets only
- Use `clsx`, `tailwind-merge`, and `cva` for dynamic styling

### Style Management Tools

```typescript
import { clsx } from 'clsx';           // Conditional class names
import { twMerge } from 'tailwind-merge'; // Merge Tailwind classes safely
import { cva } from 'class-variance-authority'; // Component variants
```

**Pattern: Create a `cn()` utility**
```typescript
// src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Component Structure with CVA

```typescript
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/utils/cn';

const buttonVariants = cva(
  // Base styles (always applied)
  'inline-flex items-center justify-center rounded-md transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-accent-primary hover:bg-accent-hover',
        ghost: 'bg-transparent hover:bg-white/5',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  // additional props
}

export const Button = ({ variant, size, className, ...props }: ButtonProps) => (
  <button
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
);
```

## 🎨 Design Tokens

### Using Tokens in Tailwind

Design tokens from `tokens.json` should be mapped in `tailwind.config.js`:

```javascript
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        background: {
          primary: '#202020',
          secondary: '#2d2d2d',
          tertiary: '#373737',
        },
        foreground: {
          primary: '#ffffff',
          secondary: '#cccccc',
          tertiary: '#999999',
        },
        accent: {
          primary: '#0067c0',
          hover: '#106ebe',
          active: '#1a7fd4',
        },
        state: {
          success: '#73bc6f',
          warning: '#dea721',
          error: '#e35245',
          info: '#0067c0',
        },
      },
      fontFamily: {
        primary: ['Zenbones Brainy', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
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

## 🎭 Storybook Stories

```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Click me',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button variant="primary">Primary</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
};
```

## ✅ Validation Checklist

Before committing components:

1. [ ] No custom CSS classes (except global resets)
2. [ ] All styles use Tailwind utilities
3. [ ] CVA used for component variants
4. [ ] `cn()` utility used for conditional classes
5. [ ] Design tokens referenced via Tailwind theme
6. [ ] All buttons have `type` attribute
7. [ ] Storybook story created with multiple variants
8. [ ] Component exports interface for composition

## 🚫 Anti-Patterns

**DON'T:**
```typescript
// ❌ Custom CSS file
import './Component.css';

// ❌ Inline styles for design system values
<div style={{ backgroundColor: '#202020' }}>

// ❌ String concatenation for classes
className={`base ${active ? 'active' : ''}`}
```

**DO:**
```typescript
// ✅ Tailwind utilities only
<div className="bg-background-primary text-foreground-primary">

// ✅ CVA for variants
const variants = cva('base', { variants: { ... } });

// ✅ cn() for conditional classes
className={cn('base', active && 'bg-accent-primary')}
```
