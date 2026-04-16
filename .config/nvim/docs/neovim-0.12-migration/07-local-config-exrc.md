# Local Config And exrc Migration Plan

## Scope

- Current repo state shows no local project config files such as `.nvim.lua`, `.nvimrc`, or `.exrc`.
- If this policy is made explicit later, the likely config home is `.config/nvim/lua/config/opts.lua`.

## Goal

Decide whether project-local Neovim config should be part of this setup under Neovim 0.12 and make that behavior explicit.

## Why This Area Matters

Neovim 0.12 changes how local config discovery and trust work for `exrc`-style behavior. Even though this repo does not currently define that behavior, the new model can still affect other project directories if local config is enabled elsewhere.

## Plan

1. Decide whether this Neovim setup should support project-local config files at all.
2. If yes, define the intended trust and discovery policy.
3. If no, keep the behavior explicitly disabled.
4. Validate the policy in a disposable project directory rather than in dotfiles.
5. Document the final decision where future edits will find it.

## Validation

1. Check whether local config prompts appear in a test project.
2. Confirm parent-directory discovery behaves as expected.
3. Confirm trusted and untrusted project behavior matches the chosen policy.

## Done When

- Local config behavior is intentional rather than accidental.
- Trust prompts and parent-directory lookup are understood.
- Future edits have a documented policy to follow.

## Likely Grep Targets

- `exrc`
- `secure`
- `.nvim.lua`
- `.nvimrc`
- `.exrc`
- `trust`

## Risks

- This area can be ignored too long because it may not break obvious workflows.
- The impact may only appear when editing outside this dotfiles repo.
