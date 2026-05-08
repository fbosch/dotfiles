# Standardize OpenCode Command and Skill Scripts on TypeScript

**Status:** accepted
**Date:** 2026-04-21

## Context

OpenCode automation in this repo used mixed Bash and Python pipelines for command and skill helper scripts. That setup increased maintenance cost, duplicated parsing and error handling, and made dependency management inconsistent across scripts. Recent migration work introduced Bun-executed TypeScript entrypoints and removed legacy Bash/Python helpers for core paths.

## Decision

Standardize OpenCode command and skill scripting on TypeScript, executed with Bun. New automation scripts should be implemented as `.ts` files, and existing Bash/Python helper pipelines should be migrated as touched. Command markdown continues to use shell injection, but script execution targets TypeScript entrypoints.

## Alternatives Considered

Keep mixed Bash and Python scripts: rejected because it preserves fragmented tooling and higher maintenance overhead. Use Node + `tsx`: viable, but not selected because this repo already runs Bun for OpenCode plugin/script workflows. Use `jiti`: rejected for this use case because it is better suited as a module loader than as the primary script executor.

## Consequences

Dependency management and script behavior become more uniform across OpenCode automation. Debugging improves because logic can live in single typed entrypoints with shared patterns for parsing and failure handling. Follow-on work is required to migrate remaining legacy Bash/Python script paths and keep runtime assumptions (Bun availability) explicit in command wrappers.
