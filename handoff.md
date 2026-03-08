# Handoff — 다음 세션 인수인계

> 마지막 업데이트: 2026-03-08 09:12 KST

## 현재 상태 요약

Bridge Extension + CLI 전체 기능 완성. **15개 API/CLI 명령 정상 작동**.
CLI 리팩토링 Phase 7-0, 7-1 **완료**. exec 전체 흐름 검증 완료.
Phase 8 auto-run fix **완료** — macOS/Windows 크로스플랫폼 패치 성공.
CLAUDE.md 작업 규칙 2개 추가 (추측 금지, 내부 용어 금지).
`commands list` — 141개 명령어 한줄 설명 + 좌우 정렬 출력 완료.

---

## 완료된 작업

### Phase 1~6: 기본 인프라 (전체 완료)
- [x] 모노레포 구조 (npm workspaces: sdk, extension, cli)
- [x] Extension + HTTP 서버 + REST API (7개 라우트: health, cascade, ls, commands, state, monitor, integration)
- [x] SDK 로컬 포크 — protobuf-es oneof → ProtoJSON 변환 수정
- [x] LS Bridge CSRF 토큰 문제 해결 — `fixLsConnection()` lsof Phase 2
- [x] CLI 전체 커맨드 (15개): exec, list, focus, status, prefs, diag, commands, accept, reject, run, monitor, state, ui, auto-run
- [x] 14/14 통합 테스트 통과

### Phase 7-0: CLI 리팩토링 기반 (완료)
- [x] `src/colors.ts` — ANSI 컬러 유틸 (NO_COLOR 표준 지원)
- [x] 커맨드 파일 분리 — `bin/antigravity-cli.ts`(64행 진입점) + `src/commands/`(11개 파일)
- [x] 공유 헬퍼 — `src/helpers.ts` (getClient, isJsonMode, run)
- [x] 글로벌 설치 — `package.json`에 `bin` 필드 확인

### Phase 7-1: exec 응답 스트리밍 (완료 ✅)
- [x] Extension `ls.ts` — `GET /api/ls/conversation/:id` 라우트 추가
- [x] SDK `ls-bridge.ts` — `GetConversation`(없음) → `GetCascadeTrajectory` RPC 수정
- [x] CLI `spinner.ts` — ANSI 스피너 유틸 (58행, 외부 의존성 없음)
- [x] CLI `client.ts` — `streamUntil()` 메서드 추가 (SSE + idle timeout 자동 종료)
- [x] CLI `exec.ts` — SSE 기반 응답 대기 + 완료 감지 + 응답 출력
  - 응답 추출: `trajectory.steps[].plannerResponse.response`
  - `--no-wait`: fire-and-forget (검증 완료)
  - `--idle-timeout <ms>`: idle timeout 설정 (기본 10000)
  - `-r, --resume <id>`: 기존 대화 이어서 전송
- [x] 전체 흐름 검증 완료: `exec "2+2는?" -m flash` → 128 steps, 25s, 응답 본문 정상 출력

---

## 다음 단계: 미완료 리팩토링 (plan.md Phase 7-2~7-7)

> ⚠️ 리팩토링 항목은 **주인님과 상의 후** 진행한다.

| Phase | 대상 | 핵심 | 상태 |
|-------|------|------|------|
| 7-2 | `list` | JSON 덤프 → 정렬된 테이블 | 미착수 |
| 7-3 | `status` | JSON 덤프 → 요약 출력 | 미착수 |
| 7-4 | `prefs` | JSON 덤프 → key=value | 미착수 |
| 7-5 | `diag` | JSON 덤프 → 시스템 정보 요약 | 미착수 |
| 7-6 | `monitor` | 이벤트 타임스탬프/아이콘 | 미착수 |
| 7-7 | 기타 | commands list 설명 ✅ / 나머지 출력 개선 | 진행 중 |

---

## Phase 8: better-antigravity 통합 ✅

> 출처: `/tmp/better-antigravity` (Kanezal/better-antigravity 클론)
> **목표:** Extension 시작 시 "Always Proceed" 정책이 **실제로 동작하도록** 자동 패치.

| Sub | 내용 | 핵심 | 상태 |
|-----|------|------|------|
| 8-1 | Auto-Run Fix | workbench JS에 누락된 `useEffect` 패치 (기본 ON) | ✅ |
| 8-2 | SDK Integration | chat rename + integrity suppression + auto-repair | 미착수 |
| 8-3 | CLI 연동 | `antigravity-cli auto-run status/revert/apply` | ✅ |

**macOS 패치 경로 (2026-03-08 확인):**
```text
workbench: app/out/vs/workbench/workbench.desktop.main.js
jetskiAgent: app/out/jetskiAgent/main.js
```
⚠️ Windows 경로는 `app/out/vs/code/electron-browser/workbench/` 하위

