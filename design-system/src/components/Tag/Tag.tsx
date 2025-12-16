import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";

/**
 * Tag component - macOS-style notification badge
 * Used for counts, status indicators, and labels
 *
 * Design reference:
 * - Compact pill shape with rounded-full
 * - Minimal padding for tight appearance
 * - Dark text on light backgrounds for WCAG AA compliance (4.5:1 minimum)
 * - Bold font weight for readability at small sizes
 */

const tagVariants = cva(
  "inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[9px] font-bold min-w-[18px] leading-none shadow-sm",
  {
    variants: {
      variant: {
        default: "bg-background-tertiary text-foreground-primary",
        primary: "bg-accent-primary text-white",
        success: "bg-state-success text-state-success-text",
        warning: "bg-state-warning text-state-warning-text",
        danger: "bg-state-error text-state-error-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface TagProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagVariants> {
  /**
   * Content to display in the tag
   */
  children: React.ReactNode;
  /**
   * Optional icon to display before the content
   * Expects a Unicode character (e.g., "\uE895" for Fluent Icons)
   */
  icon?: string;
}

export const Tag: React.FC<TagProps> = ({
  variant,
  className,
  children,
  icon,
  ...props
}) => {
  return (
    <span className={cn(tagVariants({ variant }), className)} {...props}>
      {icon && <span className="mr-1 font-fluent">{icon}</span>}
      {children}
    </span>
  );
};
