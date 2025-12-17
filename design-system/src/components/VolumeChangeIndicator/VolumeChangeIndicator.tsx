import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";

/**
 * VolumeChangeIndicator component
 *
 * A compact overlay widget that displays volume level changes with visual feedback.
 * macOS-inspired design with speaker icon, progress bar, and percentage display.
 *
 * Design philosophy:
 * - macOS refinement: Glass effect, pill shape, smooth animations
 * - Clean and minimal: Clear volume state with icon + bar + percentage
 * - Technical user focus: Quick visual feedback for volume adjustments
 *
 * Visual structure: [ICON | ▓▓▓▓▓░░░░░ | 50%]
 * - Icon: Speaker state (muted, low, medium, high)
 * - Progress bar: Visual representation of volume level
 * - Percentage: Numeric display or "Muted" label
 */

const indicatorVariants = cva(
  // Base styles - macOS glass effect matching KeyboardLayoutSwitcher
  "bg-background-tertiary/80 border border-white/10 backdrop-blur-sm shadow-[0_4px_16px_rgba(0,0,0,0.3)] rounded-full flex items-center animate-in fade-in-0 zoom-in-95 duration-150",
  {
    variants: {
      size: {
        sm: "px-3 py-1.5",
        md: "px-3 py-2",
        lg: "px-4 py-3",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const iconContainerVariants = cva(
  "flex items-center justify-center flex-shrink-0 align-middle mr-3",
  {
    variants: {
      size: {
        sm: "w-5 h-5",
        md: "w-6 h-6",
        lg: "w-8 h-8",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const progressBarContainerVariants = cva("flex gap-0.5 flex-1 justify-center", {
  variants: {
    size: {
      sm: "",
      md: "",
      lg: "",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

const progressSquareVariants = cva("rounded-sm transition-all duration-150", {
  variants: {
    filled: {
      true: "bg-white",
      false: "bg-white/20",
    },
    size: {
      sm: "h-2 w-2",
      md: "h-2.5 w-2.5",
      lg: "h-3 w-3",
    },
  },
  defaultVariants: {
    filled: false,
    size: "sm",
  },
});

const labelVariants = cva(
  "font-button font-bold text-foreground-primary flex-shrink-0 text-right",
  {
    variants: {
      size: {
        sm: "text-xs min-w-[42px]",
        md: "text-base min-w-[48px]",
        lg: "text-lg min-w-[56px]",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

type SpeakerState =
  | "muted"
  | "verylow"
  | "low"
  | "medium"
  | "high"
  | "veryhigh";

/**
 * Determine speaker state based on volume level
 */
function getSpeakerState(volume: number, muted: boolean): SpeakerState {
  if (muted) return "muted";
  if (volume === 0) return "muted";
  if (volume <= 15) return "verylow";
  if (volume <= 25) return "low";
  if (volume <= 50) return "medium";
  if (volume <= 75) return "high";
  return "veryhigh";
}

/**
 * Speaker icon using Segoe Fluent Icons glyphs
 */
const SpeakerIcon: React.FC<{
  state: SpeakerState;
  size: "sm" | "md" | "lg";
}> = ({ state, size }) => {
  const sizeMap = { sm: "text-xl", md: "text-2xl", lg: "text-3xl" };
  const textSize = sizeMap[size];

  // Segoe Fluent Icons glyphs for volume levels
  const icons = {
    muted: "", // Muted/Volume 0
    verylow: "", // Very low volume
    low: "", // Low volume
    medium: "", // Medium volume
    high: "", // High volume
    veryhigh: "", // Very high volume
  };

  return (
    <span
      className={cn(
        "font-['Segoe_Fluent_Icons']",
        textSize,
        state === "muted"
          ? "text-foreground-tertiary"
          : "text-foreground-primary",
      )}
    >
      {icons[state]}
    </span>
  );
};

export interface VolumeChangeIndicatorProps
  extends VariantProps<typeof indicatorVariants> {
  /**
   * Volume level (0-100)
   */
  volume: number;
  /**
   * Whether audio is muted
   */
  muted?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const VolumeChangeIndicator: React.FC<VolumeChangeIndicatorProps> = ({
  volume,
  muted = false,
  size = "sm",
  className,
}) => {
  // Clamp volume between 0 and 100
  const clampedVolume = Math.max(0, Math.min(100, volume));

  // Determine speaker state
  const speakerState = getSpeakerState(clampedVolume, muted);

  // Label text
  const label = muted ? "Muted" : `${clampedVolume}%`;

  // Number of squares to show (16 matches macOS style)
  const totalSquares = 16;
  const filledSquares = muted
    ? 0
    : Math.round((clampedVolume / 100) * totalSquares);

  // Generate stable keys for squares
  const squares = Array.from(
    { length: totalSquares },
    (_, i) => `vol-square-${i}`,
  );

  return (
    <div className={cn(indicatorVariants({ size }), className)}>
      {/* Speaker icon */}
      <div className={iconContainerVariants({ size })}>
        <SpeakerIcon state={speakerState} size={size || "sm"} />
      </div>

      {/* Progress bar with squares */}
      <div className={progressBarContainerVariants({ size })}>
        {squares.map((id, index) => (
          <div
            key={id}
            className={progressSquareVariants({
              filled: index < filledSquares,
              size,
            })}
          />
        ))}
      </div>

      {/* Volume label */}
      <div
        className={cn(
          labelVariants({ size }),
          muted || clampedVolume === 0 ? "text-foreground-tertiary" : "",
        )}
      >
        {label}
      </div>
    </div>
  );
};
