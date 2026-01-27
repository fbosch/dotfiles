# README Style Guide

## Common Mistakes

- **Too verbose** - READMEs are scanned, not read. Every sentence must earn its place.
- **No install steps** - Never assume setup is obvious
- **No examples** - Show, don't just tell
- **Wall of text** - Use headers, tables, lists for scanability
- **Stale content** - Add "last reviewed" date for important projects
- **Generic tone** - Write for YOUR specific audience, not everyone
- **Emoji overload** - Avoid excessive emojis; they clutter and date quickly
- **Over-documentation** - Don't document everything; document what users actually need

## Writing Concisely

**Default stance: Cut ruthlessly.** Most READMEs are too long, not too short.

Before writing each section:
1. **Does the reader need this to succeed?** If no, delete it.
2. **Can I show this with code instead of prose?** Code is clearer.
3. **Can I say this in half the words?** Usually yes.

**Anti-patterns to avoid:**
- Explaining what the project does in multiple places (say it once, in Description)
- Writing "This section covers..." (just cover it)
- Including aspirational features not yet implemented
- Documenting internal implementation details users don't need
- Writing full sentences when a bulleted list works better

**Good pattern:**
```markdown
## Installation

npm install my-package
```

**Bad pattern:**
```markdown
## Installation

This section will guide you through the installation process for my-package. 
To install this package, you'll need to have Node.js and npm installed on your 
system. Once you have those prerequisites, you can proceed with the following 
installation command which will download and install my-package from the npm 
registry into your project's node_modules directory:

npm install my-package
```

## Emoji Usage

**Default: Don't use emojis** unless the user explicitly requests them or the project context clearly calls for it (e.g., a fun personal project where the author's style is playful).

Reasons to avoid:
- **Professionalism** - Most projects benefit from straightforward, professional tone
- **Accessibility** - Screen readers struggle with emojis
- **Maintenance** - Emojis date quickly and feel trendy rather than timeless
- **Clarity** - Clear headers and structure work better than visual decoration

If emojis are requested:
- Use sparingly (1-2 per major section at most)
- Ensure they add meaning, not just decoration
- Never use in badges, code blocks, or technical instructions
- Avoid in professional/internal/OSS projects unless explicitly desired

## Prose Quality

For general writing advice — clear prose, Strunk's rules, and AI patterns to avoid — use the `writing-clearly-and-concisely` skill.
