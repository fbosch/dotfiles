---
name: crafting-effective-readmes
description: Create, review, or structurally revise README files for a project or config directory. Use when starting a README, changing its audience or information architecture, or making a substantial content rewrite. For focused README edits, load only the relevant guidance.
---

# Crafting Effective READMEs

## Core Principles

**Concise over comprehensive.** READMEs should answer key questions quickly, not document everything. Write the minimum needed for your audience to succeed.

**Audience-first.** Different audiences need different information. A contributor to an OSS project needs different context than future-you opening a config folder.

**Tone-aware.** Use the `writing-clearly` skill for final prose; README templates, explicit user requirements, and factual accuracy still win.

**Always ask:** Who will read this, and what do they need to know?

## NEVER Do in READMEs

- NEVER write "Introduction" or "Overview" as first heading (redundant; the README itself is the introduction)
- NEVER include outdated installation instructions or stale content
- NEVER copy-paste generic templates without customization for the specific project
- NEVER write walls of text; use headers, lists, and code blocks for scanability
- NEVER assume obvious setup; include basic install and usage steps
- NEVER write for the wrong audience (OSS style for personal projects, or vice versa)
- NEVER use emojis unless explicitly requested (see `style-guide.md` for reasoning)
- NEVER forget to update README when project capabilities change
- NEVER exceed what's necessary; if a section doesn't answer a real user question, delete it

## Process

### Step 1: Identify the Task

| Task          | When                                   | What to Do                                                                                  |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Creating**  | New project, no README yet             | Ask: (1) Project type? (2) Problem solved in one sentence? (3) Quickest path to "it works"? |
| **Adding**    | Need to document something new         | Ask: (1) What needs documenting? (2) Where in structure? (3) Who needs this?                |
| **Updating**  | Capabilities changed, content is stale | Read current README, identify stale sections, propose specific edits                        |
| **Reviewing** | Checking if README is accurate         | Check against project state, flag outdated sections, trim unnecessary content               |

### Step 2: Match reference depth to the change

For a **new README or structural rewrite** that changes the audience, project type, section order, or several sections:

1. Identify the project type.
2. Read the corresponding template in `templates/` completely.
3. Read `section-checklist.md` completely.
4. If the user mentions style concerns or asks for a style review, read `style-guide.md`.

A focused addition, accuracy fix, copy edit, or review that preserves the existing structure does not require a full template or checklist. Read the current README and load only the guidance relevant to the changed section. Do not load the `references/` directory unless the user asks for deeper README best-practice context.

### Step 3: Write Concisely

Before adding each section, ask:

- **Does my audience need this?** If they can succeed without it, delete it.
- **Is this the shortest way to say this?** Cut unnecessary words.
- **Can I show instead of tell?** Use code examples over explanations.

After drafting, ask: **"Anything else to highlight that I missed?"** Then resist adding fluff.

## Project Types

| Type            | Audience                      | Focus                                    |
| --------------- | ----------------------------- | ---------------------------------------- |
| **Open Source** | Contributors, users worldwide | Install, Usage, Contributing, License    |
| **Personal**    | Future you, portfolio viewers | What it does, Tech stack, Learnings      |
| **Internal**    | Teammates, new hires          | Setup, Architecture, Runbooks            |
| **Config**      | Future you (confused)         | What's here, Why, How to extend, Gotchas |

**Ask the user** if project type is unclear. Don't assume OSS defaults for everything.

## Essential Sections (All Types)

Every README needs at minimum:

1. **Name** - Self-explanatory title
2. **Description** - What + why in 1-2 sentences
3. **Usage** - How to use it (concise examples)
