import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";

/**
 * Dialog component inspired by AGS confirm-dialog
 * Based on .config/ags/confirm-dialog.tsx
 *
 * Design reference:
 * - Background: rgba(42, 42, 42, 0.90) with backdrop blur
 * - Border radius: 12px
 * - Padding: 24px
 * - Border: 1px solid rgba(255, 255, 255, 0.15)
 * - Shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1)
 */

const dialogVariants = cva(
  // Base styles
  "bg-background-secondary/90 border border-white/15 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.1)] flex flex-col",
  {
    variants: {
      variant: {
        default: "",
        danger: "",
        warning: "",
      },
      size: {
        sm: "rounded-xl p-4 max-w-xs min-w-[280px]",
        md: "rounded-xl p-6 max-w-sm min-w-[340px]",
        lg: "rounded-xl p-8 max-w-md min-w-[400px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

const iconVariants = cva("text-4xl mb-4 font-nerd", {
  variants: {
    variant: {
      default: "text-foreground-primary",
      danger: "text-state-error",
      warning: "text-state-warning",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface DialogProps extends VariantProps<typeof dialogVariants> {
  /**
   * Dialog icon (emoji or unicode character)
   */
  icon?: string;
  /**
   * Dialog title
   */
  title?: string;
  /**
   * Dialog message/description
   */
  message?: string;
  /**
   * Dialog content (overrides title/message if provided)
   */
  children?: React.ReactNode;
  /**
   * Footer content (usually buttons)
   */
  footer?: React.ReactNode;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Center align content
   * @default true
   */
  centered?: boolean;
}

export const Dialog: React.FC<DialogProps> = ({
  icon,
  title,
  message,
  children,
  footer,
  variant = "default",
  size = "md",
  className,
  centered = true,
}) => {
  return (
    <div className={cn(dialogVariants({ variant, size }), className)}>
      {/* Content area */}
      <div
        className={cn(
          "flex flex-col",
          centered && "text-center items-center",
          footer && "mb-5",
        )}
      >
        {children ? (
          children
        ) : (
          <>
            {icon && (
              <div className={iconVariants({ variant })} aria-hidden="true">
                {icon}
              </div>
            )}
            {title && (
              <h2 className="text-sm font-semibold text-foreground-primary mb-1">
                {title}
              </h2>
            )}
            {message && (
              <p className="text-xs text-foreground-tertiary leading-relaxed">
                {message}
              </p>
            )}
          </>
        )}
      </div>

      {/* Footer area */}
      {footer && <div className="flex gap-2">{footer}</div>}
    </div>
  );
};
