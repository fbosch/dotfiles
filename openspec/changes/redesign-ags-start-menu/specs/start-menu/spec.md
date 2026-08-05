## Purpose

Define a compact desktop Start Menu that safely exposes system actions, recent items, application recovery, system information, and update status across the design system and AGS runtime.

## ADDED Requirements

### Requirement: Design-System Start Menu Contract
The system SHALL define the Start Menu, Force Quit, and About This PC as display-ready design-system surfaces before AGS mirrors their behavior.

#### Scenario: Design system remains runtime-independent
- **WHEN** the design-system surfaces render in Storybook or another React caller
- **THEN** they consume supplied display-ready data and emit user intent through callbacks
- **AND** they do not read Hyprland state, XBEL, update caches, process data, or local system files

#### Scenario: AGS mirrors the visual contract
- **WHEN** AGS renders Start Menu, Force Quit, or About This PC
- **THEN** it mirrors the named visual states and interaction outcomes defined by the design-system surfaces
- **AND** it does not import React or Storybook runtime code

#### Scenario: Reference stories cover meaningful states
- **WHEN** design-system stories are maintained
- **THEN** they cover populated and empty recent items, update badges, Force Quit ready/empty/unavailable states, and About This PC with optional fields omitted
- **AND** they avoid exhaustive presentation-only variant combinations

### Requirement: Start Menu Layout And Updates
The Start Menu SHALL present a stable grouped action order and source-specific update status.

#### Scenario: Default action grouping
- **WHEN** the Start Menu opens with default actions
- **THEN** it displays About This PC, System Settings, System Updates, Applications, Documents, Pictures, Downloads, and Recent Items above Force Quit
- **AND** it separates System Updates from Applications with a divider
- **AND** it displays Force Quit above Suspend, Restart, and Shutdown
- **AND** it displays Lock Screen and Log out after a separator below the power actions

#### Scenario: Profile controls remain available
- **WHEN** the Start Menu opens
- **THEN** it displays the current user header above the action groups
- **AND** it displays profile controls after System Updates and before Applications
- **AND** it presents an exclusive manual policy selection of Auto, Gaming, or Saver
- **AND** it emits the selected policy as one intent for the runtime to apply atomically

#### Scenario: Automatic Gaming remains visible
- **WHEN** automatic profile rules have activated effective Gaming mode while Auto remains the selected manual policy
- **THEN** the Start Menu keeps Auto selected
- **AND** it displays a separate non-interactive Game Mode active status identified as Automatic

#### Scenario: Update badges identify source counts
- **WHEN** valid positive Nix flake or Flatpak update counts are available
- **THEN** System Updates displays one compact Nerd Font icon-and-count badge for each positive source
- **AND** each badge exposes the source name to assistive technologies

#### Scenario: Missing update data does not block updates
- **WHEN** an update cache is missing, invalid, stale, or reports zero updates
- **THEN** Start Menu hides that source's badge
- **AND** System Updates remains activatable

#### Scenario: System actions preserve established destinations
- **WHEN** System Settings is selected
- **THEN** the system opens the existing NixOS configuration editor command
- **WHEN** System Updates is selected
- **THEN** the system launches the existing combined Nix and Flatpak update command

### Requirement: Recent Applications And Documents
The Start Menu SHALL provide bounded session applications and XBEL document recency without modifying unrelated desktop state.

#### Scenario: Recent applications follow focus history
- **WHEN** an application becomes focused during the active AGS session
- **THEN** the system records its application identity in in-memory recency order
- **AND** it does not persist the entry across AGS or desktop-session restart

#### Scenario: Recent application list is bounded and launchable
- **WHEN** the Recent Items submenu opens
- **THEN** it displays at most eight recently focused applications in recency order
- **AND** it keeps a closed application only when it can be launched through a matching desktop entry
- **AND** it omits closed applications that have no launch target

#### Scenario: Recent application always launches a new instance
- **WHEN** the user selects a recent application
- **THEN** the system launches a new application instance through its desktop launch target
- **AND** it does not substitute focusing an existing application window
- **AND** it closes the Recent Items submenu and Start Menu

#### Scenario: Application icons use common resolution and fallback
- **WHEN** a recent application or Force Quit row requires an icon
- **THEN** the system uses the shared desktop application icon-resolution behavior
- **AND** it displays an initial-letter fallback when no icon can be resolved

#### Scenario: Recent documents read from XBEL
- **WHEN** the Start Menu opens
- **THEN** it reads displayable document and folder entries from `recently-used.xbel`
- **AND** it displays at most twelve recent documents in recency order
- **AND** missing or malformed XBEL data yields an empty Documents section without preventing the menu from opening

#### Scenario: Recent document activation opens the target
- **WHEN** the user selects a recent document or folder
- **THEN** the system opens its URI with the desktop's associated application
- **AND** it closes the Recent Items submenu and Start Menu

#### Scenario: Clear Recent Items affects only owned sources
- **WHEN** the user selects Clear Recent Items
- **THEN** the system clears in-memory application history and `recently-used.xbel`
- **AND** it immediately refreshes the submenu to its empty state
- **AND** it does not delete unrelated desktop application-usage state

### Requirement: Recent Items Interaction
The Recent Items submenu SHALL support pointer, keyboard, placement, and dismissal behavior suitable for a desktop menu.

