import { cva, type VariantProps } from 'class-variance-authority';
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { Tag } from '../Tag';
import { TripleToggle, type TripleToggleOption } from '../TripleToggle';

const menuVariants = cva(
  'w-72 rounded-lg border border-white/10 bg-background-secondary/85 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28),0_4px_12px_rgba(0,0,0,0.14)] backdrop-blur-xl',
  {
    variants: {
      isOpen: {
        true: 'scale-100 opacity-100',
        false: 'pointer-events-none scale-y-0 opacity-0',
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

const menuItemVariants = cva('flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm', {
  variants: {
    variant: {
      default:
        'text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none',
      warning:
        'text-foreground-primary hover:bg-state-warning/10 hover:text-state-warning focus-visible:bg-state-warning/10 focus-visible:text-state-warning focus-visible:outline-none',
      danger:
        'text-foreground-primary hover:bg-state-error/10 hover:text-state-error focus-visible:bg-state-error/10 focus-visible:text-state-error focus-visible:outline-none',
      purple:
        'text-foreground-primary hover:bg-state-purple/10 hover:text-state-purple focus-visible:bg-state-purple/10 focus-visible:text-state-purple focus-visible:outline-none',
    },
    animated: {
      true: 'transition-colors duration-150',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    animated: true,
  },
});

export type StartMenuItemVariant = 'default' | 'warning' | 'danger' | 'purple';

export interface StartMenuActionItem {
  type: 'action';
  id: string;
  label: string;
  icon: string;
  variant?: StartMenuItemVariant;
  onClick?: () => void;
}

export interface StartMenuSeparatorItem {
  type: 'separator';
  id: string;
}

export interface StartMenuRecentItemsItem {
  type: 'recent-items';
  id: 'recent-items';
  label: string;
  icon: string;
}

export type StartMenuItem = StartMenuActionItem | StartMenuSeparatorItem | StartMenuRecentItemsItem;

export interface RecentMenuItem {
  id: string;
  label: string;
  icon?: string;
  detail?: string;
}

export interface RecentItems {
  applications?: RecentMenuItem[];
  documents?: RecentMenuItem[];
}

export interface StartMenuProfile {
  mode: 'default' | 'gaming' | 'powersave';
  source?: 'none' | 'manual' | 'auto';
  manualMode: 'default' | 'gaming' | 'powersave';
}

export interface StartMenuUser {
  name: string;
  avatarSrc?: string;
}

export interface StartMenuProps extends VariantProps<typeof menuVariants> {
  isOpen?: boolean;
  items?: StartMenuItem[];
  recentItems?: RecentItems;
  nixFlakeUpdatesCount?: number;
  flatpakUpdatesCount?: number;
  profile?: StartMenuProfile;
  user?: StartMenuUser;
  disableAnimations?: boolean;
  onClose?: () => void;
  onItemClick?: (itemId: string) => void;
  onRecentItemClick?: (item: RecentMenuItem) => void;
  onClearRecentItems?: () => void;
  onProfileChange?: (mode: StartMenuProfile['manualMode']) => void;
  className?: string;
  style?: CSSProperties;
}

const defaultMenuItems: StartMenuItem[] = [
  { type: 'action', id: 'about-this-pc', label: 'About This PC', icon: '\uE946' },
  { type: 'action', id: 'system-settings', label: 'System Settings', icon: '\uE713' },
  { type: 'action', id: 'system-updates', label: 'System Updates', icon: '\uE895' },
  { type: 'separator', id: 'before-locations' },
  { type: 'action', id: 'applications', label: 'Applications', icon: '\uE71D' },
  { type: 'action', id: 'documents', label: 'Documents', icon: '\uE8A5' },
  { type: 'action', id: 'pictures', label: 'Pictures', icon: '\uE91B' },
  { type: 'action', id: 'downloads', label: 'Downloads', icon: '\uE896' },
  { type: 'recent-items', id: 'recent-items', label: 'Recent Items', icon: '\uE81C' },
  { type: 'separator', id: 'after-recent-items' },
  { type: 'action', id: 'force-quit', label: 'Force Quit', icon: '\uE7BA' },
  { type: 'separator', id: 'session-actions' },
  { type: 'action', id: 'suspend', label: 'Suspend', icon: '\uE708', variant: 'purple' },
  { type: 'action', id: 'restart', label: 'Restart', icon: '\uE777', variant: 'warning' },
  { type: 'action', id: 'shutdown', label: 'Shutdown', icon: '\uE7E8', variant: 'danger' },
  { type: 'separator', id: 'account-actions' },
  { type: 'action', id: 'lock-screen', label: 'Lock Screen', icon: '\uE72E' },
  { type: 'action', id: 'sign-out', label: 'Log out', icon: '\uE8AB', variant: 'warning' },
];

const defaultProfile: StartMenuProfile = {
  mode: 'default',
  source: 'none',
  manualMode: 'default',
};

const defaultUser: StartMenuUser = {
  name: 'Frederik Bosch',
};

const initialsForName = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export const StartMenu = ({
  isOpen = false,
  items = defaultMenuItems,
  recentItems = {},
  nixFlakeUpdatesCount = 0,
  flatpakUpdatesCount = 0,
  profile = defaultProfile,
  user = defaultUser,
  disableAnimations = false,
  onClose,
  onItemClick,
  onRecentItemClick,
  onClearRecentItems,
  onProfileChange,
  className,
  style,
}: StartMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const recentItemsTriggerRef = useRef<HTMLButtonElement>(null);
  const recentItemsMenuRef = useRef<HTMLDivElement>(null);
  const recentItemsMenuId = useId();
  const [recentItemsOpen, setRecentItemsOpen] = useState(false);
  const applications = recentItems.applications ?? [];
  const documents = recentItems.documents ?? [];
  const hasRecentItems = applications.length > 0 || documents.length > 0;
  const automaticGamingActive = profile.mode === 'gaming' && profile.source === 'auto';
  const manualProfile = profile.manualMode;
  const profileOptions: readonly [
    TripleToggleOption<StartMenuProfile['manualMode']>,
    TripleToggleOption<StartMenuProfile['manualMode']>,
    TripleToggleOption<StartMenuProfile['manualMode']>,
  ] = [
    {
      value: 'default',
      label: 'Auto',
      icon: <span className="font-fluent">{'\uF8B0'}</span>,
      badge: automaticGamingActive ? (
        <span className="absolute -bottom-1 -right-1.5 grid size-3.5 place-items-center rounded-full bg-state-success font-nerd text-[8px] text-state-success-foreground ring-2 ring-accent-primary">
          {'\u{F02B4}'}
        </span>
      ) : undefined,
      ariaLabel: automaticGamingActive
        ? 'Automatic profile rules; Game Mode is active'
        : 'Automatic profile rules',
      title: automaticGamingActive
        ? 'Game Mode is active automatically'
        : 'Use automatic profile rules',
    },
    {
      value: 'gaming',
      label: 'Gaming',
      icon: <span className="font-nerd">{'\u{F02B4}'}</span>,
      ariaLabel: 'Manual Gaming profile',
      title: 'Select manual Gaming profile',
    },
    {
      value: 'powersave',
      label: 'Saver',
      icon: <span className="font-fluent">{'\uEA95'}</span>,
      ariaLabel: 'Manual Power Saver profile',
      title: 'Select manual Power Saver profile',
    },
  ];

  useEffect(() => {
    if (isOpen === false) {
      setRecentItemsOpen(false);
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;

      setRecentItemsOpen(false);
      onClose?.();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onClose]);

  const focusMenuItem = (current: HTMLButtonElement, direction: 1 | -1) => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"], [data-triple-toggle-option]'
      ) ?? []
    ).filter((item) => item.tabIndex !== -1 && item.disabled === false);
    const currentIndex = menuItems.indexOf(current);
    const nextIndex = (currentIndex + direction + menuItems.length) % menuItems.length;
    menuItems[nextIndex]?.focus();
  };

  const openRecentItems = () => {
    setRecentItemsOpen(true);
  };

  const openRecentItemsAndFocusFirstItem = () => {
    openRecentItems();
    requestAnimationFrame(() => {
      recentItemsMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
  };

  const handleMenuItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem(event.currentTarget, 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(event.currentTarget, -1);
      return;
    }

    if (event.key === 'ArrowRight' && event.currentTarget === recentItemsTriggerRef.current) {
      event.preventDefault();
      openRecentItemsAndFocusFirstItem();
      return;
    }

    if (
      event.key === 'ArrowLeft' &&
      recentItemsMenuRef.current?.contains(event.currentTarget) === true
    ) {
      event.preventDefault();
      setRecentItemsOpen(false);
      recentItemsTriggerRef.current?.focus();
      return;
    }

    if (event.key !== 'Escape') return;

    event.preventDefault();
    if (recentItemsMenuRef.current?.contains(event.currentTarget) === true) {
      setRecentItemsOpen(false);
      recentItemsTriggerRef.current?.focus();
      return;
    }

    onClose?.();
  };

  const handleActionClick = (item: StartMenuActionItem) => {
    item.onClick?.();
    onItemClick?.(item.id);
    onClose?.();
  };

  const handleRecentItemClick = (item: RecentMenuItem) => {
    onRecentItemClick?.(item);
    setRecentItemsOpen(false);
    onClose?.();
  };

  const renderRecentItem = (item: RecentMenuItem) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      tabIndex={isOpen && recentItemsOpen ? 0 : -1}
      className={cn(menuItemVariants({ animated: !disableAnimations }), 'min-w-0 text-left')}
      onClick={() => handleRecentItemClick(item)}
      onKeyDown={handleMenuItemKeyDown}
    >
      {item.icon && (
        <span className="font-fluent text-xs" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.detail && (
        <span className="max-w-24 truncate text-[11px] text-foreground-tertiary">
          {item.detail}
        </span>
      )}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className={cn(
        menuVariants({ isOpen, animated: !disableAnimations }),
        'origin-bottom-left',
        className
      )}
      style={style}
      role="menu"
      aria-hidden={!isOpen}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-xs font-semibold text-foreground-primary ring-1 ring-white/15">
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
          <div className="truncate text-sm font-medium text-foreground-primary">{user.name}</div>
        </div>
      </div>
      <hr className="my-1.5 border-t border-white/10" />
      {items.map((item) => {
        if (item.type === 'separator') {
          return <hr key={item.id} className="my-1.5 border-t border-white/10" />;
        }

        if (item.type === 'recent-items') {
          return (
            <div key={item.id}>
              <div className="relative" onPointerEnter={openRecentItems}>
                <button
                  ref={recentItemsTriggerRef}
                  type="button"
                  role="menuitem"
                  tabIndex={isOpen ? 0 : -1}
                  className={cn(
                    menuItemVariants({ animated: !disableAnimations }),
                    'justify-between',
                    recentItemsOpen
                      ? 'bg-accent-primary text-white hover:bg-accent-hover focus-visible:bg-accent-hover'
                      : ''
                  )}
                  aria-haspopup="menu"
                  aria-controls={recentItemsMenuId}
                  aria-expanded={recentItemsOpen}
                  onClick={() => setRecentItemsOpen((open) => !open)}
                  onKeyDown={handleMenuItemKeyDown}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-fluent text-xs" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="truncate text-left">{item.label}</span>
                  </span>
                  <span className="font-fluent text-[10px]" aria-hidden="true">
                    {'\uE76C'}
                  </span>
                </button>
                {recentItemsOpen && (
                  <div
                    ref={recentItemsMenuRef}
                    id={recentItemsMenuId}
                    className="absolute bottom-0 left-full z-10 ml-2 w-80 rounded-lg border border-white/10 bg-background-secondary/85 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28),0_4px_12px_rgba(0,0,0,0.14)] backdrop-blur-xl"
                    role="menu"
                    aria-label={item.label}
                  >
                    {hasRecentItems === false ? (
                      <p className="px-2.5 py-4 text-center text-sm text-foreground-tertiary">
                        No recent items
                      </p>
                    ) : (
                      <>
                        {applications.length > 0 && (
                          <div>
                            <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-foreground-secondary">
                              Applications
                            </p>
                            {applications.map(renderRecentItem)}
                          </div>
                        )}
                        {applications.length > 0 && documents.length > 0 && (
                          <hr className="my-1.5 border-t border-white/10" />
                        )}
                        {documents.length > 0 && (
                          <div>
                            <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-foreground-secondary">
                              Documents
                            </p>
                            {documents.map(renderRecentItem)}
                          </div>
                        )}
                      </>
                    )}
                    <hr className="my-1.5 border-t border-white/10" />
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={isOpen && recentItemsOpen ? 0 : -1}
                      className={menuItemVariants({
                        variant: 'danger',
                        animated: !disableAnimations,
                      })}
                      onClick={onClearRecentItems}
                      onKeyDown={handleMenuItemKeyDown}
                    >
                      <span className="font-fluent text-xs" aria-hidden="true">
                        {'\uE74D'}
                      </span>
                      Clear Recent Items
                    </button>
                  </div>
                )}
              </div>
              <hr className="my-1.5 border-t border-white/10" />
              <div className="my-3">
                <TripleToggle
                  className="mx-auto"
                  options={profileOptions}
                  value={manualProfile}
                  ariaLabel="Manual performance profile"
                  onValueChange={onProfileChange}
                  onKeyDown={handleMenuItemKeyDown}
                  tabIndex={isOpen ? 0 : -1}
                  animated={!disableAnimations}
                />
              </div>
            </div>
          );
        }

        const showNixFlakeUpdates = item.id === 'system-updates' && nixFlakeUpdatesCount > 0;
        const showFlatpakUpdates = item.id === 'system-updates' && flatpakUpdatesCount > 0;
        const showUpdateBadges = showNixFlakeUpdates || showFlatpakUpdates;

        return (
          <div key={item.id}>
            <button
              type="button"
              role="menuitem"
              tabIndex={isOpen ? 0 : -1}
              className={cn(
                menuItemVariants({
                  variant: item.variant,
                  animated: !disableAnimations,
                }),
                showUpdateBadges && 'justify-between'
              )}
              onClick={() => handleActionClick(item)}
              onKeyDown={handleMenuItemKeyDown}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="font-fluent text-xs" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="truncate text-left">{item.label}</span>
              </span>
              {showUpdateBadges && (
                <span className="flex items-center gap-1">
                  {showNixFlakeUpdates && (
                    <Tag
                      variant="primary"
                      className="gap-1"
                      title="Nix flake updates"
                      aria-label={`Nix flake updates: ${nixFlakeUpdatesCount}`}
                    >
                      <span className="font-nerd" aria-hidden="true">
                        {'\uE843'}
                      </span>
                      {nixFlakeUpdatesCount}
                    </Tag>
                  )}
                  {showFlatpakUpdates && (
                    <Tag
                      variant="primary"
                      className="gap-1"
                      title="Flatpak updates"
                      aria-label={`Flatpak updates: ${flatpakUpdatesCount}`}
                    >
                      <span className="font-nerd" aria-hidden="true">
                        {'\uF1B2'}
                      </span>
                      {flatpakUpdatesCount}
                    </Tag>
                  )}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};