---

## 코드 구조

```
issue-24-antigravity-sdk/
├── packages/
│   ├── sdk/                          ← antigravity-sdk 포크 (protobuf 수정)
│   ├── extension/                    ← Bridge Extension
│   │   ├── src/
│   │   │   ├── auto-run.ts         ← auto-run fix (macOS/Windows)
│   │   │   ├── extension.ts        ← activate/deactivate
│   │   │   └── server/
│   │   │       ├── http-server.ts     ← HTTP 서버
│   │   │       ├── router.ts          ← URL→핸들러 라우팅
│   │   │       └── routes/
│   │   │           ├── auto-run.ts    ← auto-run API (status/revert/apply)
│   │   │           ├── ls.ts          ← LS API (create/send/focus/list/conversation)
│   │   │           ├── cascade.ts    ← cascade API (sessions/prefs/diag/steps)
│   │   │           ├── health.ts     ← health check
│   │   │           ├── commands.ts   ← commands API
│   │   │           ├── state.ts      ← state API
│   │   │           ├── monitor.ts    ← SSE 이벤트
│   │   │           └── integration.ts← UI integration API
│   │   ├── dist/extension.js         ← 빌드 결과물 (tsup)
│   │   └── *.vsix                    ← 패키징된 확장
│   └── cli/                          ← antigravity-cli
│       ├── bin/antigravity-cli.ts     ← 진입점 (64행)
│       └── src/
│           ├── commands/              ← (12개 커맨드 파일)
│           │   ├── exec.ts            ← 핵심: SSE 응답 스트리밍 (169행)
│           │   ├── auto-run.ts        ← auto-run status/revert/apply (132행)
│           │   ├── list.ts
│           │   ├── focus.ts
│           │   ├── step-control.ts    ← accept/reject/run
│           │   ├── status.ts
│           │   ├── monitor.ts
│           │   ├── prefs.ts
│           │   ├── diag.ts
│           │   ├── commands.ts
│           │   ├── state.ts
│           │   └── ui.ts
│           ├── client.ts              ← HTTP/SSE 클라이언트 (212행)
│           ├── discovery.ts           ← 인스턴스 탐색 (59행)
│           ├── helpers.ts             ← 공유 헬퍼 (39행)
│           ├── spinner.ts             ← ANSI 스피너 (58행)
│           ├── colors.ts              ← ANSI 컬러 유틸 (10행)
│           └── output.ts              ← 포매팅 (93행)
├── plan.md                            ← 통합 구현 계획 (Phase 1~8)
├── handoff.md                         ← 이 문서
└── package.json                       ← npm workspaces
```

---

## 핵심 포트/경로

| 항목 | 값 |
|------|-----|
| Extension HTTP 서버 | `127.0.0.1:<랜덤 포트>` (재시작 시 변경) |
| 포트 저장 | `~/.antigravity-cli/instances.json` |
| LS Bridge | Extension 내부에서 lsof로 자동 탐색 |
| 모델 기본값 | opus (1154) |

---

## 빌드 & 테스트 명령

```bash
# SDK 빌드
cd packages/sdk && npm run build

# Extension 빌드
cd packages/extension && npm run build

# Extension .vsix 패키징
cd packages/extension && yes | npx @vscode/vsce package --no-dependencies

# CLI 실행 (빌드 없이 bun 직접 실행)
bun packages/cli/bin/antigravity-cli.ts <command>

# exec 테스트
bun packages/cli/bin/antigravity-cli.ts exec "1+1은?" -m flash
bun packages/cli/bin/antigravity-cli.ts exec "분석해" --no-wait
bun packages/cli/bin/antigravity-cli.ts exec "이어서" -r <cascade-id>

# 상태 확인
bun packages/cli/bin/antigravity-cli.ts status
bun packages/cli/bin/antigravity-cli.ts list

# auto-run 상태 확인
bun packages/cli/bin/antigravity-cli.ts auto-run status
bun packages/cli/bin/antigravity-cli.ts auto-run revert
bun packages/cli/bin/antigravity-cli.ts auto-run apply
```

---

## 주의사항

1. **Extension은 .vsix로 설치해야 IDE가 인식** — `npm run build`만으로는 IDE에 반영 안 됨
2. **포트는 재시작 시 변경** — `~/.antigravity-cli/instances.json`에서 CLI가 자동 탐색
3. **SDK는 로컬 포크** — npm 공개 버전과 다름 (`packages/sdk/src/transport/ls-bridge.ts` 수정)
4. **OAuth 토큰 접근 차단** — SDK의 SENSITIVE_KEYS 블록리스트
5. **커밋 규칙** — 한글 메시지, 접두어(`feat:`, `fix:`, `refactor:`, `chore:`)
