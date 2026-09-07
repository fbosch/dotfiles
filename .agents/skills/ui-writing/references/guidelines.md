# Interface Writing Guidelines

Checked against the linked sources on 2026-09-07.

## Rule index

- [General decisions](#general-decisions): UI-01 through UI-12
- [Component decisions](#component-decisions): CMP-01 through CMP-07
- [Platform and locale conventions](#platform-and-locale-conventions): PLAT-01 through PLAT-03
- [Accessibility decisions](#accessibility-decisions): A11Y-01 and A11Y-02
- [Locale and localization decisions](#locale-and-localization-decisions): LOC-01 through LOC-03
- [Source and licensing boundaries](#source-and-licensing-boundaries)

## Governing principle

Improve the wording without changing or misrepresenting the behavior.

`Must` marks a requirement or a non-negotiable project safeguard. `Prefer`, `consider`, and `avoid` preserve recommendation strength. A rule marked **Our policy** is an original standard informed by the cited body of guidance, not a claim that an external source states it.

## General decisions

### UI-01: Verify behavior before naming it

- **Applies to:** All platforms; all components; all locales.
- **Instruction:** Inspect the implemented operation, destination, state transition, and failure path before changing text that describes them.
- **Boundary:** When evidence is missing, identify what must be verified. Do not infer deletion, persistence, completion, reversibility, or safety from nearby wording.
- **Example:** Change `Process` to `Export PDF` only after confirming the action creates a PDF.
- **Basis:** **Our policy.**

### UI-02: Name the user's action or outcome precisely

- **Applies to:** All platforms; actions; all locales.
- **Instruction:** Prefer the shortest familiar wording that distinguishes what the control does or what selecting it produces.
- **Boundary:** Do not force destination and navigation labels into verb phrases. A section named `Downloads` can remain a noun.
- **Example:** Use `Invite Member` for a button that sends an invitation; keep `Members` for the destination that lists members.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

### UI-03: Distinguish actions from current states

- **Applies to:** All platforms; controls and status text; all locales.
- **Instruction:** Use an action label for an available operation and state wording for a condition that already holds.
- **Boundary:** A toggle may name the setting rather than an imperative action when the control itself communicates on and off.
- **Example:** A button that begins sharing uses `Share`; a badge after sharing uses `Shared`.
- **Basis:** **Our policy.**

### UI-04: Keep terms consistent without collapsing behavior

- **Applies to:** All platforms; related flows; all locales.
- **Instruction:** Reuse a term for the same concept and reserve different terms for materially different operations.
- **Boundary:** Consistency does not justify replacing distinctions such as Remove/Delete, Close/Quit, or local/project vocabulary with superficially similar words.
- **Example:** Use `Remove from Sidebar` for detaching a shortcut and `Delete Folder` for deleting the folder's data.
- **Basis:** **Source-backed recommendation plus our boundary.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

### UI-05: Prefer clear, compact, literal wording

- **Applies to:** All platforms; all interface text; all locales.
- **Instruction:** Use familiar words, remove text that adds no decision-relevant meaning, and keep the tone neutral when the situation is serious or frustrating.
- **Boundary:** Do not remove necessary qualifications, consequences, domain terms, or locale-specific politeness to make text shorter.
- **Example:** Prefer `Unable to open “Budget”` to `Oops! Something went wrong with your file.`
- **Basis:** **Source-backed recommendation.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

### UI-06: Match instructions to the device and interaction

- **Applies to:** All platforms; help and instructional text; all locales.
- **Instruction:** Name the interaction people actually perform on the target device.
- **Boundary:** Cross-platform copy may need platform variants; do not choose `click` or `tap` as a universal replacement.
- **Example:** Use `Click Add` for a pointer interaction and `Tap Add` for a touch interaction when each context has its own string.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

### UI-07: Confirm with the operation and consequence

- **Applies to:** All platforms; confirmations and destructive actions; all locales.
- **Instruction:** Name the confirming action after the actual operation and state the material consequence people need to decide.
- **Boundary:** Do not claim that an operation is permanent, reversible, recoverable, synced, or safe unless the implementation establishes that fact.
- **Example:** Title `Delete 3 Reports?`; confirm with `Delete`, not `Yes`.
- **Basis:** **Source-backed recommendation plus our accuracy boundary.** [Apple HIG: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), checked 2026-09-07.

### UI-08: Preserve conventional labels when they are accurate

- **Applies to:** All platforms; dialogs and task flows; all locales.
- **Instruction:** Keep `Cancel`, `OK`, `Done`, `Back`, `Next`, and similar conventions when their established meaning matches the interaction.
- **Boundary:** Prefer a specific operation over `OK` for a consequential confirmation. `OK` remains appropriate for acknowledging a purely informational alert; `Done` can accurately mark completion and dismissal.
- **Example:** Keep `OK` on an alert that only reports the app version; use `Erase` instead of `OK` to confirm erasure.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) and [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), checked 2026-09-07.

### UI-09: Write only supported error facts

- **Applies to:** All platforms; errors; all locales.
- **Instruction:** State what failed in terms people can recognize. Add a verified next step when one exists.
- **Boundary:** Do not invent a cause, recovery path, guarantee, retry outcome, or claim about data safety. If only the failure is known, say only that.
- **Example:** Use `Unable to upload “Map.png”.` when neither the cause nor a reliable remedy is known.
- **Basis:** **Source-backed recommendation plus our evidence boundary.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing) and [Apple HIG: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), checked 2026-09-07.

### UI-10: Distinguish loading, empty, filtered-empty, failed, and completed states

- **Applies to:** All platforms; status, list, and content states; all locales.
- **Instruction:** Describe the state the interface can establish: work is ongoing, no data exists, no data matches a filter, retrieval failed, or work finished.
- **Boundary:** Do not show an empty-state invitation before loading ends, a completion claim while work remains, or `No results` when retrieval failed.
- **Example:** Use `Loading projects…`, `No projects yet`, `No projects match these filters`, `Unable to load projects`, and `Import complete` for the five distinct states.
- **Basis:** **Our policy**, informed by [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing) and [Apple HIG: Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), checked 2026-09-07.

### UI-11: Keep progress feedback temporally accurate

- **Applies to:** All platforms; status and progress feedback; all locales.
- **Instruction:** Use ongoing language only while work is active and completion language only after the operation reaches its defined success state.
- **Boundary:** Do not promise a duration or percentage unless the system measures it. Do not convert an indeterminate operation into a determinate claim through wording.
- **Example:** Use `Syncing…` while duration is unknown, not `Almost done`.
- **Basis:** **Source-backed recommendation plus our accuracy boundary.** [Apple HIG: Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), checked 2026-09-07.

### UI-12: Make focused changes and preserve correct copy

- **Applies to:** All platforms; implementation and review; all locales.
- **Instruction:** Change only wording that has a behavioral, accessibility, locale, component, or material clarity problem.
- **Boundary:** Treat preference-level alternatives as optional and do not rewrite correct text to satisfy a stylistic urge or produce review findings.
- **Example:** Leave `Cancel` unchanged when it dismisses the dialog without applying changes.
- **Basis:** **Our policy.**

## Component decisions

### CMP-01: Start button labels with an action when it improves clarity

- **Applies to:** All platforms; text buttons; locales where action-led labels are grammatical.
- **Instruction:** Keep labels to a few words and consider starting with a verb that describes the action.
- **Boundary:** This is a recommendation, not a ban on conventional or stateful labels. Preserve `OK`, `Done`, or a well-understood setting label when it fits the component.
- **Example:** Prefer `Add to Queue` to `Queue Addition` for a button that adds the selection.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), checked 2026-09-07.

### CMP-02: Use navigation labels as destinations

- **Applies to:** All platforms; tabs, sidebars, breadcrumbs, and navigation links; all locales.
- **Instruction:** Name the place or content people will reach, usually with a concise noun or noun phrase.
- **Boundary:** Use a verb when the item performs an immediate action rather than navigation.
- **Example:** Use `Account` for a settings destination and `Sign Out` for the action inside it.
- **Basis:** **Our policy.**

### CMP-03: Make settings labels describe the enabled condition

- **Applies to:** All platforms; toggles, checkboxes, and settings rows; all locales.
- **Instruction:** Use a clear, simple label for the setting. Explain what happens when it is on when supporting text is needed.
- **Boundary:** Do not write paired on/off prose when the control already communicates state, unless the off behavior is not the inverse or has a material consequence.
- **Example:** Label a toggle `Download Updates Automatically`; explain the schedule only if the implementation defines one.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

### CMP-04: Structure alerts around the decision

- **Applies to:** All platforms; alerts and confirmation dialogs; all locales.
- **Instruction:** Use a specific title for the situation or decision. Add informative text only for consequences or context the title and buttons do not already convey.
- **Boundary:** Do not use an alert for routine status when a nonmodal message can communicate it, and do not explain self-evident buttons in the body.
- **Example:** Title `Replace Existing Export?`; body `The previous PDF will be overwritten.`; buttons `Cancel` and `Replace`.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), checked 2026-09-07.

### CMP-05: Give empty states a relevant next step

- **Applies to:** All platforms; genuinely empty views; all locales.
- **Instruction:** Explain the absence when it is not obvious and provide a useful next action when one exists.
- **Boundary:** Do not place crucial information only in a temporary empty state. Do not offer a next step the interface cannot perform.
- **Example:** `No collections yet` with `New Collection` when creation is available.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

### CMP-06: Keep tooltips local to the control

- **Applies to:** All platforms; tooltips and comparable hover or focus help; all locales.
- **Instruction:** Briefly describe the indicated control's action or task, often beginning with a verb.
- **Boundary:** Avoid repeating the visible name unless repetition is needed for clarity or accessibility. Do not turn a tooltip into instructions for a larger workflow.
- **Example:** For an icon-only reset control, use `Restore default settings` rather than `Reset button for changing all preferences back to their defaults`.
- **Basis:** **Source-backed recommendation.** [Apple HIG: Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help), checked 2026-09-07.

### CMP-07: Keep help text contextual and verifiable

- **Applies to:** All platforms; field hints, inline help, and short instructions; all locales.
- **Instruction:** Supply the missing format, constraint, consequence, or next step near the relevant control.
- **Boundary:** Do not restate the label, document unrelated controls, or assert a validation rule not enforced by the product.
- **Example:** Add `8 characters minimum` only when the validator enforces that minimum.
- **Basis:** **Source-backed recommendation plus our evidence boundary.** [Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing), checked 2026-09-07.

## Platform and locale conventions

### PLAT-01: Follow component-specific capitalization and punctuation

- **Applies to:** All platforms; buttons and menu commands; all locales.
- **Instruction:** Follow the target platform's or design system's documented casing and punctuation for the specific component.
- **Boundary:** Do not apply one component's convention as a global transformation. A more specific component rule, explicit project convention, product spelling, or locale rule takes precedence.
- **Example:** If a desktop design system specifies title-style command labels, use `Save a Copy` there while keeping body text in the locale's normal sentence casing.
- **Basis:** **Our policy**, informed by [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Apple HIG: Menus](https://developer.apple.com/design/human-interface-guidelines/menus), and [Apple Style Guide: About the guide](https://support.apple.com/guide/applestyleguide/about-the-guide-apsg1eef9171/web), checked 2026-09-07.

### PLAT-02: Use menu ellipses for required follow-up input

- **Applies to:** Platforms and design systems that define an ellipsis convention for menu commands; all supported locales.
- **Instruction:** Use the convention's ellipsis when choosing the command requires more information or another choice before the command can complete.
- **Boundary:** Do not add an ellipsis merely because a command opens a window or view. Omit it when the command is complete upon selection or the opened view only shows information.
- **Example:** Use `Export…` when the next dialog requires a filename; use `Downloads` without an ellipsis when it only opens the Downloads view.
- **Basis:** **Source-backed example plus our scope boundary.** [Apple HIG: Menus](https://developer.apple.com/design/human-interface-guidelines/menus), checked 2026-09-07.

### PLAT-03: Use button ellipses only for a follow-up task

- **Applies to:** Platforms and design systems that define an ellipsis convention for buttons; all supported locales.
- **Instruction:** Consider the convention's ellipsis when the button opens another view or application where people must provide additional input to complete the action.
- **Boundary:** A disclosure, navigation, or informational view does not need an ellipsis solely because it opens.
- **Example:** Use `Choose Folder…` when selection happens in a picker; keep `Show Details` when details simply appear.
- **Basis:** **Source-backed example plus our scope boundary.** [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), checked 2026-09-07.

## Accessibility decisions

### A11Y-01: Keep the visible label in the accessible name

- **Applies to:** Web content subject to WCAG 2.2; controls with visible text or images of text; all locales.
- **Instruction:** The accessible name must contain the visible label text after the comparison conventions in WCAG's guidance are applied. Prefer an exact match; when extra context is useful, place the visible words first and in the same order.
- **Boundary:** WCAG 2.5.3 does not govern controls with no visible text label, though other accessibility requirements still require an appropriate name. Capitalization and most punctuation differences do not fail this criterion; inspect the computed accessible name instead of using byte-for-byte comparison. Exact matching and visible-label-first ordering are informative best practices, not the normative criterion.
- **Example:** Visible `Search…` with accessible `Search` passes. Visible `Search` with accessible `Find projects` does not.
- **Basis:** **WCAG 2.2 Level A requirement plus W3C informative advice.** [WCAG 2.2 SC 2.5.3](https://www.w3.org/TR/WCAG22/#label-in-name) and [Understanding Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html), checked 2026-09-07.

### A11Y-02: Name unlabeled controls by purpose

- **Applies to:** All platforms; icon-only and custom controls; all locales.
- **Instruction:** Inspect the control's role and state model, then provide an accessible name that identifies its purpose in context.
- **Boundary:** For an ordinary action button, update the name when the available action changes. For a web toggle button that exposes `aria-pressed`, keep a stable setting name such as `Mute`; the pressed state communicates whether it is on. Do not include the control type when the accessibility API already supplies it or claim an action the control does not perform.
- **Example:** Name an ordinary icon-only action `Unmute` when selecting it unmutes. Keep `Mute` stable on a toggle whose `aria-pressed` value changes.
- **Basis:** **Source-backed recommendation.** [Apple HIG: VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover) and [WAI-ARIA APG: Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/), checked 2026-09-07.

## Locale and localization decisions

### LOC-01: Apply casing and punctuation within locale scope

- **Applies to:** All platforms; localized text; all locales.
- **Instruction:** Follow the target language's grammar, casing, punctuation, and project locale guidance.
- **Boundary:** A style guide's casing and usage apply only to its stated language and locale. Do not title-case, reorder, strip articles from, or otherwise normalize non-English text with English rules.
- **Example:** Leave Danish `Åbn seneste` in Danish sentence casing instead of changing it to `Åbn Seneste`.
- **Basis:** **Source-backed scope statement plus our safeguard.** [Apple Style Guide: About the guide](https://support.apple.com/guide/applestyleguide/about-the-guide-apsg1eef9171/web), checked 2026-09-07.

### LOC-02: Preserve localization structure exactly

- **Applies to:** All platforms; localization resources and localized code; all locales.
- **Instruction:** Preserve placeholder identities, types, bindings, required occurrences, plural and select branches, markup, escapes, message identifiers, product names, and language-specific characters unless the task explicitly requires a verified structural change.
- **Boundary:** Reorder named or explicitly indexed placeholders when the locale's grammar requires it and the formatter preserves their bindings. Preserve order when positional binding depends on it. Do not rename internal keys while editing visible copy.
- **Example:** Rewrite `Delete {count, plural, one {# file} other {# files}}?` without removing `{count}` or either plural branch.
- **Basis:** **Our policy**, supported by the linked guidance on language-specific plural variants in [Localizing and varying text with a string catalog](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog), checked 2026-09-07.

### LOC-03: Validate every affected variant

- **Applies to:** All platforms; plural, select, width, device, and locale variants; all locales.
- **Instruction:** Check that each affected variant remains grammatical, semantically aligned, and structurally valid after an edit. Run the project's existing localization checks when available.
- **Boundary:** Do not assume English singular/other categories, word order, or one platform string covers every locale and device variant. Use established parsers and representative branch checks; do not claim exhaustive validation when combinatorial variants were not all exercised.
- **Example:** After changing a count message, inspect Russian `one`, `few`, `many`, and `other` branches rather than editing only `other`.
- **Basis:** **Source-backed technical guidance plus our validation policy.** [Localizing and varying text with a string catalog](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog), checked 2026-09-07.

## Source and licensing boundaries

The Apple HIG pages are client-rendered. Direct text extraction returned empty bodies during this check, so their current Apple-hosted indexed content and change logs were used. The W3C Understanding page returned HTTP 403 to direct fetching; the current W3C-hosted indexed page and normative WCAG 2.2 text were available.

[Apple Localization](https://applelocalization.com/macos) and the linked community repositories expose strings extracted from Apple platforms. Such strings can show actual usage in a specific app, OS release, key, and locale. They are not Apple editorial guidance and do not establish universal terminology.

No glossary data is bundled here. The `applelocalization-tools` repository did not expose a root software license when checked. Xliffie's GPL-3.0 license covers its repository software, but it does not establish redistribution rights for Apple-derived glossary content. A tool's software license must not be treated as a license for extracted data.
