## Purpose

Control the staged switch from OpenCode to Pi for Neovim workflows while preserving Herdr lifecycle ownership, independent verification, and an explicit rollback path.

## ADDED Requirements

### Requirement: Opt-in coexistence during migration

The system SHALL introduce Pi editor integration beside the existing OpenCode integration. A Pi capability SHALL NOT replace its OpenCode counterpart until the Pi capability passes its automated and live acceptance checks.

#### Scenario: A Pi capability is not yet verified

- **WHEN** a Neovim workflow has no recorded passing Pi live check
- **THEN** the existing OpenCode workflow remains available and unchanged

#### Scenario: A Pi capability passes independently

- **WHEN** a Pi workflow passes its automated checks and documented live tracer bullet
- **THEN** that workflow may become the default without requiring unrelated Pi capabilities to be complete

### Requirement: Single Herdr lifecycle ownership

An embedded Pi session SHALL use the existing Pi title, working, idle, blocked, error, and shutdown reporting path for its owning Herdr pane. The editor integration MUST NOT create a second lifecycle reporter or make Pi the owner of Herdr pane restoration.

#### Scenario: Pi waits for user input

- **WHEN** an embedded Pi session displays a permission or question prompt
- **THEN** the owning Herdr pane reports a blocked state through the existing Pi reporting path

#### Scenario: Embedded Pi exits

- **WHEN** the editor-launched Pi process exits
- **THEN** its Herdr title and lifecycle state are cleared without changing Neovim's pane ownership

### Requirement: Public-API gate for editor-owned diff review

The migration SHALL enable Neovim-owned Pi diff review only when supported APIs can guarantee that reject and cancellation preserve source content and accept writes exactly the reviewed contents. Otherwise the capability SHALL remain OpenCode-owned.

#### Scenario: Supported review contract passes

- **WHEN** a supported Pi integration passes live reject, modified-accept, cancellation, and worktree-isolation checks
- **THEN** Pi may become the default owner of editor-side diff review

#### Scenario: Required review API is unavailable

- **WHEN** Pi cannot provide the required review contract without private renderer or editor internals
- **THEN** the migration records diff review as OpenCode-retained and does not install a brittle substitute

### Requirement: Public-API gate for clickable patch navigation

The migration SHALL enable clickable Pi patch navigation only through a supported public Pi render or click API with worktree-contained targets. Otherwise the capability SHALL remain OpenCode-owned.

#### Scenario: Supported click contract passes

- **WHEN** clicking a Pi-rendered changed-file header opens the correct location in the bound Neovim instance and containment checks pass
- **THEN** Pi may become the default owner of clickable patch navigation

#### Scenario: Required click API is unavailable

- **WHEN** Pi exposes no supported public integration point for clickable output
- **THEN** the migration records patch navigation as OpenCode-retained and does not patch private Pi renderer behavior

### Requirement: Evidence-based default switch

The system SHALL maintain a capability record that marks each existing Neovim workflow as `Pi`, `OpenCode retained`, or `retired` with its verification evidence or retirement reason. The default Neovim agent SHALL switch to Pi only after every required workflow has a resolved status and the rollback path has been exercised.

#### Scenario: Required capability is unresolved

- **WHEN** a required workflow lacks a passing Pi check or an explicit retained or retired decision
- **THEN** OpenCode remains the default Neovim agent

#### Scenario: Cutover criteria pass

- **WHEN** all required workflows have resolved status, wrong-instance tests pass, exact session restoration passes, and OpenCode rollback has been exercised
- **THEN** Neovim may launch Pi by default while retaining explicit access to approved OpenCode-only workflows

### Requirement: Independent rollback

The system SHALL allow the Pi editor integration to be disabled without removing OpenCode configuration, OpenCode sessions, or unrelated Pi integrations.

#### Scenario: Pi editor integration is disabled

- **WHEN** the user disables the Pi Neovim launcher and bridge
- **THEN** OpenCode remains independently launchable with its existing Neovim session restoration and editor integration
