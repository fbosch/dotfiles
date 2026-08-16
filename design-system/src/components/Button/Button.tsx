import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';

/**
 * Button component - evolved design system
 * Starting inspiration from AGS confirm-dialog, refined for desktop environment
 *
 * Design philosophy:
 * - Windows 11 clarity: Clear visual hierarchy, solid backgrounds for all variants
 * - macOS refinement: Subtle shadows, smooth transitions, attention to spacing
 * - Technical user focus: High contrast, clear affordances, keyboard-friendly
 *
 * Variants (all with visible backgrounds):
 * - Default: Muted solid for standard actions
 * - Primary: High contrast accent for main actions
 * - Success: Green for positive/confirmation actions
 * - Warning: Orange for caution actions
 * - Danger: Red for destructive actions
 * - Outline: Bordered variant for secondary contexts
 * - Ghost: Minimal background for tertiary actions
 * - Transparent: No resting background for embedded controls
 */

const buttonVariants = cva(
  // Base styles (always applied)
  'inline-flex items-center justify-center gap-2 font-button font-bold rounded-md transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] text-shadow-subtle',
  {
    variants: {
      variant: {
        default:
          'bg-background-tertiary text-foreground-primary hover:bg-background-tertiary/90 border border-white/10 hover:border-white/20 focus-visible:outline-white/30',
        primary:
          'bg-accent-primary text-accent-text hover:bg-accent-hover active:bg-accent-active active:text-accent-active-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.1)] focus-visible:outline-accent-primary',
        success:
          'bg-state-success text-state-success-text hover:bg-state-success-hover active:bg-state-success-active active:text-state-success-active-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.1)] focus-visible:outline-state-success',
        warning:
          'bg-state-warning text-state-warning-text hover:bg-state-warning-hover active:bg-state-warning-active active:text-state-warning-active-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.1)] focus-visible:outline-state-warning',
        danger:
          'bg-state-error text-state-error-text hover:bg-state-error-hover active:bg-state-error-active active:text-state-error-active-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.1)] focus-visible:outline-state-error',
        outline:
          'bg-transparent text-foreground-primary border border-white/20 hover:bg-white/8 hover:border-white/30 focus-visible:outline-white/30',
        ghost:
          'bg-white/5 text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:outline-white/20',
        transparent:
          'bg-transparent text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:bg-white/10 focus-visible:text-foreground-primary focus-visible:outline-white/20',
      },
      size: {
        sm: 'h-7 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      fullWidth: false,
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Button content
   */
  children: React.ReactNode;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  children,
  ...props
}) => {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {children}
    </button>
  );
};
