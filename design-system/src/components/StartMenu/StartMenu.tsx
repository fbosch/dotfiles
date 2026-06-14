import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { Tag } from "../Tag";
import { cn } from "../../utils/cn";

/**
 * StartMenu component - macOS-style application menu
 * Spawns from bottom-left corner (NixOS logo in Waybar)
 *
 * Design reference:
 * - Similar styling to Dialog component
 * - Grows upward with transform-origin bottom-left
 * - Compact menu items with icons
 * - Sections separated by dividers
 *
 * Menu item actions:
 * - System Settings: Opens nwg-look (GTK theme configurator)
 * - System Info: Opens Vicinae system info extension (vicinae://extensions/fbosch/sysinfo/system-info)
 * - System Updates: Opens terminal with flake_update_interactive command
 * - Lock Screen: Locks the session (hyprlock)
 * - Applications: Opens Warehouse (Flatpak/app store)
 * - Documents: Opens file manager in ~/Documents
 * - Pictures: Opens file manager in ~/Pictures
 * - Downloads: Opens file manager in ~/Downloads
 * - Suspend: Suspends the system
 * - Restart: Reboots the system
 * - Shutdown: Powers off the system
 *
 * System Updates:
 * - Shows conditional update counter below System Settings
 * - Displays when flake inputs have available updates
 * - Badge shows count in red (macOS-style)
 * - Updates via `nix flake update` check
 */

const menuVariants = cva(
  "bg-background-secondary/90 border border-white/15 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.1)] rounded-lg p-1 w-52",
  {
    variants: {
      isOpen: {
        true: "opacity-100 scale-100",
        false: "opacity-0 scale-y-0 pointer-events-none",
      },
      animated: {
        true: "transition-all duration-200",
        false: "",
      },
    },
    defaultVariants: {
      isOpen: false,
      animated: true,
    },
  },
);

const menuItemVariants = cva(
  "w-full flex items-center gap-2 px-2 py-1 text-xs rounded-md cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
        warning:
          "text-foreground-primary hover:text-state-warning hover:bg-state-warning/10 focus-visible:text-state-warning focus-visible:bg-state-warning/10 focus-visible:outline-none",
        danger:
          "text-foreground-primary hover:text-state-error hover:bg-state-error/10 focus-visible:text-state-error focus-visible:bg-state-error/10 focus-visible:outline-none",
        purple:
          "text-foreground-primary hover:text-state-purple hover:bg-state-purple/10 focus-visible:text-state-purple focus-visible:bg-state-purple/10 focus-visible:outline-none",
      },
      animated: {
        true: "transition-colors duration-150",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      animated: true,
    },
  },
);

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  variant?: "default" | "warning" | "danger" | "purple";
  onClick?: () => void;
}

export interface StartMenuProfile {
  mode: "default" | "gaming" | "powersave";
  source?: "none" | "manual" | "auto";
  gamingManual?: boolean;
  powersaveManual?: boolean;
}

export interface StartMenuProps extends VariantProps<typeof menuVariants> {
  /**
   * Control menu visibility
   */
  isOpen?: boolean;
  /**
   * Menu items to display
   */
  items?: MenuItem[];
  /**
   * Number of available system updates (flake inputs)
   * Shows conditional badge below System Settings when > 0
   */
  systemUpdatesCount?: number;
  /**
   * Current Hyprland profile state shown in the embedded profile controls.
   */
  profile?: StartMenuProfile;
  /**
   * Disable animations for better performance on slower systems
   */
  disableAnimations?: boolean;
  /**
   * Callback when menu should close
   */
  onClose?: () => void;
  /**
   * Callback when menu item is clicked
   */
  onItemClick?: (itemId: string) => void;
  /**
   * Callback when profile controls are clicked.
   */
  onProfileAction?: (action: "gaming" | "powersave" | "clear-manual") => void;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Position style (for absolute positioning in stories)
   */
  style?: React.CSSProperties;
}

const defaultMenuItems: MenuItem[] = [
  {
    id: "system-settings",
    label: "System Settings",
    icon: "\uE713", // Setting
    variant: "default",
  },
  {
    id: "system-info",
    label: "System Info",
    icon: "\uE946", // System (Info icon)
    variant: "default",
  },
  {
    id: "lock-screen",
    label: "Lock Screen",
    icon: "\uE72E", // Lock
    variant: "default",
  },
  { id: "divider-1", label: "", icon: "", variant: "default" },
  {
    id: "applications",
    label: "Applications",
    icon: "\uE71D", // AllApps
    variant: "default",
  },
  {
    id: "documents",
    label: "Documents",
    icon: "\uE8A5", // Document
    variant: "default",
  },
  {
    id: "pictures",
    label: "Pictures",
    icon: "\uE91B", // Pictures
    variant: "default",
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: "\uE896", // Download
    variant: "default",
  },
  { id: "divider-2", label: "", icon: "", variant: "default" },
  {
    id: "suspend",
    label: "Suspend",
    icon: "\uE708", // QuietHours
    variant: "purple",
  },
  {
    id: "restart",
    label: "Restart",
    icon: "\uE777", // UpdateRestore
    variant: "warning",
  },
  {
    id: "shutdown",
    label: "Shutdown",
    icon: "\uE7E8", // PowerButton
    variant: "danger",
  },
];

