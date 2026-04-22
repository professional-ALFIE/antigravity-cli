# Changelog

This document records user-visible release changes for `antigravity-cli`.

## [Unreleased]

## [0.3.0] - 2026-04-22

### Why this release matters

Antigravity had become too error-prone to trust for regular use. Transient backend failures, broken retry behavior, stale replay tails, noisy planner stubs, and unstable `--json` output were creating enough friction that people were starting to avoid Antigravity itself.

v0.3.0 fixes that foundation first, then builds quota orchestration on top of it.

### Retry philosophy

`503 UNAVAILABLE / No capacity available` errors are transient server-side capacity throttles rather than per-account quota signals. Measured retry intervals during these events fall between 1.3 and 18 seconds before a request is accepted.

v0.3.0 treats this as a case for silent, unbounded automatic retry: the same request eventually lands once the server has capacity, without consuming additional account quota.

### Added

- `auth refresh` for full cloud quota synchronization across all stored accounts.
- Account-card-based selective refresh for `auth list`, so read paths stay fast while stale or uncertain accounts are refreshed only when needed.
- Post-prompt quota orchestration with fresh quota reads, threshold crossing detection, and immediate same-run account switching.
- Wake-up orchestration for sleeping accounts, starting the five-hour usage timer early instead of waiting until the next account is needed.
- Fingerprint automation: prepare device identity at login, then apply it automatically on account switch.
- Offline-Gateway minimum fast-path for current-account quota reads on the existing offline path.
- Install-time local OAuth client bootstrap: `install.sh` now extracts the Google OAuth client pair from the installed Antigravity app and writes it to untracked `.env.local` when missing.

### Changed

- `auth refresh` is now the full synchronization command, while `auth list` is now the fast card-based read path.
- Rotate decisions are now based on **pre-turn vs post-turn crossing**, not a single snapshot.
- `pending-switch.json` is now an **applied record**, not a replay intent.
- The 90% bucket reset heuristic has been removed.
- Default family selection is now `CLAUDE`, unless the active model is explicitly Gemini.
- Offline-Gateway is treated as an extension of the existing offline path, not a separate product axis.
- Tracked source no longer ships the Google OAuth client pair in `src/services/oauthClient.ts`; runtime config now resolves from process env, then `.env.local`, then `.env`.

### Fixed

- Retry and replay behavior is now stable enough for regular use instead of being another source of corruption.
- Replay now drops stale execution tails instead of allowing old planner output to resurface after a retry.
- Transcript finalization now keeps tool-call-only success planners, drops failure stubs, and prevents partial planner output from being written as if it were final.
- `--json` output is now stable enough to consume reliably from external tooling.
- Final response recovery now respects ignored execution IDs, so failed replay attempts cannot leak stale success back into stdout.
- Non-JSON output no longer emits false warnings for tool-call-only successful turns.

### Release metadata

- GitHub release record: `v0.3.0`
- via Claude Code, OPUS-4.7

## [0.2.0] - 2026-04-08

### Breaking — Architecture

- **Removed the Bridge Extension.** The previous approach of running an HTTP server inside the IDE has been dropped entirely.
- **Headless LS is now spawned directly.** The bundled `language_server_macos_arm` binary inside `Antigravity.app` is executed directly, with a fake extension server handling the USS authentication handoff.
- Dissolved the monorepo (`packages/sdk`, `packages/extension`, `packages/cli`) into a single TypeScript repository.
- Dropped Node.js/npm dependencies — **Bun is now required.**

### Added

- **Automatic transcript recording.** Every conversation is written to `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl` as JSONL, following the `~/.claude/projects/…` convention used by Claude Code.
- **IDE last-used model as default.** Reads the `modelPreferences` sentinel key from `state.vscdb` so `--help` and the default model track whichever model was last used in the IDE.
- **Session-end summary block.** After each response, automatically prints `cascadeId`, `transcript_path`, and the resume command.
- **Colorized summary block.** Plain-mode footer highlights `cascadeId`, `transcript_path`, and `antigravity-cli --resume <cascadeId>` with ANSI colors.
- **IDE sidebar integration.** Headless conversations now appear in the IDE sidebar via `UpdateConversationAnnotations` + `trajectorySummaries` hydration.
- `-b, --background` option — skips UI-display registration.
- `--timeout-ms` option — overrides the stream timeout.
- `install.sh` — one-line install script based on Bun.

### Changed

- Replaced `-a, --async` (fire-and-forget) with `-b, --background` (skip UI display).
- Removed the `server`, `agent`, and `commands` subcommands — not supported in headless mode.
- `--resume` argument renamed: `SESSION_UUID` → `cascadeId` (UUID format).
- Plain-mode error handling now streams the user-facing error from the trajectory's `ERROR_MESSAGE` step instead of a generic warning.
- Full README rewrite (EN + KO) covering headless architecture, option tables, diagrams, and the Transcript section.

### Release metadata

- GitHub release record: `v0.2.0`
- via Antigravity, Claude Opus 4.6

## [0.1.2] - 2026-03-11

### Changed

- Translated all CLI user-facing strings from Korean to English — help text, option descriptions, error messages, spinner text, and 140+ internal command descriptions.
- Renamed `README.md` to `README.ko.md` and created a new English `README.md` for international audiences.
- Updated test expectations (`help-surface.test.ts`, `phase10.test.ts`) to match English translations.

### Release metadata

- GitHub release record: `v0.1.2`
- via Antigravity, Claude Opus 4.6

## [0.1.1] - 2026-03-11

### Fixed

- Fixed `fixLsConnection()` so it no longer matches `workspace_id` by substring.
- Prevented parent workspaces such as `meta-agent` from accidentally binding to a child workspace Language Server such as `issue-24-antigravity-sdk`.
- Added regression coverage for both `--workspace_id value` and `--workspace_id=value`.

### Changed

- Bumped the CLI and Bridge Extension versions to `0.1.1`.
- Synced `antigravity-cli -v` output and the related CLI test expectations with `0.1.1`.
- Repackaged `antigravity-bridge-extension-0.1.1.vsix` and reinstalled it into Antigravity IDE.

### Release metadata

- GitHub release record: `v0.1.1`
- via Codex App, GPT-5.4

[Unreleased]: https://github.com/professional-ALFIE/antigravity-cli/compare/v0.3.0...main
[0.3.0]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.3.0
[0.2.0]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.2.0
[0.1.2]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.1.1
