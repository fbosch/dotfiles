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
3. Include parent-directory traversal and stop-search behavior in that policy.
4. If no, keep the behavior explicitly disabled.
5. Validate the policy in a disposable project directory rather than in dotfiles.
6. Document the final decision where future edits will find it.

## Required Checks To Add

1. Test nested parent and child project directories with separate local config files.
2. Verify trusted and untrusted path behavior explicitly.
3. Verify `set noexrc` in a parent stops further search.
4. Record the final policy in one canonical config location.

## Validation

1. Check whether local config prompts appear in a test project.
2. Confirm parent-directory discovery behaves as expected.
3. Confirm trusted and untrusted project behavior matches the chosen policy.
4. Confirm parent search stops where expected.

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
- The trust flow can be misunderstood because 0.12 makes it more explicit and less implicit than older behavior.