const defaultProfile: StartMenuProfile = {
  mode: "default",
  source: "none",
  gamingManual: false,
  powersaveManual: false,
};

const profileSummary = (profile: StartMenuProfile) => {
  if (profile.mode === "default") return "Default";
  const label = profile.mode === "gaming" ? "Gaming" : "Powersave";
  return profile.source && profile.source !== "none"
    ? `${label} (${profile.source})`
    : label;
};

export const StartMenu: React.FC<StartMenuProps> = ({
  isOpen = false,
  items = defaultMenuItems,
  systemUpdatesCount = 0,
  profile = defaultProfile,
  disableAnimations = false,
  onClose,
  onItemClick,
  onProfileAction,
  className,
  style,
}) => {
  const handleItemClick = (item: MenuItem) => {
    if (item.id.startsWith("divider")) return;

    if (item.onClick) {
      item.onClick();
    }

    if (onItemClick) {
      onItemClick(item.id);
    }

    if (onClose) {
      onClose();
    }
  };

  return (
    <div
      className={cn(
        menuVariants({ isOpen, animated: !disableAnimations }),
        "origin-bottom-left",
        className,
      )}
      style={style}
      role="menu"
      aria-hidden={!isOpen}
    >
      <div className="rounded-md border border-white/10 bg-white/[0.04] p-1.5 mb-1">
        <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
          <span className="text-xs font-semibold text-foreground-secondary">
            Profile
          </span>
          <span
            className={cn(
              "text-xs font-semibold",
              profile.mode === "gaming" && "text-state-success",
              profile.mode === "powersave" && "text-state-warning",
              profile.mode === "default" && "text-foreground-primary",
            )}
          >
            {profileSummary(profile)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={cn(
              "rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-foreground-primary hover:bg-white/10 focus-visible:outline-none focus-visible:bg-white/10",
              profile.mode === "gaming" && "border-state-success/40 bg-state-success/15",
            )}
            onClick={() => onProfileAction?.("gaming")}
            tabIndex={isOpen ? 0 : -1}
          >
            {profile.mode === "gaming" ? "Gaming on" : "Gaming"}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-foreground-primary hover:bg-white/10 focus-visible:outline-none focus-visible:bg-white/10",
              profile.mode === "powersave" && "border-state-warning/40 bg-state-warning/15",
            )}
            onClick={() => onProfileAction?.("powersave")}
            tabIndex={isOpen ? 0 : -1}
          >
            {profile.mode === "powersave" ? "Save on" : "Powersave"}
          </button>
        </div>
        {(profile.gamingManual || profile.powersaveManual) && (
          <button
            type="button"
            className="mt-1.5 w-full rounded-md px-2 py-1 text-xs font-semibold text-foreground-secondary hover:bg-white/10 focus-visible:outline-none focus-visible:bg-white/10"
            onClick={() => onProfileAction?.("clear-manual")}
            tabIndex={isOpen ? 0 : -1}
          >
            Clear manual profile
          </button>
        )}
      </div>
      {items.map((item, index) => {
        if (item.id.startsWith("divider")) {
          return (
            <hr key={item.id} className="border-t border-white/10 my-1" />
          );
        }

        const isSettingsItem = item.id === "system-settings";
        const showUpdateBadge = isSettingsItem && systemUpdatesCount > 0;

        return (
          <div key={item.id}>
            <button
              type="button"
              className={menuItemVariants({
                variant: item.variant,
                animated: !disableAnimations,
              })}
              onClick={() => handleItemClick(item)}
              role="menuitem"
              tabIndex={isOpen ? 0 : -1}
            >
              <span className="font-fluent text-xs" aria-hidden="true">
                {item.icon}
              </span>
              <span className="text-left">{item.label}</span>
            </button>
            {showUpdateBadge && (
              <button
                type="button"
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2 py-1 text-xs rounded-md cursor-pointer text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none pl-6",
                  !disableAnimations && "transition-colors duration-150",
                )}
                onClick={() => {
                  if (onItemClick) onItemClick("system-updates");
                  if (onClose) onClose();
                }}
                role="menuitem"
                tabIndex={isOpen ? 0 : -1}
              >
                <span className="flex items-center gap-2">
                  <span className="font-fluent text-xs" aria-hidden="true">
                    {"\uE895"}
                  </span>
                  <span className="text-left">System Updates</span>
                </span>
                <Tag variant="primary">{systemUpdatesCount}</Tag>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
