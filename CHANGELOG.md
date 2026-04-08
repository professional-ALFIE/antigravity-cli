# Changelog

This document records user-visible release changes for `antigravity-cli`.

## [Unreleased]

## [0.2.0] - 2026-04-08

### Breaking — Architecture

- **Bridge Extension 제거.** IDE 안에서 HTTP 서버를 띄우던 Bridge Extension 방식을 완전히 폐기.
- **Headless LS 직접 spawn.** `Antigravity.app` 내장 `language_server_macos_arm` 바이너리를 직접 실행하고, fake extension server가 USS 인증 핸드오프를 처리.
- monorepo (`packages/sdk`, `packages/extension`, `packages/cli`) 구조 해체 → 단일 TypeScript 레포로 전환.
- Node.js/npm 의존 제거 → **Bun 필수.**

### Added

- **Transcript 자동 저장.** 모든 대화를 `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl`에 JSONL로 자동 기록. Claude Code의 `~/.claude/projects/…` 관례를 따름.
- **IDE last-used 모델 기본값.** `state.vscdb`의 `modelPreferences` sentinel key를 읽어, `--help` 및 기본 모델을 IDE 마지막 사용 모델로 동적 반영.
- **세션 종료 안내 블록.** 응답 완료 후 `cascadeId`, `transcript_path`, resume 명령을 자동 출력.
- **안내 블록 색 강조.** plain 모드 footer에서 `cascadeId`, `transcript_path`, `antigravity-cli --resume <cascadeId>`를 ANSI 색으로 강조.
- **IDE UI 표시.** headless 대화가 IDE 사이드바에 뜨도록 `UpdateConversationAnnotations` + `trajectorySummaries` hydration 구현.
- `-b, --background` 옵션 — UI 표시 등록 생략.
- `--timeout-ms` 옵션 — 스트림 타임아웃 오버라이드.
- `install.sh` — bun 기반 원라이너 설치 스크립트.

### Changed

- `-a, --async` (fire-and-forget) 제거 → `-b, --background` (UI 표시 생략)으로 대체.
- `server`, `agent`, `commands` 서브커맨드 제거 — headless에서 미지원.
- `--resume` 인자 표기: `SESSION_UUID` → `cascadeId` (UUID format).
- plain 모드 에러 처리: generic warning 대신 trajectory `ERROR_MESSAGE` step의 사용자용 에러를 스트리밍 출력.
- README 전면 재작성 (EN + KO) — headless 아키텍처, 옵션 테이블, 다이어그램, Transcript 섹션.

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

[Unreleased]: https://github.com/professional-ALFIE/antigravity-cli/compare/v0.2.0...main
[0.2.0]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.2.0
[0.1.2]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/professional-ALFIE/antigravity-cli/releases/tag/v0.1.1
