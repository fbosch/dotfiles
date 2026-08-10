## ADDED Requirements

### Requirement: Design-System Audio Mixer Surface
The system SHALL define an Audio Mixer surface in `design-system/src/components/AudioMixer/` before implementing the downstream AGS widget.

#### Scenario: Audio Mixer surface is pure UI
- **WHEN** the Audio Mixer is rendered in the design system
- **THEN** it displays supplied audio state from props
- **AND** it does not import or call AGS, AstalWP, WirePlumber, PipeWire, `wiremix`, Storybook, or shell-specific code

#### Scenario: Audio Mixer exposes local export
- **WHEN** the Audio Mixer component is added
- **THEN** `design-system/src/components/AudioMixer/index.ts` exports the component and public types
- **AND** no design-system root export barrel is introduced for this slice

#### Scenario: Audio Mixer uses shell-style presentation
- **WHEN** the Audio Mixer renders supplied data
- **THEN** it renders compact system UI using design tokens and Tailwind utilities
- **AND** it does not render explanatory prose, item counts, or backend metadata labels merely because that data is available

### Requirement: Audio Mixer Tabs
The Audio Mixer SHALL expose the primary Wiremix-equivalent sections as compact tabs.

#### Scenario: Primary tabs are available
- **WHEN** the Audio Mixer renders
- **THEN** it provides Playback, Recording, Output, Input, and Config tabs
- **AND** the active tab controls which item rows are displayed

#### Scenario: Tab selection reports caller intent
- **WHEN** the user activates a tab
- **THEN** the Audio Mixer invokes `onTabChange` when provided
- **AND** it does not require backend access to switch tabs in the design-system surface

### Requirement: Audio Item Rows
The Audio Mixer SHALL render compact rows for streams, endpoints, and devices without exposing raw backend object details.

#### Scenario: Row shows essential audio state
- **WHEN** an audio item has a name, icon, volume, mute state, default state, or peak value
- **THEN** the row displays the item name, icon, volume meter, mute state, default marker, and optional peak indication as compact visual state
- **AND** it does not show route, target, or profile text inline by default

#### Scenario: Empty tab is non-disruptive
- **WHEN** the active tab has no items
- **THEN** the Audio Mixer renders a compact empty state
- **AND** the widget remains usable for switching tabs

### Requirement: Audio Mixer Interactions
The Audio Mixer Widget SHALL support essential shell interactions for audio control.

#### Scenario: Volume can be adjusted from a row
- **WHEN** the user adjusts a row volume meter
- **THEN** the AGS widget sets the corresponding node volume through the audio backend
- **AND** the displayed meter updates from backend state

#### Scenario: Mute can be toggled from a row
- **WHEN** the user activates a row mute affordance
- **THEN** the AGS widget toggles the corresponding node mute state through the audio backend
- **AND** the row reflects muted state without requiring a polling loop

#### Scenario: Default input or output can be selected
- **WHEN** the user selects a speaker or microphone endpoint as default
- **THEN** the AGS widget sets that endpoint as default through the audio backend
- **AND** default state updates across the affected endpoint list

#### Scenario: Advanced choices are behind row menus
- **WHEN** a row supports stream target, route, or profile changes
- **THEN** the AGS widget exposes those choices through a compact row menu or equivalent disclosure
- **AND** those choices are not always rendered as inline labels or always-visible dropdowns

### Requirement: AstalWP Audio Backend
The Audio Mixer Widget SHALL use AstalWP/WirePlumber as the primary audio backend.

#### Scenario: Backend provides audio lists
- **WHEN** AstalWP is available and initialized
- **THEN** the widget reads playback streams, recording streams, speakers, microphones, and devices from AstalWP audio objects
- **AND** it updates the widget from AstalWP property changes and add/remove signals

#### Scenario: Backend controls node state
- **WHEN** the user changes volume or mute state
- **THEN** the widget uses AstalWP node methods for volume and mute changes
- **AND** volume values are clamped to the backend-supported range

