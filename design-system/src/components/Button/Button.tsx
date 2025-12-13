import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";

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
 */

const buttonVariants = cva(
  // Base styles (always applied)
  "inline-flex items-center justify-center gap-2 font-primary font-medium rounded-md transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-background-tertiary text-foreground-primary hover:bg-background-tertiary/90 border border-white/10 hover:border-white/20 focus-visible:outline-white/30",
        primary: "bg-accent-primary text-white hover:bg-accent-hover shadow-sm hover:shadow focus-visible:outline-accent-primary",
        success: "bg-state-success text-white hover:bg-state-success-hover shadow-sm hover:shadow focus-visible:outline-state-success",
        warning: "bg-state-warning text-white hover:bg-state-warning-hover shadow-sm hover:shadow focus-visible:outline-state-warning",
        danger: "bg-state-error text-white hover:bg-state-error-hover shadow-sm hover:shadow focus-visible:outline-state-error",
        outline: "bg-transparent text-foreground-primary border border-white/20 hover:bg-white/8 hover:border-white/30 focus-visible:outline-white/30",
        ghost: "bg-white/5 text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:outline-white/20",
      },
      size: {
        sm: "h-7 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-base",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      fullWidth: false,
    },
  },
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
  type = "button",
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
