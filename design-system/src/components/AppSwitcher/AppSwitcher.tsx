import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';

/**
 * AppSwitcher component - Alt+Tab application switcher
 * macOS-style window switcher overlay with backdrop blur
 *
 * Design reference:
 * - Centered horizontally and vertically
 * - Semi-transparent background with backdrop blur
 * - Rounded container with padding
 * - Application icons in a horizontal row
 * - Selected app has border and additional styling
 * - App name displayed below selected icon
 *
 * Keyboard behavior:
 * - Alt+Tab: Next application
 * - Alt+Shift+Tab: Previous application
 * - Release Alt: Switch to selected application
 */

const switcherVariants = cva(
  'bg-background-secondary/50 backdrop-blur-lg border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl p-6',
  {
    variants: {
      isOpen: {
        true: 'opacity-100 scale-100',
        false: 'opacity-0 scale-95 pointer-events-none',
      },
      animated: {
        true: 'transition-all duration-200',
        false: '',
      },
    },
    defaultVariants: {
      isOpen: false,
      animated: true,
    },
  }
);

const appIconVariants = cva('flex flex-col items-center gap-2 p-3 rounded-xl', {
  variants: {
    selected: {
      true: 'bg-background-tertiary/60 border-2 border-accent-active',
      false: 'border-2 border-transparent',
    },
    animated: {
      true: 'transition-all duration-150',
      false: '',
    },
  },
  defaultVariants: {
    selected: false,
    animated: true,
  },
});

const appPreviewVariants = cva(
  'flex flex-col items-center gap-3 p-3 rounded-xl overflow-hidden',
  {
    variants: {
      selected: {
        true: 'bg-background-tertiary/60 border-2 border-accent-active',
        false: 'border-2 border-transparent opacity-70',
      },
      animated: {
        true: 'transition-all duration-150',
        false: '',
      },
    },
    defaultVariants: {
      selected: false,
      animated: true,
    },
  }
);

export interface AppItem {
  /**
   * Unique identifier for the application
   */
  id: string;
  /**
   * Application name
   */
  name: string;
  /**
   * Path to application icon image
   */
  icon: string;
  /**
   * Optional badge count (e.g., notifications)
   */
  badge?: number;
  /**
   * Optional preview image URL
   */
  preview?: string;
  /**
   * Aspect ratio of the preview (width / height)
   * e.g., 16/9 for landscape, 9/16 for portrait
   * Defaults to 16/9 if not specified
   */
  aspectRatio?: number;
}

export interface AppSwitcherProps extends VariantProps<typeof switcherVariants> {
  /**
   * Control switcher visibility
   */
  isOpen?: boolean;
  /**
   * List of applications to display
   */
  apps?: AppItem[];
  /**
   * Index of currently selected application
   */
  selectedIndex?: number;
  /**
   * Disable animations for better performance
   */
  disableAnimations?: boolean;
  /**
   * Show application previews instead of just icons
   */
  showPreviews?: boolean;
  /**
   * Callback when selection changes
   */
  onSelectionChange?: (index: number) => void;
  /**
   * Callback when app is activated (Alt key released)
   */
  onActivate?: (appId: string) => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const AppSwitcher: React.FC<AppSwitcherProps> = ({
  isOpen = false,
  apps = [],
  selectedIndex = 0,
  disableAnimations = false,
  showPreviews = false,
  onSelectionChange,
  onActivate,
  className,
}) => {
  const selectedApp = apps[selectedIndex];

  return (
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center z-50',
        !isOpen && 'pointer-events-none'
      )}
      role="dialog"
      aria-hidden={!isOpen}
      aria-label="Application Switcher"
    >
      <div className={cn(switcherVariants({ isOpen, animated: !disableAnimations }), className)}>
        {/* Application icons/previews row */}
        <div className="flex items-center gap-3">
          {apps.map((app, index) => (
            <button
              key={app.id}
              type="button"
              className={
                showPreviews
                  ? appPreviewVariants({
                      selected: index === selectedIndex,
                      animated: !disableAnimations,
                    })
                  : appIconVariants({
                      selected: index === selectedIndex,
                      animated: !disableAnimations,
                    })
              }
              onClick={() => {
                if (onSelectionChange) onSelectionChange(index);
                if (onActivate) onActivate(app.id);
              }}
              aria-label={`Switch to ${app.name}`}
              aria-current={index === selectedIndex ? 'true' : 'false'}
            >
              {showPreviews && app.preview ? (
                (() => {
                  // Fixed height, width calculated from aspect ratio
                  const aspectRatio = app.aspectRatio ?? 16 / 9;
                  const height = 176; // Fixed height in pixels
                  const width = height * aspectRatio;
                  
                  return (
                    <div className="flex flex-col gap-3" style={{ width: `${width}px` }}>
                      {/* App info row at top */}
                      <div className="flex items-center gap-2 px-1">
                        <img src={app.icon} alt={app.name} className="w-5 h-5 rounded" />
                        <span className="text-foreground-primary text-xs font-medium truncate">
                          {app.name}
                        </span>
                      </div>
                      {/* Preview image */}
                      <div 
                        className="relative bg-background-primary rounded-lg overflow-hidden"
                        style={{ width: `${width}px`, height: `${height}px` }}
                      >
                        <img
                          src={app.preview}
                          alt={`${app.name} preview`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="relative">
                  <img src={app.icon} alt={app.name} className="w-16 h-16 rounded-lg" />
                  {app.badge !== undefined && app.badge > 0 && (
                    <span className="absolute -top-1 -right-1 bg-state-error text-white text-xs font-medium rounded-full w-5 h-5 flex items-center justify-center">
                      {app.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Selected app name (only show for icon mode) */}
        {!showPreviews && selectedApp && (
          <div className="mt-3 text-center">
            <span className="text-foreground-primary text-sm">{selectedApp.name}</span>
          </div>
        )}
      </div>
    </div>
  );
};
