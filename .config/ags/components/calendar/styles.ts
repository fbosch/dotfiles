import app from "ags/gtk4/app";
import tokens from "../../../../design-system/tokens.json";

let applied = false;

export function applyCalendarStyles(): void {
	if (applied) return;
	applied = true;
	app.apply_css(
		`
window.calendar-widget {
  background-color: transparent;
  border: none;
  padding: 0;
}

window.calendar-widget box.calendar-container {
  background-color: ${tokens.colors.background.secondary.value}e6;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 12px;
  min-width: 336px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12);
  margin-bottom: 53px;
  margin-right: 4px;
}

window.calendar-widget box.calendar-header { margin-bottom: 12px; }
window.calendar-widget box.calendar-title-box { min-width: 0; }

window.calendar-widget button.calendar-nav-button {
  min-height: 28px;
  min-width: 28px;
  padding: 0 6px;
  border-radius: 6px;
  background-color: transparent;
  color: ${tokens.colors.foreground.secondary.value};
  border: none;
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-size: 12px;
}

window.calendar-widget button.today-button {
  padding-left: 8px;
  padding-right: 8px;
}

window.calendar-widget button.calendar-nav-button:hover,
window.calendar-widget button.calendar-nav-button:focus {
  background-color: rgba(255, 255, 255, 0.1);
  color: ${tokens.colors.foreground.primary.value};
}

window.calendar-widget label.calendar-title {
  color: ${tokens.colors.foreground.primary.value};
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  text-transform: capitalize;
}

window.calendar-widget label.calendar-status {
  color: ${tokens.colors.foreground.tertiary.value};
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-size: 11px;
}

window.calendar-widget box.calendar-weekdays { margin-bottom: 4px; }

window.calendar-widget box.calendar-day-grid {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

window.calendar-widget label.calendar-weekday {
  color: ${tokens.colors.foreground.tertiary.value};
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
}

window.calendar-widget button.calendar-day {
  min-width: 48px;
  min-height: 48px;
  padding: 0;
  border-radius: 0;
  border: none;
  background-color: transparent;
  color: ${tokens.colors.foreground.primary.value};
  font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
}

window.calendar-widget box.calendar-day-content { padding: 4px; }
window.calendar-widget button.calendar-day.not-first-column { border-left: 1px solid rgba(255, 255, 255, 0.08); }
window.calendar-widget button.calendar-day.not-first-row { border-top: 1px solid rgba(255, 255, 255, 0.08); }

window.calendar-widget button.calendar-day:hover,
window.calendar-widget button.calendar-day:focus {
  background-color: rgba(255, 255, 255, 0.1);
}

window.calendar-widget button.calendar-day.selected {
  border-radius: 6px;
  background-color: ${tokens.colors.accent.primary.value}33;
  box-shadow: inset 0 0 0 1px ${tokens.colors.accent.primary.value};
}

window.calendar-widget button.calendar-day.today.selected { background-color: ${tokens.colors.accent.primary.value}33; }

window.calendar-widget button.calendar-day.outside-month {
  opacity: 0.5;
  color: rgba(153, 153, 153, 0.35);
}

window.calendar-widget label.calendar-day-number {
  font-size: 12px;
  color: inherit;
}

window.calendar-widget button.calendar-day.today label.calendar-day-number { font-weight: 600; }
window.calendar-widget button.calendar-day.today { background-color: rgba(255, 255, 255, 0.15); }

window.calendar-widget box.calendar-event-marker {
  border-radius: 999px;
  min-width: 6px;
  min-height: 6px;
}

window.calendar-widget label.calendar-marker-overflow {
  font-size: 9px;
  color: ${tokens.colors.foreground.tertiary.value};
}
`,
		false,
	);
}
