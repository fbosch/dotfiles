import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";
import { Button } from "../Button";

/**
 * Notification component - SwayNC design system
 * 
 * Matches SwayNC GTK notification styling exactly:
 * - 290px wide floating cards with backdrop blur
 * - SF Pro Rounded typography throughout
 * - Three urgency levels: normal, low (0.9 opacity), critical (red border)
 * - Hover-revealed close button
 * - Custom action buttons matching SwayNC style
 * 
 * Layout structure:
 * - Optional header row: app-name (left) + time (right)
 * - Summary: Main notification title (bold, larger text)
 * - Body: Secondary details (smaller, secondary color)
 * - Optional icon, image, and action buttons
 */

const notificationVariants = cva(
  // Base styles - matches .notification CSS (using brighter border to match actual appearance)
  "group relative w-[290px] bg-background-primary/85 backdrop-blur-sm border border-white/[0.15] rounded-3xl overflow-hidden transition-all duration-150",
  {
    variants: {
      urgency: {
        // Normal: hover changes background to surface-color
        normal: "hover:bg-background-secondary/60 hover:border-white/20",
        // Low: reduced opacity
        low: "opacity-90",
        // Critical: red background tint with red border (2px)
        critical: "bg-[#c42b1c]/20 border-[#c42b1c] border-2",
      },
    },
    defaultVariants: {
      urgency: "normal",
    },
  },
);

const summaryVariants = cva(
  // Matches .summary CSS
  "font-button text-sm font-semibold text-foreground-primary",
  {
    variants: {
      urgency: {
        normal: "",
        low: "",
        // Critical uses specific red color from CSS
        critical: "text-[#ff6b6b]",
      },
    },
    defaultVariants: {
      urgency: "normal",
    },
  },
);

export interface NotificationAction {
  id: string;
  label: string;
  onClick: () => void;
}

export interface NotificationProps extends VariantProps<typeof notificationVariants> {
  /**
   * Application name (optional, shown in header if provided)
   */
  appName?: string;
  /**
   * Timestamp or relative time (optional, e.g., "2m ago")
   */
  time?: string;
  /**
   * Notification title/summary (main heading)
   */
  summary: string;
  /**
   * Notification body text (optional, secondary details)
   */
  body?: string;
  /**
   * Optional icon element (React node)
   */
  icon?: React.ReactNode;
  /**
   * Optional body image URL
   */
  image?: string;
  /**
   * Optional action buttons
   */
  actions?: NotificationAction[];
  /**
   * Close button handler
   */
  onClose?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const Notification: React.FC<NotificationProps> = ({
  urgency,
  appName,
  time,
  summary,
  body,
  icon,
  image,
  actions,
  onClose,
  className,
}) => {
  return (
    <div className={cn(notificationVariants({ urgency }), className)}>
      {/* Content wrapper - matches .notification-content padding */}
      <div className="p-3">
        {/* Optional Header Row: App name (left) + Time (right) - matches .notification-row */}
        {(appName || time) && (
          <div className="flex items-center justify-between mb-2">
            {appName && (
              <span className="font-button text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                {appName}
              </span>
            )}
            {time && (
              <span className="font-button text-[11px] text-foreground-tertiary">
                {time}
              </span>
            )}
          </div>
        )}

        {/* Main content area with optional icon */}
        <div className="flex gap-3 items-center">
          {/* Optional icon - matches .notification-icon */}
          {icon && (
            <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
              {icon}
            </div>
          )}

          {/* Text content wrapper */}
          <div className="flex-1">
            {/* Summary - matches .summary (main heading) */}
            <div className={cn(summaryVariants({ urgency }), "mb-1")}>
              {summary}
            </div>
            
            {/* Body - matches .body (secondary details) */}
            {body && (
              <div className="font-button text-xs leading-normal text-foreground-secondary">
                {body}
              </div>
            )}

            {/* Optional body image - matches .body-image */}
            {image && (
              <div className="mt-1 mr-5 ml-1 rounded-2xl overflow-hidden bg-white/[0.04] shadow-sm">
                <img 
                  src={image} 
                  alt="" 
                  className="w-full h-auto object-cover"
                />
              </div>
            )}
          </div>
        </div>

        {/* Optional action buttons */}
        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {actions.map((action) => (
              <Button
                key={action.id}
                variant="default"
                size="sm"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Close button - matches .close-button */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-3 w-6 h-6 rounded-full bg-transparent text-foreground-secondary opacity-0 group-hover:opacity-100 hover:!opacity-100 transition-all duration-150 hover:bg-background-tertiary/70 hover:text-foreground-primary flex items-center justify-center"
          aria-label="Close notification"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <title>Close</title>
            <path
              d="M1 1L11 11M1 11L11 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
