import type Gtk from 'gi://Gtk?version=4.0';
import app from 'ags/gtk4/app';
import tokens from '../../../design-system/tokens.json';
import { getProfileState, isGamingResolved, subscribeProfileState } from './profile-state';

const boundWidgets = new Set<Gtk.Widget>();

let gamingActive = isGamingResolved(getProfileState());
let unsubscribeProfileState: (() => void) | null = null;
let stylesApplied = false;

function applyState(widget: Gtk.Widget): void {
  if (gamingActive) {
    widget.add_css_class('gaming-opaque');
    return;
  }

  widget.remove_css_class('gaming-opaque');
}

function refreshState(): void {
  const nextGamingActive = isGamingResolved(getProfileState());
  if (nextGamingActive === gamingActive) return;

  gamingActive = nextGamingActive;
  for (const widget of boundWidgets) {
    applyState(widget);
  }
}

function startProfileStateSubscription(): void {
  if (unsubscribeProfileState !== null) return;

  unsubscribeProfileState = subscribeProfileState(() => refreshState());
}

function applyStyles(): void {
  if (stylesApplied) return;
  stylesApplied = true;

  app.apply_css(
    `
      window.start-menu.gaming-opaque box.start-menu-container,
      window.start-menu.gaming-opaque box.recent-items-menu,
      window.calendar-widget.gaming-opaque box.calendar-container,
      window.audio-mixer-widget.gaming-opaque box.audio-mixer-container,
      window.force-quit.gaming-opaque box.force-quit-container,
      window.about-this-pc.gaming-opaque box.about-container,
      window.confirm-dialog.gaming-opaque box.dialog-box {
        background-color: ${tokens.colors.background.secondary.value};
      }

      window.keyboard-layout-switcher.gaming-opaque box.keyboard-switcher-container,
      window.volume-indicator.gaming-opaque box.indicator-container {
        background-color: ${tokens.colors.background.tertiary.value};
      }

      window.desktop-clock.gaming-opaque box.clock-container {
        background-color: rgb(0, 0, 0);
      }

    `,
    false
  );
}

export function bindGamingOpacity(widget: Gtk.Widget): void {
  applyStyles();
  startProfileStateSubscription();
  boundWidgets.add(widget);
  widget.connect('destroy', (destroyedWidget: Gtk.Widget) => {
    boundWidgets.delete(destroyedWidget);
  });
  applyState(widget);
}
