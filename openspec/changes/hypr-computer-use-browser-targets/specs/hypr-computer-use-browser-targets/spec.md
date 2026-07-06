## ADDED Requirements

### Requirement: Default browser discovery uses XDG sources
The system SHALL discover the default browser desktop ID from XDG sources without hardcoding a browser name.

#### Scenario: xdg-settings returns a desktop ID
- **WHEN** `xdg-settings get default-web-browser` returns a non-empty desktop ID
- **THEN** the system uses that desktop ID as the default browser source

#### Scenario: xdg-settings is unavailable
- **WHEN** `xdg-settings` is unavailable or returns no desktop ID
- **THEN** the system falls back to `xdg-mime query default x-scheme-handler/https`

#### Scenario: XDG commands are unavailable
- **WHEN** XDG commands are unavailable or return no desktop ID
- **THEN** the system falls back to parsing `mimeapps.list` for `x-scheme-handler/https`, `x-scheme-handler/http`, or `text/html`

#### Scenario: No default browser is found
- **WHEN** no XDG source provides a browser desktop ID
- **THEN** the system returns an unresolved default-browser result
- **AND** it does not guess a browser from currently open windows

### Requirement: Desktop entries are resolved read-only
The system SHALL resolve desktop entry metadata from XDG application directories without executing desktop entry commands.

#### Scenario: Desktop entry is found in XDG data dirs
- **WHEN** a default browser desktop ID is known and a matching `.desktop` file exists in XDG application directories
- **THEN** the system returns parsed metadata including desktop ID, name, exec string, startup WM class, mime types, categories, and source path

#### Scenario: Desktop entry is missing
- **WHEN** a default browser desktop ID is known but no matching `.desktop` file is found
- **THEN** the system returns the desktop ID with missing desktop-entry metadata
- **AND** it does not infer an exec command from process state

#### Scenario: Desktop entry has placeholders
- **WHEN** a desktop entry `Exec` value contains field codes such as `%u`, `%U`, `@@`, or Flatpak forwarding markers
- **THEN** the system preserves the raw exec string
- **AND** it does not execute or rewrite the command in this slice

### Requirement: Browser identity is normalized
The system SHALL normalize browser metadata into a browser identity suitable for evidence and Hyprland client matching.

#### Scenario: Flatpak browser identity is inferable
- **WHEN** a desktop ID or exec string contains a Flatpak application ID
- **THEN** the normalized identity includes the Flatpak ID and class candidates derived from the desktop ID, Flatpak ID, startup WM class, and name

#### Scenario: Startup WM class is present
- **WHEN** a desktop entry contains `StartupWMClass`
- **THEN** the normalized identity includes that value as a class candidate

#### Scenario: Only desktop ID is available
- **WHEN** only a desktop ID is available
- **THEN** the normalized identity still includes the desktop ID and class candidates derived from the desktop ID stem

### Requirement: Browser targets are matched to Hyprland clients
The system SHALL match normalized browser identities to running Hyprland clients using read-only Hyprland state.

#### Scenario: Matching browser client exists
- **WHEN** a Hyprland client class matches one of the normalized browser class candidates
- **THEN** the system returns that client as a browser target match
- **AND** the match includes class, title, PID, workspace, monitor, address, and stable ID when available

#### Scenario: No matching browser client exists
- **WHEN** no Hyprland client matches the normalized browser identity
- **THEN** the system returns an empty match list
- **AND** it does not launch the browser or select an unrelated browser window

#### Scenario: Browser target discovery is requested without Hyprland state
- **WHEN** Hyprland state is unavailable
- **THEN** the system still returns default browser and desktop-entry metadata when available
- **AND** it reports Hyprland client matches as unavailable

### Requirement: Browser capability reporting is conservative
The system SHALL report browser target capabilities without overclaiming unsupported browser automation protocols.

#### Scenario: Hyprland browser window is matched
- **WHEN** at least one browser target is matched to a Hyprland client
- **THEN** `nativeWindowCapture` is reported as `available`

#### Scenario: Default browser is resolved
- **WHEN** a default browser desktop ID is resolved
- **THEN** `xdgOpen` is reported as `available`

#### Scenario: Browser protocol endpoints are not configured
- **WHEN** no CDP or WebDriver BiDi endpoint is configured or discovered
- **THEN** `cdp` and `webdriverBidi` are reported as `unknown`
- **AND** the system does not assume CDP based on the browser being open

### Requirement: Browser target discovery remains read-only
The system SHALL NOT launch browsers, open URLs, mutate browser profiles, inspect sessions, or automate page content in this capability.

#### Scenario: Browser default discovery is requested
- **WHEN** the system resolves the default browser and desktop entry
- **THEN** it does not execute the desktop entry command or open a URL

#### Scenario: Browser target matching is requested
- **WHEN** the system matches browser targets to Hyprland clients
- **THEN** it does not focus windows, click, type, navigate, or inspect DOM content

### Requirement: Browser target evidence is metadata-first
The system SHALL record browser discovery and target matching evidence without embedding screenshots, page content, cookies, credentials, or browser storage.

#### Scenario: Browser default is resolved
- **WHEN** the system resolves browser metadata
- **THEN** it records desktop ID, source, desktop-entry path when available, normalized identity, and timestamp

#### Scenario: Browser targets are matched
- **WHEN** the system matches browser targets to Hyprland clients
- **THEN** it records match metadata and capability status
- **AND** it does not include screenshot image bytes, page DOM, cookies, local storage, or clipboard contents
