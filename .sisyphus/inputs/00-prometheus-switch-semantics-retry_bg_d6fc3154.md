# Oracle Retry Input: switch semantics for v0.3.0 spec

First read `.sisyphus/mandate_v030-auth-spec.md`.

## Task
Re-evaluate the correct conceptual model for **auth inject / full switch / seamless switch** in the v0.3.0 integrated spec.

## Required Context
- The repo currently has only `auth list` and `auth login` as public auth commands.
- Current `auth list` reads live LS `GetUserStatus` when available, otherwise persisted `state.vscdb`.
- Current `auth list` selection changes active account only; it does not inject auth state.
- Offline path already has best-effort surfaced writeback for `trajectorySummaries`/`sidebarWorkspaces`, but this is not yet proof for future wake-up/quota design.

## Questions To Answer
1. Was `spec-opus` too Cockpit-shaped when it used **Full Switch Default** as the baseline wording?
2. Which part of the user's claim is technically plausible?
   - This project is moving from whole-profile switching toward auth-only storage and auth-only apply.
   - Because the CLI often runs headless/background rather than as a visible IDE app, the runtime reaction problem may be simpler than Cockpit's plugin case.
3. What exact distinction should the integrated spec make between:
   - auth storage
   - auth inject/apply
   - live runtime noticing/applying injected auth
   - wake-up runtime behavior
4. What experiments must be listed before final wording is frozen?
5. Suggest replacement wording for the spec so it does not mislead by importing Cockpit's vocabulary too literally.

## Constraints
- Stay at spec semantics level only.
- Do not propose implementation work beyond experiments and wording fixes.
- Do not produce implementation plans, execution waves, or coding TODOs.
- Base your answer on the repository files and the referenced Cockpit materials already available in this repo.

## Output Contract
- Save the detailed answer to `.sisyphus/outputs/{nn}_oracle_switch-semantics_{task_id}.md`.
- Reply with one short line that includes the exact saved file path.
