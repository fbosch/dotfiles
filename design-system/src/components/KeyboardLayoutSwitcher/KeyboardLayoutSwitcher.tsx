import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";

/**
 * KeyboardLayoutSwitcher component
 * 
 * A compact overlay widget that displays keyboard layout switching feedback.
 * macOS-inspired segmented control showing the transition between layouts.
 * 
 * Design philosophy:
 * - macOS refinement: Segmented control aesthetic, pill shape, elevated active state
 * - Clean and minimal: No decorative icons, focus on layout codes
 * - Technical user focus: Quick visual feedback for layout changes
 * 
 * Visual structure: [FROM | TO] 
 * - FROM layout: Subtle, nearly transparent (where you're switching from)
 * - TO layout: Elevated with light overlay (where you're switching to)
 */

const switcherVariants = cva(
  // Base styles - macOS segmented control with glass effect
  "bg-background-tertiary/80 border border-white/10 backdrop-blur-sm shadow-[0_4px_16px_rgba(0,0,0,0.3)] rounded-full flex items-center animate-in fade-in-0 zoom-in-95 duration-150",
  {
    variants: {
      size: {
        sm: "p-1 gap-1",
        md: "p-1.5 gap-1.5",
        lg: "p-2 gap-2",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const layoutBadgeVariants = cva(
  "rounded-full font-button font-bold transition-all duration-200 flex items-center justify-center",
  {
    variants: {
      state: {
        from: "bg-transparent text-foreground-tertiary",
        to: "bg-accent-primary text-white border border-white/10 shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
      },
      size: {
        sm: "px-4 py-1.5 text-sm min-w-[56px]",
        md: "px-5 py-2 text-base min-w-[64px]",
        lg: "px-6 py-3 text-lg min-w-[80px]",
      },
    },
    defaultVariants: {
      state: "from",
      size: "sm",
    },
  },
);

export interface KeyboardLayoutSwitcherProps
  extends VariantProps<typeof switcherVariants> {
  /**
   * The layout being switched from
   */
  fromLayout: string;
  /**
   * The layout being switched to (highlighted)
   */
  toLayout: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const KeyboardLayoutSwitcher: React.FC<
  KeyboardLayoutSwitcherProps
> = ({ fromLayout, toLayout, size = "sm", className }) => {
  return (
    <div className={cn(switcherVariants({ size }), className)}>
      {/* FROM layout badge */}
      <div className={layoutBadgeVariants({ state: "from", size })}>
        {fromLayout}
      </div>

      {/* TO layout badge */}
      <div className={layoutBadgeVariants({ state: "to", size })}>
        {toLayout}
      </div>
    </div>
  );
};
