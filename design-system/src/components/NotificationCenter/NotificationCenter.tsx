import type React from "react";
import { cn } from "../../utils/cn";
import { Notification, type NotificationProps } from "../Notification";

/**
 * NotificationCenter component - SwayNC control center
 *
 * Implements the full notification control center matching SwayNC configuration:
 * - Fixed 380x560px dimensions (from config.json)
 * - Title widget with "Notifications" header and clear all button
 * - Scrollable notification list with empty state
 * - Do Not Disturb toggle widget
 * - Volume slider widget
 *
 * Matches .config/swaync/style.css styling exactly:
 * - --bg-color: rgba(32, 32, 32, 0.85) with backdrop blur
 * - --radius-large: 22px, --radius-medium: 18px
 * - Widget ordering: title → notifications → dnd → volume
 */

// Fluent Icon SVG Components
// Clear All Icon - U+F039F
const ClearAllIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
  </svg>
);

// Chat Message Icon - U+F0361
const ChatMessageIcon = () => (
  <svg
    width="56"
    height="56"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M5.25 18A3.25 3.25 0 0 1 2 14.75v-8.5A3.25 3.25 0 0 1 5.25 3h13.5A3.25 3.25 0 0 1 22 6.25v8.5A3.25 3.25 0 0 1 18.75 18h-5.738L8 21.75a1.25 1.25 0 0 1-1.999-1V18h-.75Zm7.264-1.5h6.236a1.75 1.75 0 0 0 1.75-1.75v-8.5a1.75 1.75 0 0 0-1.75-1.75H5.25a1.75 1.75 0 0 0-1.75 1.75v8.5c0 .966.784 1.75 1.75 1.75H6.5v2.25L12.514 16.5Z" />
  </svg>
);

// Speaker Volume Icon - U+F057E
const SpeakerVolumeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M11.553 3.064A.75.75 0 1 0 10.447 4.11a4.978 4.978 0 0 1 0 7.778.75.75 0 0 0 1.106 1.046 6.478 6.478 0 0 0 0-9.872Z" />
    <path d="M8.757 2.146A.75.75 0 0 1 9.5 2.75v10.5a.75.75 0 0 1-1.238.571L4.47 10.5H2.75A1.75 1.75 0 0 1 1 8.75v-1.5C1 6.56 1.56 6 2.75 6H4.47l3.792-3.321a.75.75 0 0 1 .495-.533ZM8 4.367L5.212 6.69a.75.75 0 0 1-.495.185H2.75a.25.25 0 0 0-.25.25v1.5c0 .138.112.25.25.25h1.967a.75.75 0 0 1 .495.185L8 11.633V4.367Z" />
  </svg>
);

// Chevron Up Icon - U+F0615
const ChevronUpIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M3.22 10.53a.75.75 0 0 0 1.06 0L8 6.81l3.72 3.72a.75.75 0 1 0 1.06-1.06l-4.25-4.25a.75.75 0 0 0-1.06 0L3.22 9.47a.75.75 0 0 0 0 1.06Z" />
  </svg>
);

