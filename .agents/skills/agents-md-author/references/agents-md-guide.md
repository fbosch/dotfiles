# AGENTS.md Guide

Use the Core Keep/Cut Filters in `../SKILL.md` for policy. This guide provides examples of how to apply them.

## Discoverable but worth keeping

A package-manager choice may be visible in a lockfile yet still be worth stating if agents repeatedly use the wrong command. Record the required choice, not a general description of the package ecosystem.

Likewise, a test command's required flag may be discoverable in a script but easy to miss. A useful instruction names the flag and the failure it prevents:

```text
Run the fixture checks with --no-cache; cached results can hide fixture setup failures.
```

Include such an instruction only when the repository actually requires it.

## Root and local guidance

Put shared safety boundaries, preferences, and commands in the root. A package-level file should state only its differences, such as a package-specific test command or placement rule. Follow the active harness's loading and precedence rules.

Use the root template in `../SKILL.md`; omit sections that have no operational content.

## Example snippets

One-line description:

```text
This is a React component library for accessible data visualization.
```

Reference pointer with a loading trigger:

```text
Before changing public TypeScript types, read docs/TYPESCRIPT.md.
```

Hazard with a removal condition:

```text
Do not replace the custom middleware while production routes still depend on its header normalization. Remove this warning once those routes no longer rely on it.
```
