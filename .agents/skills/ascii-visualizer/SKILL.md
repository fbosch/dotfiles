---
name: ascii-visualizer
license: MIT
compatibility: "Claude Code 2.1.76+."
description: "ASCII diagram patterns for architecture, workflows, file trees, and data visualizations. Use when creating terminal-rendered diagrams, box-drawing layouts, progress bars, swimlanes, or blast radius visualizations."
tags: [ascii, diagrams, visualization, box-drawing, architecture, terminal]
version: 1.1.0
author: OrchestKit
user-invocable: false
disable-model-invocation: true
context: inherit
allowed-tools: [Read, Grep, Glob]
complexity: low
persuasion-type: reference
effort: low
model: haiku
metadata:
  category: document-asset-creation
---

# ASCII Visualizer

Consistent, readable ASCII diagrams for architecture, workflows, file trees, and data visualizations. All output renders correctly in monospace terminals without external tools.

**Core principle:** Encode information into structure, not decoration. Every diagram element should communicate something meaningful.


## Box-Drawing Character Reference

```
Standard:  ┌─┐ │ └─┘  ├─┤ ┬ ┴ ┼
Heavy:     ┏━┓ ┃ ┗━┛  ┣━┫ ┳ ┻ ╋
Double:    ╔═╗ ║ ╚═╝  ╠═╣ ╦ ╩ ╬
Rounded:   ╭─╮ │ ╰─╯
Arrows:    → ← ↑ ↓ ─> <─ ──> <──
Blocks:    █ ▓ ░ ▏▎▍▌▋▊▉
Checks:    ✓ ✗ ● ○ ◆ ◇ ★ ☆
```

### Weight Conventions

| Weight | Characters | Use For |
|--------|-----------|---------|
| Standard `─│` | Normal boxes and connectors | Most diagrams |
| Heavy `━┃` | Emphasis, borders, headers | Key components, outer frames |
| Double `═║` | Separation, titles | Section dividers, title boxes |

### Border Integrity

Build diagrams on a fixed-width character grid before adding annotations. Treat
each box as immutable: choose its width from the widest label plus padding, then
reuse the same left and right edges on every row.

- Keep connector lanes outside boxes. Never draw a connector through a label,
  corner, or border segment, and never repair an overlap by replacing a corner
  with `─` or `│`.
- Use a junction character where a connector meets a border (`┬ ┴ ├ ┤ ┼`, or
  the matching heavy characters `┳ ┻ ┣ ┫ ╋`). Select the junction from the
  lines that actually meet there.
- Do not mix standard and heavy strokes at one join. If a mixed-weight join is
  not representable cleanly, use standard weight for the complete connected
  path.
- Leave at least two spaces before an annotation so its arrow cannot be
  mistaken for, or overwrite, the box edge.
- Before emitting the diagram, check every row's display width and inspect each
  box for intact corners, continuous edges, and intentional junctions. Never
  use tabs for layout.

For example, a heavy box with a downward connector keeps the border and uses a
junction rather than cutting a hole in the bottom edge:

```
                   ▼
             ┏━━━━━━━━━━━━━━━┓
             ┃  ags-ipc.lua  ┃  ← single parser
             ┗━━━━━━━┳━━━━━━━┛
                     ┃
                     ▼
```


## Diagram Patterns

### Architecture Diagrams

```
┌──────────────┐      ┌──────────────┐
│   Frontend   │─────>│   Backend    │
│   React 19   │      │   FastAPI    │
└──────────────┘      └───────┬──────┘
                              │
                              v
                      ┌──────────────┐
                      │  PostgreSQL  │
                      └──────────────┘
```

### File Trees with Annotations

```
src/
├── api/
│   ├── routes.py          [M] +45 -12    !! high-traffic path
│   └── schemas.py         [M] +20 -5
├── services/
│   └── billing.py         [A] +180       ** new file
└── tests/
    └── test_billing.py    [A] +120       ** new file

Legend: [A]dd [M]odify [D]elete  !! Risk  ** New
```

### Progress Bars

```
[████████░░] 80% Complete
+ Design    (2 days)
+ Backend   (5 days)
~ Frontend  (3 days)
- Testing   (pending)
```

### Swimlane / Timeline Diagrams

```
Backend  ===[Schema]======[API]===========================[Deploy]====>
                |            |                                ^
                |            +------blocks------+             |
                |                               |             |
Frontend ------[Wait]--------[Components]=======[Integration]=+

=== Active work   --- Blocked/waiting   | Dependency
```

### Blast Radius (Concentric Rings)

```
            Ring 3: Tests (8 files)
       +-------------------------------+
       |    Ring 2: Transitive (5)      |
       |   +------------------------+   |
       |   |  Ring 1: Direct (3)     |   |
       |   |   +--------------+      |   |
       |   |   | CHANGED FILE |      |   |
       |   |   +--------------+      |   |
       |   +------------------------+   |
       +-------------------------------+
```

### Comparison Tables

```
BEFORE                          AFTER
┌────────────┐                  ┌────────────┐
│  Monolith  │                  │  Service A │──┐
│  (all-in-1)│                  └────────────┘  │  ┌──────────┐
└────────────┘                  ┌────────────┐  ├─>│  Shared  │
                                │  Service B │──┘  │  Queue   │
                                └────────────┘     └──────────┘
```

### Reversibility Timeline

```
Phase 1  [================]  FULLY REVERSIBLE    (add column)
Phase 2  [================]  FULLY REVERSIBLE    (new endpoint)
Phase 3  [============....]  PARTIALLY           (backfill)
              --- POINT OF NO RETURN ---
Phase 4  [........????????]  IRREVERSIBLE        (drop column)
```


## Key Rules

| Rule | Description |
|------|-------------|
| Font | Always monospace — box-drawing requires fixed-width |
| Weight | Standard for normal, Heavy for emphasis, Double for titles |
| Arrows | `─>`, `──>`, or `│` with `v`/`^` for direction |
| Alignment | Right-pad labels to match column widths |
| Annotations | `!!` for risk, `**` for new, `[A/M/D]` for change type |
| Width | Keep under 80 chars for terminal compatibility |
| Nesting | Max 3 levels of box nesting before readability degrades |
| Integrity | Compose on a grid; use junctions for joins; never overwrite borders |


## When to Use Each Pattern

| Pattern | Use Case |
|---------|----------|
| Layered boxes | System architecture, deployment topology |
| Concentric rings | Blast radius, impact analysis |
| Timeline bars | Reversibility, migration phases |
| Swimlanes | Execution order, parallel work streams |
| Annotated trees | File change manifests, directory structures |
| Comparison tables | Cross-layer consistency, before/after |
| Progress bars | Status tracking, completion metrics |

## Related Skills

- `brainstorm` — Design exploration where diagrams communicate ideas
- `architecture-patterns` — System architecture that benefits from ASCII diagrams
- `code-review-playbook` — Review comments with inline diagrams
