## Purpose

Preserve Neovim as the owner of editor restoration while allowing a restored Neovim session to resume the exact Pi conversation associated with that worktree.

## ADDED Requirements

### Requirement: Separate Pi session metadata

The system SHALL persist Pi's exact session identifier and terminal-open state in Neovim session metadata without replacing or changing existing OpenCode metadata.

#### Scenario: Neovim saves an active Pi terminal

- **WHEN** Neovim saves a session with an editor-aware Pi terminal open
- **THEN** its metadata records the exact Pi session identifier and that the terminal was open

#### Scenario: OpenCode metadata already exists

- **WHEN** Neovim saves Pi session metadata beside existing OpenCode session metadata
- **THEN** the OpenCode fields retain their previous values and semantics

### Requirement: Exact worktree-scoped resume

The system SHALL resume only the persisted Pi session whose project identity matches the restored Neovim worktree. It MUST NOT infer the latest, most recently active, or nearest Pi session.

#### Scenario: Persisted session matches the worktree

- **WHEN** Neovim restores metadata containing an available Pi session for the same worktree
- **THEN** Neovim launches Pi with that exact session

#### Scenario: Persisted session belongs to another worktree

- **WHEN** the persisted Pi session identity does not match the restored worktree
- **THEN** the system refuses to resume it and reports the mismatch

### Requirement: Neovim-first Herdr restoration

The system SHALL preserve the restoration order in which Herdr restores the labeled Neovim pane and Neovim subsequently restores the persisted Pi session.

#### Scenario: Herdr restores a managed workspace

- **WHEN** a Herdr-managed workspace containing an editor-aware Pi session is restored
- **THEN** Herdr restores Neovim before Neovim launches or resumes Pi

#### Scenario: Pi terminal was closed before save

- **WHEN** restored Neovim metadata records that the Pi terminal was not open
- **THEN** Neovim does not launch Pi during restoration

### Requirement: Explicit unavailable-session behavior

The system SHALL report an unavailable or invalid persisted Pi session without silently substituting another session. Neovim restoration SHALL continue when Pi cannot resume.

#### Scenario: Persisted Pi session is missing

- **WHEN** Neovim restores metadata for a Pi session that no longer exists
- **THEN** Neovim remains usable, Pi does not resume another session, and the failure is reported

#### Scenario: Pi resume fails

- **WHEN** the exact Pi resume operation fails after Neovim restoration
- **THEN** the failure does not alter Neovim or OpenCode session metadata
