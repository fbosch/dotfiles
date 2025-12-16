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
 * - System Updates: Opens terminal with flake_update_interactive command
 * - Lock Screen: Locks the session (hyprlock)
 * - Applications: Opens Warehouse (Flatpak/app store)
 * - Documents: Opens file manager in ~/Documents
 * - Pictures: Opens file manager in ~/Pictures
 * - Downloads: Opens file manager in ~/Downloads
 * - Sleep: Suspends the system
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
  "bg-background-secondary/90 border border-white/15 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.1)] rounded-lg p-1 w-52 transition-all duration-200",
  {
    variants: {
      isOpen: {
        true: "opacity-100 scale-100",
        false: "opacity-0 scale-y-0 pointer-events-none",
      },
    },
    defaultVariants: {
      isOpen: false,
    },
  },
);

const menuItemVariants = cva(
  "w-full flex items-center gap-2 px-2 py-1 text-xs rounded-md transition-colors duration-150 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
        warning:
          "text-state-warning hover:bg-state-warning/10 focus-visible:bg-state-warning/10 focus-visible:outline-none",
        danger:
          "text-state-error hover:bg-state-error/10 focus-visible:bg-state-error/10 focus-visible:outline-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  variant?: "default" | "warning" | "danger";
  onClick?: () => void;
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
   * Callback when menu should close
   */
  onClose?: () => void;
  /**
   * Callback when menu item is clicked
   */
  onItemClick?: (itemId: string) => void;
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
    id: "sleep",
    label: "Sleep",
    icon: "\uE708", // QuietHours
    variant: "default",
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

export const StartMenu: React.FC<StartMenuProps> = ({
  isOpen = false,
  items = defaultMenuItems,
  systemUpdatesCount = 0,
  onClose,
  onItemClick,
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
      className={cn(menuVariants({ isOpen }), "origin-bottom-left", className)}
      style={style}
      role="menu"
      aria-hidden={!isOpen}
    >
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
              className={menuItemVariants({ variant: item.variant })}
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
                className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs rounded-md transition-colors duration-150 cursor-pointer text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none pl-6"
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
