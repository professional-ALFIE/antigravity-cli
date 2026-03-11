# Changelog

This document records user-visible release changes for `antigravity-cli` and the Bridge Extension.

## [Unreleased]

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

[Unreleased]: https://github.com/professional-ALFIE/antigravity-cli/compare/v0.1.2...main
[0.1.2]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.1.1