#### Scenario: Backend controls defaults and routing
- **WHEN** the user changes default endpoint, stream target, route, or profile
- **THEN** the widget uses AstalWP endpoint, stream, route, or device methods for that action
- **AND** missing or unavailable choices are ignored without crashing `ags-bundled`

#### Scenario: AstalWP unavailable degrades safely
- **WHEN** AstalWP GIR bindings or runtime services are unavailable
- **THEN** the Audio Mixer Widget still initializes without crashing `ags-bundled`
- **AND** it renders an empty or unavailable surface
- **AND** system package changes are not added in this dotfiles repository

### Requirement: AGS Audio Mixer Widget
The system SHALL add an AGS Audio Mixer Widget that mirrors the design-system Audio Mixer surface without importing React or Storybook code.

#### Scenario: Bundled component registration
- **WHEN** `ags-bundled` starts
- **THEN** the Audio Mixer Widget is imported, initialized, and registered through the existing bundled component registry
- **AND** it responds under the `audio-mixer-widget` instance name

#### Scenario: Request API supports widget visibility
- **WHEN** AGS receives Audio Mixer Widget requests
- **THEN** it supports `show`, `hide`, `toggle`, and `is-visible` actions
- **AND** malformed requests return an error response without throwing

#### Scenario: Widget appears as a Waybar-attached popup
- **WHEN** the Audio Mixer Widget is shown from Waybar
- **THEN** it appears near the volume indicator on the trigger monitor when monitor detection succeeds
- **AND** it falls back to the default monitor when monitor detection fails

#### Scenario: Widget dismissal behavior
- **WHEN** the Audio Mixer Widget is visible
- **THEN** Escape hides it
- **AND** clicking outside the Audio Mixer surface hides it

### Requirement: Waybar Audio Integration
The system SHALL replace the Waybar volume left-click `wiremix` popup with the AGS Audio Mixer Widget.

#### Scenario: Volume left-click toggles Audio Mixer Widget
- **WHEN** the user left-clicks the Waybar volume indicator
- **THEN** Waybar sends an Audio Mixer Toggle request to `ags-bundled`
- **AND** the Audio Mixer Widget opens when hidden and hides when visible

#### Scenario: Existing volume actions remain scoped
- **WHEN** the Audio Mixer Widget is added
- **THEN** existing volume keybinds and the Volume Change Indicator continue to work
- **AND** Waybar middle/right-click behavior is not changed unless explicitly required by this change

#### Scenario: Wiremix is not used as backend
- **WHEN** the Audio Mixer Widget controls audio
- **THEN** it does not spawn, automate, parse, or depend on `wiremix`
- **AND** `wiremix` may remain available only as a separately launched terminal mixer

### Requirement: Waybar Visibility Guard
The system SHALL keep Waybar visible while the Audio Mixer Widget is open.

#### Scenario: Audio Mixer reports visibility
- **WHEN** the Waybar visibility helper checks whether Waybar should stay visible
- **THEN** it queries `audio-mixer-widget` with `is-visible`
- **AND** it keeps Waybar visible when the Audio Mixer Widget reports visible
- **AND** it treats request failure as not visible

#### Scenario: Widget show signals Waybar visible
- **WHEN** the Audio Mixer Widget is shown
- **THEN** it signals Waybar to show
- **AND** it lets existing hide behavior decide after the widget closes

### Requirement: Audio Mixer Validation
The system SHALL validate the design-system and AGS Audio Mixer changes with focused checks.

#### Scenario: Design-system validation covers Audio Mixer
- **WHEN** the design-system Audio Mixer files change
- **THEN** targeted formatting, linting, and type checks for `design-system/src/components/AudioMixer/` pass
- **AND** Storybook builds with the Audio Mixer stories included

#### Scenario: AGS validation covers widget wiring
- **WHEN** the AGS Audio Mixer Widget is implemented
- **THEN** `ags-bundled` starts without crashing when AstalWP is available or unavailable
- **AND** `ags request -i ags-bundled audio-mixer-widget '{"action":"is-visible"}'` returns a non-crashing response
