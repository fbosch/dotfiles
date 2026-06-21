import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../../utils/cn";
import { Tag } from "../Tag";

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

const profileOptionVariants = cva(
  "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium leading-none focus-visible:outline-none active:scale-[0.98]",
  {
    variants: {
      active: {
        true: "shadow-sm",
        false:
          "text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:bg-white/10 focus-visible:text-foreground-primary",
      },
      tone: {
        auto: "",
        gaming: "",
        powersave: "",
      },
      animated: {
        true: "transition-colors duration-150",
        false: "",
      },
    },
    compoundVariants: [
      {
        active: true,
        tone: "auto",
        className: "bg-white/[0.12] text-foreground-primary ring-1 ring-white/10",
      },
      {
        active: true,
        tone: "gaming",
        className: "bg-state-success/15 text-state-success ring-1 ring-state-success/40",
      },
      {
        active: true,
        tone: "powersave",
        className: "bg-state-warning/15 text-state-warning ring-1 ring-state-warning/40",
      },
    ],
    defaultVariants: {
      active: false,
      tone: "auto",
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

export interface StartMenuUser {
  name: string;
  avatarSrc?: string;
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
   * User card shown at the top of the menu.
   */
  user?: StartMenuUser;
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

const defaultUser: StartMenuUser = {
  name: "Frederik Bosch",
};

const initialsForName = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

const profileModeLabel = (mode: StartMenuProfile["mode"]) => {
  if (mode === "gaming") return "Gaming";
  if (mode === "powersave") return "Saver";
  return "Balanced";
};

const profileSourceLabel = (profile: StartMenuProfile) => {
  if (profile.source === "manual") return "Manual";
  return "Auto";
};

export const StartMenu: React.FC<StartMenuProps> = ({
  isOpen = false,
  items = defaultMenuItems,
  systemUpdatesCount = 0,
  profile = defaultProfile,
  user = defaultUser,
  disableAnimations = false,
  onClose,
  onItemClick,
  onProfileAction,
  className,
  style,
}) => {
  const gamingManualActive =
    profile.gamingManual || (profile.source === "manual" && profile.mode === "gaming");
  const powersaveManualActive =
    profile.powersaveManual || (profile.source === "manual" && profile.mode === "powersave");
  const autoControlActive = !gamingManualActive && !powersaveManualActive;

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
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-[11px] font-semibold text-foreground-primary ring-1 ring-white/15">
          {user.avatarSrc ? (
            <img
              src={user.avatarSrc}
              alt=""
              className="size-full object-cover"
              aria-hidden="true"
            />
          ) : (
            initialsForName(user.name)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground-primary">
            {user.name}
          </div>
        </div>
      </div>
      <div className="mb-1 rounded-lg bg-background-primary/30 p-1">
        <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-[11px] leading-tight">
          <span className="font-medium text-foreground-primary">Profile</span>
          <span className="truncate text-foreground-secondary">
            {profileModeLabel(profile.mode)} · {profileSourceLabel(profile)}
          </span>
        </div>
        <fieldset
          className="mt-1 flex items-center gap-1 rounded-md bg-background-primary/50 p-0.5"
          aria-label="Profile controls"
        >
          <button
            type="button"
            className={profileOptionVariants({
              active: autoControlActive,
              tone: "auto",
              animated: !disableAnimations,
            })}
            onClick={() => onProfileAction?.("clear-manual")}
            tabIndex={isOpen ? 0 : -1}
            aria-label="Use automatic profile"
            aria-pressed={autoControlActive}
            title="Let automatic profile rules decide"
          >
            Auto
          </button>
          <button
            type="button"
            className={profileOptionVariants({
              active: gamingManualActive,
              tone: "gaming",
              animated: !disableAnimations,
            })}
            onClick={() => onProfileAction?.("gaming")}
            tabIndex={isOpen ? 0 : -1}
            aria-label="Toggle gaming profile"
            aria-pressed={gamingManualActive}
            title={gamingManualActive ? "Disable manual gaming profile" : "Enable manual gaming profile"}
          >
            <span className="font-fluent text-[11px]" aria-hidden="true">
              {"\uE7FC"}
            </span>
          </button>
          <button
            type="button"
            className={profileOptionVariants({
              active: powersaveManualActive,
              tone: "powersave",
              animated: !disableAnimations,
            })}
            onClick={() => onProfileAction?.("powersave")}
            tabIndex={isOpen ? 0 : -1}
            aria-label="Toggle powersave profile"
            aria-pressed={powersaveManualActive}
            title={powersaveManualActive ? "Disable manual powersave profile" : "Enable manual powersave profile"}
          >
            <span className="font-fluent text-[11px]" aria-hidden="true">
              {"\uE945"}
            </span>
          </button>
        </fieldset>
      </div>
      <hr className="my-1 border-t border-white/10" />
      {items.map((item) => {
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