#### Scenario: Pointer and direct activation open the submenu
- **WHEN** the pointer remains on Recent Items for 300 ms
- **THEN** the submenu opens
- **WHEN** the user clicks, presses Enter, Space, or Right Arrow on Recent Items
- **THEN** the submenu opens immediately

#### Scenario: Pointer leave closes after delay
- **WHEN** the pointer leaves both the Recent Items trigger and its submenu
- **THEN** the submenu closes after 200 ms
- **AND** entering the submenu before that delay expires keeps it open

#### Scenario: Upward placement flips at monitor edge
- **WHEN** the Recent Items submenu opens
- **THEN** it expands upward from its trigger
- **AND** it opens to the right when that fits in the trigger monitor work area
- **AND** it opens to the left when the right side lacks sufficient space

#### Scenario: Keyboard dismissal preserves focus order
- **WHEN** focus is inside Recent Items and the user presses Escape or Left Arrow
- **THEN** the submenu closes before Start Menu closes
- **AND** focus returns to the Recent Items trigger

#### Scenario: Outside dismissal closes Start Menu
- **WHEN** Start Menu or its Recent Items submenu is visible and the user clicks outside both surfaces
- **THEN** the system closes the submenu and Start Menu

### Requirement: Session Actions
The Start Menu SHALL hide before dispatching session actions and preserve safe confirmation behavior.

#### Scenario: Lock screen is immediate
- **WHEN** the user selects Lock Screen
- **THEN** the Start Menu hides before the action executes
- **AND** the system invokes the configured lock screen without confirmation

#### Scenario: Logout and power actions confirm
- **WHEN** the user selects Log out, Suspend, Restart, or Shutdown
- **THEN** the Start Menu hides before the action executes
- **AND** the system uses the existing confirmation flow for that action

#### Scenario: Confirmation does not leave stale menu UI
- **WHEN** a session confirmation surface is visible
- **THEN** Start Menu is not visible behind it

### Requirement: Force Quit
The system SHALL offer a compact application-level Force Quit surface that uses bounded graceful-close and revalidated termination behavior.

#### Scenario: Rows group application windows
- **WHEN** Force Quit opens
- **THEN** it groups current desktop windows by application identity
- **AND** each row aggregates that application's unique process identifiers, CPU usage, and resident memory
- **AND** each row displays icon, application name, and compact inline metrics

#### Scenario: Core desktop applications are protected
- **WHEN** Force Quit builds its application list
- **THEN** it excludes the AGS process, Waybar, Hyprland, lock screen, desktop portals, and Force Quit/About This PC surfaces

#### Scenario: Metrics refresh only while visible
- **WHEN** Force Quit is visible
- **THEN** CPU and memory metrics refresh every two seconds
- **WHEN** Force Quit hides or is destroyed
- **THEN** metric refresh stops

#### Scenario: Force Quit escalates after graceful close
- **WHEN** the user selects a valid application and activates Force Quit
- **THEN** the system first requests graceful close for its windows
- **AND** after a bounded grace interval it revalidates surviving windows and processes
- **AND** it forcibly terminates only surviving revalidated processes

#### Scenario: Vanished applications are treated as resolved
- **WHEN** a selected application exits before Force Quit performs its action
- **THEN** the system clears selection and refreshes the list without an error surface

#### Scenario: Successful action keeps Force Quit open
- **WHEN** Force Quit successfully terminates an application
- **THEN** the application disappears from the list
- **AND** selection clears
- **AND** Force Quit remains visible for further actions

### Requirement: About This PC
The system SHALL provide an undecorated, translucent system-information surface with host-configurable artwork and safe data fallbacks.

#### Scenario: About displays available system information
- **WHEN** About This PC opens
- **THEN** it displays available model, manufacturer, processor, memory, desktop, operating system, kernel, and uptime fields
- **AND** it omits unavailable or placeholder fields

#### Scenario: Configured device image takes precedence
- **WHEN** `AGS_ABOUT_DEVICE_IMAGE` identifies a readable image
- **THEN** About This PC displays that image

#### Scenario: Chassis fallback selects a Fluent device icon
- **WHEN** the configured device image is missing, unreadable, or unset
- **THEN** About This PC displays a Fluent laptop icon for portable DMI chassis types
- **AND** it displays a Fluent Desktop Tower icon for desktop or unknown chassis types

#### Scenario: More Info opens fastfetch
- **WHEN** the user selects More Info
- **THEN** the system opens a terminal running `fastfetch`

#### Scenario: About uses the shared surface language
- **WHEN** About This PC or Force Quit is visible
- **THEN** it renders without titlebar decoration
- **AND** it uses the established translucent, blurred surface, existing border radius, and shared buttons

### Requirement: Bundled Runtime And Waybar Integration
The AGS Start Menu implementation SHALL remain compatible with the bundled runtime and existing Waybar trigger behavior.

#### Scenario: Existing Start Menu request behavior remains available
- **WHEN** AGS receives an existing Start Menu visibility request
- **THEN** it continues to support `show`, `hide`, `toggle`, `refresh`, and `is-visible`

#### Scenario: Waybar trigger remains unchanged
- **WHEN** the user activates the existing Waybar Start Menu trigger
- **THEN** it continues to toggle the Start Menu through the bundled AGS instance

#### Scenario: Visibility participates in existing arbitration
- **WHEN** Start Menu, Force Quit, or About This PC is visible
- **THEN** the existing Waybar visibility behavior continues to keep the required bar surface visible
