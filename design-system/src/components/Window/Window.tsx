import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";

/**
 * Window component implementing Hyprland window styling
 * Based on .config/hypr/hyprland.conf and .config/hypr/hyprbars.conf
 *
 * Configuration reference:
 * - Border: 1px, rgba(ffffff40) active / rgba(ffffff26) inactive
 * - Border radius: 6px
 * - Hyprbars height: 20px
 * - Hyprbars background: rgba(252525FF)
 * - Shadow: 15px range, 20% opacity
 * - Blur: enabled with 2px size, 4 passes
 */

const windowVariants = cva(
  "relative overflow-hidden backdrop-blur-sm transition-all duration-200",
  {
    variants: {
      state: {
        active: "border-white/25",
        inactive: "border-white/15",
      },
      shadow: {
        true: "shadow-[0_2px_15px_rgba(0,0,0,0.2)]",
        false: "",
      },
    },
    defaultVariants: {
      state: "active",
      shadow: true,
    },
  },
);

const hyperbarVariants = cva(
  "flex items-center justify-between px-3 backdrop-blur-sm select-none",
  {
    variants: {
      blur: {
        true: "backdrop-blur",
        false: "",
      },
    },
    defaultVariants: {
      blur: true,
    },
  },
);

const buttonVariants = cva(
  "flex items-center justify-center text-white/60 transition-none cursor-pointer",
  {
    variants: {
      type: {
        close: "font-nerd font-bold",
        maximize: "font-nerd",
        minimize: "font-nerd",
      },
    },
    defaultVariants: {
      type: "close",
    },
  },
);

export interface WindowProps extends VariantProps<typeof windowVariants> {
  /**
   * Window title displayed in hyprbars
   */
  title?: string;
  /**
   * Window content
   */
  children: React.ReactNode;
  /**
   * Width of the window
   * @default '800px'
   */
  width?: string;
  /**
   * Height of the window
   * @default '600px'
   */
  height?: string;
  /**
   * Show hyprbars titlebar
   * @default true
   */
  showTitlebar?: boolean;
  /**
   * Hyprbars height in pixels
   * @default 20
   */
  titlebarHeight?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Callback when close button is clicked
   */
  onClose?: () => void;
  /**
   * Callback when maximize button is clicked
   */
  onMaximize?: () => void;
  /**
   * Callback when minimize button is clicked
   */
  onMinimize?: () => void;
}

export const Window: React.FC<WindowProps> = ({
  title = "Application",
  children,
  width = "800px",
  height = "600px",
  showTitlebar = true,
  titlebarHeight = 20,
  state = "active",
  shadow = true,
  className,
  onClose,
  onMaximize,
  onMinimize,
}) => {
  return (
    <div
      className={cn(
        windowVariants({ state, shadow }),
        "border rounded-md",
        className,
      )}
      style={{
        width,
        height,
        borderRadius: "6px", // From hyprland.conf decoration.rounding
        borderWidth: "1px", // From hyprland.conf general.border_size
      }}
    >
      {showTitlebar && (
        <div
          className={hyperbarVariants({ blur: true })}
          style={{
            height: `${titlebarHeight}px`,
            backgroundColor: "rgba(37, 37, 37, 1)", // From hyprbars.conf bar_color
          }}
        >
          {/* Title - left aligned */}
          <div className="flex items-center flex-1">
            <span
              className="text-white/90 truncate"
              style={{
                fontSize: "10px", // From hyprbars.conf bar_text_size
              }}
            >
              {title}
            </span>
          </div>

          {/* Buttons - right aligned */}
          <div className="flex items-center gap-0.5">
            {/* Minimize button */}
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                className={buttonVariants({ type: "minimize" })}
                style={{
                  fontSize: "8px",
                  padding: "2px 4px",
                }}
                title="Minimize"
              >
                －
              </button>
            )}

            {/* Maximize button */}
            {onMaximize && (
              <button
                type="button"
                onClick={onMaximize}
                className={buttonVariants({ type: "maximize" })}
                style={{
                  fontSize: "7px",
                  padding: "2px 3px",
                }}
                title="Maximize"
              >
                
              </button>
            )}

            {/* Close button */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={buttonVariants({ type: "close" })}
                style={{
                  fontSize: "9px",
                  padding: "2px 4px",
                }}
                title="Close"
              >
                󰖭
              </button>
            )}
          </div>
        </div>
      )}

      {/* Window content */}
      <div
        className="w-full overflow-auto bg-background-primary"
        style={{
          height: showTitlebar ? `calc(100% - ${titlebarHeight}px)` : "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
};