export interface NotificationCenterProps {
  /**
   * Array of notifications to display
   */
  notifications?: NotificationProps[];
  /**
   * Do Not Disturb state
   */
  doNotDisturb?: boolean;
  /**
   * Callback when DND toggle changes
   */
  onDoNotDisturbChange?: (enabled: boolean) => void;
  /**
   * Volume level (0-100)
   */
  volume?: number;
  /**
   * Callback when volume changes
   */
  onVolumeChange?: (volume: number) => void;
  /**
   * Callback when clear all button is clicked
   */
  onClearAll?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications = [],
  doNotDisturb = false,
  onDoNotDisturbChange,
  volume = 50,
  onVolumeChange,
  onClearAll,
  className,
}) => {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl",
        "w-[380px] h-[560px]",
        "flex flex-col",
        "bg-background-primary/85 backdrop-blur-sm",
        className,
      )}
    >
      {/* Title Widget - matches .widget-title */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.15]">
        <h2 className="text-[18px] font-semibold text-foreground-primary font-button">
          Notifications
        </h2>
        <button
          type="button"
          onClick={onClearAll}
          className="w-6 h-6 flex items-center justify-center text-foreground-primary/60 hover:text-foreground-primary transition-colors duration-150"
          title="Clear all notifications"
        >
          <ClearAllIcon />
        </button>
      </div>

      {/* Notifications List - matches .notification-list-scroll */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {notifications.length === 0 ? (
          // Empty State - matches .control-center-list-placeholder
          <div className="bg-background-primary/85 backdrop-blur-sm border border-white/[0.15] rounded-lg p-8 flex flex-col items-center justify-center text-center min-h-[180px]">
            <div className="mb-3 text-foreground-tertiary/50">
              <ChatMessageIcon />
            </div>
            <p className="text-foreground-primary font-button text-[15px] font-normal">
              No Notifications
            </p>
          </div>
        ) : (
          notifications.map((notification, index) => (
            <Notification
              key={`notification-${
                // biome-ignore lint/suspicious/noArrayIndexKey: notifications may not have stable IDs
                index
              }`}
              {...notification}
            />
          ))
        )}
      </div>

      {/* DND Widget - matches .widget-dnd */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.15]">
        <span className="text-[15px] text-foreground-primary font-button">
          Do not disturb
        </span>
        <button
          type="button"
          onClick={() => onDoNotDisturbChange?.(!doNotDisturb)}
          className={cn(
            "relative inline-flex items-center rounded-full border transition-all duration-200",
            "w-11 h-6",
            doNotDisturb
              ? "bg-accent-primary border-accent-primary"
              : "bg-background-secondary/60 border-white/[0.12]",
          )}
          role="switch"
          aria-checked={doNotDisturb}
        >
          <span
            className={cn(
              "inline-block w-5 h-5 rounded-full bg-foreground-primary transition-transform duration-200 shadow-md",
              doNotDisturb ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Volume Widget - matches .widget-volume */}
      <div className="px-3 py-3 border-t border-white/[0.15]">
        <div className="flex items-center gap-2">
          {/* Volume icon left */}
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-foreground-secondary hover:text-foreground-primary transition-colors"
          >
            <SpeakerVolumeIcon />
          </button>

          {/* Volume slider - matches .widget-volume scale */}
          <div className="flex-1 relative">
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => onVolumeChange?.(Number(e.target.value))}
              className="w-full h-[6px] appearance-none bg-transparent cursor-pointer rounded-full"
              style={{
                background: `linear-gradient(to right, 
                  #0067c0 0%, 
                  #0067c0 ${volume}%, 
                  rgba(255, 255, 255, 0.1) ${volume}%, 
                  rgba(255, 255, 255, 0.1) 100%)`,
              }}
            />
            <style>
              {`
                /* Range slider thumb styling - matches .widget-volume scale slider */
                input[type="range"]::-webkit-slider-thumb {
                  appearance: none;
                  width: 14px;
                  height: 14px;
                  border-radius: 50%;
                  background: #ffffff;
                  border: none;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
                  cursor: pointer;
w
                  transition: transform 140ms ease, box-shadow 140ms ease;
                }
                
                input[type="range"]::-webkit-slider-thumb:hover,
                input[type="range"]::-webkit-slider-thumb:active {
                  transform: scale(1.15);
                  box-shadow: 0 0 0 4px rgba(0, 103, 192, 0.2), 0 2px 6px rgba(0, 0, 0, 0.4);
                }
                
                input[type="range"]::-moz-range-thumb {
                  width: 14px;
                  height: 14px;
                  border-radius: 50%;
                  background: #ffffff;
                  border: none;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
                  cursor: pointer;
                  transition: transform 140ms ease, box-shadow 140ms ease;
                }
                
                input[type="range"]::-moz-range-thumb:hover,
                input[type="range"]::-moz-range-thumb:active {
                  transform: scale(1.15);
                  box-shadow: 0 0 0 4px rgba(0, 103, 192, 0.2), 0 2px 6px rgba(0, 0, 0, 0.4);
                }
              `}
            </style>
          </div>

          {/* Volume icon right */}
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-foreground-secondary hover:text-foreground-primary transition-colors"
            title="Show per-app volume"
          >
            <ChevronUpIcon />
          </button>
        </div>
      </div>
    </div>
  );
};
