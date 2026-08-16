import type Gtk from 'gi://Gtk?version=4.0';
import { getProfileState, isGamingResolved, subscribeProfileState } from './profile-state';

const boundWidgets = new Set<Gtk.Widget>();

let gamingActive = isGamingResolved(getProfileState());
let unsubscribeProfileState: (() => void) | null = null;

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

export function bindGamingOpacity(widget: Gtk.Widget): void {
  startProfileStateSubscription();
  boundWidgets.add(widget);
  widget.connect('destroy', (destroyedWidget: Gtk.Widget) => {
    boundWidgets.delete(destroyedWidget);
  });
  applyState(widget);
}
