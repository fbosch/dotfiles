# Kiwi-Inspired Start Menu Plan

Evolve `StartMenu` into the single visual contract for a Kiwi Menu-inspired system menu. The design system defines appearance, interaction, and display-ready data. AGS later owns system discovery, process control, command execution, and layer-shell lifecycle.

## Scope

Include:

- Recent applications and documents
- Force Quit
- About This PC
- Existing lock, suspend, sign-out, restart, and shutdown actions
- Existing profile controls and update indicators

Exclude:

- User switching
- Custom commands

Replace the static Documents, Pictures, and Downloads entries with a Recent Items submenu. Replace System Info with About This PC.

## Phase 1: Design System

### StartMenu contract

Refine `src/components/StartMenu/StartMenu.tsx`.

- Replace divider detection based on `id.startsWith("divider")` with an explicit discriminated item model for actions, separators, and submenu triggers.
- Keep the component controlled through `isOpen` and `onClose`.
- Preserve profile controls, update badges, semantic action tones, and `disableAnimations`.
- Keep all system behavior outside the component. It must receive display-ready data and emit user intent through callbacks.
- Give the Recent Items trigger `aria-haspopup`, `aria-expanded`, and a relationship to its submenu.

### Recent Items

Add a submenu containing independent Applications and Documents groups.

- Accept recent-item data through props.
- Render an empty state when both groups are empty.
- Include a Clear Recent Items action.
- Close the submenu and parent menu after an item is activated.
- Support click, Enter, Space, Escape, arrow navigation, and focus return to the trigger.
- Support pointer hover as an optional convenience, not as the only access path.
- Start without Kiwi's pointer bridge. Add it only if ordinary submenu positioning proves insufficient in use.

### Force Quit dialog

Add:

```text
src/components/ForceQuitDialog/ForceQuitDialog.tsx
src/components/ForceQuitDialog/ForceQuitDialog.stories.tsx
src/components/ForceQuitDialog/index.ts
```

- Accept running applications with an ID, name, icon, CPU text, and memory text.
- Own item selection and the disabled state of the Force Quit button.
- Expose `onForceQuit(appId)` and `onClose` rather than process-control details.
- Cover populated, empty, and unavailable states in stories.
- Reuse `Window` only if its existing application-chrome contract fits without leaking Force Quit-specific behavior into it.

### About This PC surface

Add:

```text
src/components/AboutThisPC/AboutThisPC.tsx
src/components/AboutThisPC/AboutThisPC.stories.tsx
src/components/AboutThisPC/index.ts
```

- Accept display-ready device data: image or icon, model, vendor, processor, memory, desktop, and OS.
- Omit unavailable rows instead of inventing fallback values.
- Expose `onMoreInfo` and `onClose`.
- Reuse `Window` when its existing contract fits.

### Stories

Update `src/components/StartMenu/StartMenu.stories.tsx`.

- Preserve the interactive desktop composition.
- Add essential Recent Items stories for populated and empty data.
- Add a composed flow where StartMenu actions open Force Quit and About This PC.
- Use Storybook action spies instead of `console.log` callbacks.
- Do not add stories that only duplicate item-tone combinations.

### Styling and accessibility

- Use Tailwind utilities and existing design tokens only.
- Keep the main menu compact at its existing width; position the submenu alongside it and constrain it within the viewport in compositions.
- Use native buttons, explicit `type="button"`, and visible `focus-visible` styling for every interactive control.
- Use existing background, foreground, border, accent, and semantic state tokens. Add a token only for a repeated semantic need.

## Phase 1 Validation

Run from `design-system/`:

```bash
pnpm lint
pnpm build
pnpm contrast
pnpm build-storybook
```

Verify in Storybook:

- The Recent Items submenu opens by pointer and keyboard.
- Escape closes the submenu before closing the parent menu.
- Focus returns to the Recent Items trigger.
- Opening a recent item closes both menus.
- Clear Recent Items invokes only its callback.
- Force Quit remains disabled until an application is selected.
- About This PC handles missing optional rows.
- Storybook accessibility checks report no violations.
- The composition remains usable on desktop and narrow viewports.

## Phase 2: AGS Integration

Evolve `.config/ags/lib/start-menu.tsx` in place after the design-system contract is stable.

### Menu integration

- Mirror the final StartMenu model and visual hierarchy in GTK.
- Preserve the current profile state, NixOS and Flatpak update state, confirmation scripts, Waybar trigger, and `start-menu` IPC name.
- Preserve the `ags-start-menu` namespace and bundled-mode registration.
- Keep menu-specific construction separate from data discovery and command execution.

### Recent item adapters

- Use an available desktop or Hyprland source for recent applications.
- Read recent documents using an XML-capable parser rather than Kiwi's regex parsing approach.
- Open entries through structured subprocess argument arrays, never shell interpolation.
- Scope clearing to state this menu owns. Do not delete unrelated desktop-usage state.

### Force Quit window

- Add a focused AGS window that lists Hyprland clients and their associated processes.
- Refresh CPU and memory metrics only while the window is visible.
- Remove timers when the window hides or is destroyed.
- Revalidate a selected client or process immediately before terminating it.
- Try graceful close first. Treat force termination as an explicit destructive action.
- Keep discovery and termination logic out of GTK row construction.

### About This PC window

- Read OS, CPU, memory, host, and DMI data through focused data-loading functions.
- Filter vendor placeholder DMI values.
- Display only successfully read fields.
- Present Hyprland and NixOS details rather than Kiwi's GNOME-specific desktop field.
- Send More Info to the local appropriate system-information surface, not `gnome-control-center`.

### Bundled registration

- Keep `start-menu` as the existing routed component.
- Register Force Quit and About windows as separate bundled components only when external IPC needs them. Otherwise invoke focused module APIs from StartMenu.
- Preserve taskbar visibility arbitration and outside-click handling.

## Phase 2 Validation

- Bundle using the repository's established AGS command.
- Exercise `show`, `hide`, `toggle`, `refresh`, and `is-visible` requests.
- Verify Waybar trigger behavior, keyboard navigation, outside-click dismissal, monitor positioning, and layer-shell focus.
- Verify destructive actions continue through confirmation scripts.
- Run the existing component benchmark:

```bash
bash scripts/benchmark/run-benchmarks.sh components
```

- Check repeated open and close cycles for timers, file monitors, subprocess handles, and memory growth.

## Boundary

React components consume display-ready data and report user actions. AGS owns parsing, system discovery, process lifecycle, command execution, destructive-action confirmation, and cleanup. This keeps the visual contract testable in Storybook without copying Linux and compositor details into the design system.
