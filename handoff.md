# Handoff — 다음 세션 인수인계

> 마지막 업데이트: 2026-03-10 07:03 KST

## 현재 상태 요약

Bridge Extension + CLI 전체 기능 완성. **15개 API/CLI 명령 정상 작동**.
CLI 리팩토링 Phase 7-0, 7-1 **완료**. exec 전체 흐름 검증 완료.
Phase 8 auto-run fix **완료** — macOS/Windows 크로스플랫폼 패치 성공.
Phase 9 auto-run fix hardening **완료**.
Phase 10 1차 **완료** — 루트 기본 모드, `--resume` 통합, 작업영역 fallback 제거, 현재 작업영역 목록 필터 적용.
CLI 테스트 **12/12 통과** (`npm -w packages/cli test`).
exec 모델 선택 검증 완료 — `claude-sonnet-4.6`, `gemini-3-flash` 실제 동작 확인.
**UI 등록 정상 확인** — `ls.createCascade()`만으로 IDE UI에 대화 자동 등록됨.

**다음 단계:** Phase 7 출력 포맷 개선 또는 Phase 8-2 SDK integration 미착수분 진행. `--hidden` / visible 제어는 아직 보류.

---

## 완료된 작업

### Phase 1~6: 기본 인프라 (전체 완료)
- [x] 모노레포 구조 (npm workspaces: sdk, extension, cli)
- [x] Extension + HTTP 서버 + REST API (7개 라우트: health, cascade, ls, commands, state, monitor, integration)
- [x] SDK 로컬 포크 — protobuf-es oneof → ProtoJSON 변환 수정
- [x] LS Bridge CSRF 토큰 문제 해결 — `fixLsConnection()` lsof Phase 2
- [x] CLI 전체 커맨드 (15개): exec, list, focus, status, prefs, diag, commands, accept, reject, run, monitor, state, ui, auto-run
- [x] 14/14 통합 테스트 통과
- [x] auto-run hardening 테스트 8/8 통과 (`npm -w packages/extension run test:auto-run`)
- [x] 최신 hardening 반영본 `.vsix` 재패키징 완료 (`packages/extension/antigravity-bridge-extension-0.1.0.vsix`)
- [x] 최신 `.vsix` 재설치 후 auto-run 정상 확인 (`already-patched`, CLI status=`patched`, prefs=`EAGER`/secure off)

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

### exec / UI 등록 — 관찰 기록 (2026-03-10)

- [x] **결론:** `ls.createCascade()`만으로 IDE UI에 대화가 자동 등록됨. 별도 `trackBackgroundConversationCreated` 호출 불필요.
- [x] `exec "UI 등록 테스트" --no-wait` 실행 → 즉시 IDE UI에 대화 생성 확인
- [x] 모델 선택 검증: `claude-sonnet-4.6`, `gemini-3-flash` 둘 다 성공
- [x] 기존 "UI 등록 불가" 추론은 틀렸음 — 코드 추론보다 런타임 실험이 우선

**새로 발견된 문제: 작업영역 격리**
- issue-24에서 `exec`로 만든 대화가 issue-18 작업영역 창의 UI까지 바꿔버리는 현상 확인
- 원인: 현재 `focusCascade`/`setVisibleConversation` 등은 cascadeId만 받고 workspaceUri/windowId가 없음
- **현재 결론:** Phase 10 1차에서는 UI 제어를 구현하지 않고, 현재 작업영역 인스턴스 매칭 + 목록 필터만 먼저 해결
- [x] **보류 정책:** `--hidden` / visible 제어는 후속 단계로 미룸

### Phase 10 설계 보정 — 유효한 비판 반영 (2026-03-10)

- [x] **UI 등록 경로 재확정:** `ls.createCascade()`만으로 현재 런타임에서 IDE UI 자동 등록이 됨
  - 따라서 `trackBackgroundConversationCreated(cascadeId)` / `setVisibleConversation(cascadeId)`는 **기본 visible 경로로 확정하지 않는다**
  - 이 두 command는 workspace 격리 검증용 **실험 후보**로만 취급
- [x] **작업영역 격리 구현은 아직 미확정:** “같은 bridge 인스턴스에서 command 호출하면 해당 창만 바뀔 것”이라고 가정하지 않음
  - 다음 세션 첫 작업은 runtime 실험
  - A workspace bridge에서 UI 관련 command 호출 시 B workspace 창 UI가 바뀌는지 먼저 확인
- [x] **최소 구현 원칙 유지:** 새 대화 실행 로직은 가능하면 새 추상화 계층(conversation runner class 등) 없이 함수 재사용 수준으로 끝낸다
  - 현재 `exec.ts` 규모에서는 과도한 추상화 지양
- [x] **루트 기본 모드 구현 접근 고정:** commander 에 루트/서브커맨드 충돌 해석을 맡기지 않고, `process.argv` 사전 분기 방식 사용
  - 유지보수 서브커맨드: `server`, `commands`, `agent`, `auto-run`, `accept`, `reject`, `run`, `ui`
  - 레거시 금지어: `exec`, `resume` → 메시지로 해석하지 않고 명시적 오류
  - 프롬프트/메시지는 반드시 `"..."` 로 감싸서 전달
- [x] **resume 목록 최소화 고정:**
  - 목록은 **반드시 현재 작업영역 것만** 출력
  - 제목은 `ls/list` 응답의 `summary`를 그대로 사용
  - `summary`가 없으면 `(session)`
  - 첫줄 fallback 조회는 구현하지 않음 (추가 RPC 없이 최소 구현 유지)
- [x] **이어쓰기 문법 고정:**
  - `antigravity-cli --resume` → 현재 작업영역 대화 목록
  - `antigravity-cli --resume <uuid> "메시지"` → 이어쓰기
  - `--resume <uuid>`에 메시지가 없으면 에러 처리
- [x] **비동기 옵션 명칭 고정:** 새 UX에서는 `--no-wait` 대신 `--async`
  - `--no-wait`는 과거 구현 기록으로만 남기고 새 문서/예시에는 쓰지 않음
- [x] **레거시 문법 처리 고정:** alias 없음
  - `antigravity-cli exec "하이"` → 오류
  - `antigravity-cli resume` / `resume <uuid>` → 오류
  - 새 UX만 지원


---

## 다음 단계: Phase 10 후속 / 남은 리팩토링

> **코덱스 대화 (2026-03-10)에서 결정된 사항:**

### Before → After

| Before | After |
|--------|-------|
| `antigravity-cli exec "메시지"` | `antigravity-cli "메시지"` |
| `antigravity-cli exec "이어서" -r <uuid>` | `antigravity-cli "이어서" --resume <uuid>` |
| `antigravity-cli resume` | `antigravity-cli --resume` |
| `antigravity-cli resume <id>` | 오류 (새 UX만 지원) |
| `antigravity-cli --no-wait "메시지"` | `antigravity-cli --async "메시지"` |

### Phase 10 세부 항목

| Sub | 내용 | 상태 |
|-----|------|------|
| 10-1 | CLI 진입점 재설계 (exec → 루트 기본 모드) | 완료 |
| 10-2 | 실행 경로 고정 (`ls/create`, `ls/send`, root-mode) | 완료 |
| 10-3 | 작업영역 격리 (instances.json fallback 제거 + 목록 필터) | 완료 |
| 10-4 | `--resume` 대화 목록 포맷 | 완료 |
| 10-5 | `--hidden` / visible UI 제어 | 보류 |

### 미완료 리팩토링 (plan.md Phase 7 나머지)

| Phase | 대상 | 핵심 | 상태 |
|-------|------|------|------|
| 7 | `server status/prefs/diag/monitor` | 출력 포맷 개선 | 미착수 |
| 7 | `list` | JSON 덤프 → 정렬된 테이블 | 미착수 |
| 7 | 기타 명령 | 출력 형태 개선 | 미착수 |

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

## Phase 9: Auto-Run Fix 안정화 + Hardening ✅ (재시작 흰 화면 방지)

> 상세: `revise-plan-opus.md` 참조

**문제:** `.vsix` 설치 후 IDE 재시작 시 흰 화면 크래시.
**원인 4가지:** `;` 누락 구문 오류, product.json 체크섬 불일치, useMemo 오탐지 (useEffect 대신), 재실행 안전성 부족.

| Task | 내용 | 수정 파일 | 상태 |
|------|------|-----------|------|
| 9-1 | 패치 문자열 앞뒤 `;` 추가 | `auto-run.ts` | ✅ |
| 9-2 | product.json 체크섬 갱신/복원 | `auto-run.ts` | ✅ |
| 9-3 | `node --check` 구문 검증 | `auto-run.ts` | ✅ |
| 9-4 | `useEffect:(\w+)` dispatcher alias 직접 추출 | `auto-run.ts` | ✅ |
| 9-5 | 로깅 보강 + revertAll await | `extension.ts`, `routes/auto-run.ts` | ✅ |
| 9-6 | hardening 후속 수정 | `auto-run.ts`, `packages/cli/src/commands/auto-run.ts`, `packages/extension/test/auto-run.test.ts` | ✅ |

### 9-6 핵심 결과
- [x] `detectPatchStateFromContent()` 추가 — `patched / unpatched / patch-corrupted` 3단계 판정
- [x] marker-only 상태를 정상 패치로 오인하지 않음
- [x] `autoApply()` / `revertAll()` 순차 처리로 `product.json` 경쟁 상태 제거
- [x] checksum write/restore 실패 시 JS rollback 보장
- [x] `auto-run status` API/CLI가 `corrupted` 상태를 별도 표시
- [x] fixture 기반 테스트 9개 추가, build + test 통과
- [x] `antigravity-bridge-extension-0.1.0.vsix` 재생성 완료 (2026-03-10 01:39 KST)
- [x] 실제 IDE 재설치 후 Output/CLI/prefs 확인 완료 (2026-03-10 02:02 KST)

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
│   │   ├── test/
│   │       ├── auto-run.test.ts      ← auto-run hardening 검증 8개
│   │       └── fixtures/             ← workbench/jetski 축약 입력
│   │   └── *.vsix                    ← 패키징된 확장
│   └── cli/                          ← antigravity-cli
│       ├── bin/antigravity-cli.ts     ← 진입점 (76행)
│       └── src/
│           ├── commands/              ← (7개 커맨드 파일)
│           │   ├── exec.ts            ← 루트 대화 실행 본체 (122행)
│           │   ├── auto-run.ts        ← auto-run status/revert/apply (132행)
│           │   ├── step-control.ts    ← accept/reject/run
│           │   ├── server.ts          ← status/prefs/diag/monitor/state/reload/restart
│           │   ├── commands.ts
│           │   └── ui.ts
│           ├── client.ts              ← HTTP/SSE 클라이언트 (212행)
│           ├── discovery.ts           ← 인스턴스 탐색 (81행)
│           ├── helpers.ts             ← 공유 헬퍼 (39행)
│           ├── root-mode.ts           ← Phase 10 루트 모드 파서/분기 (254행)
│           ├── resume-list.ts         ← 현재 작업영역 목록 필터/포맷 (82행)
│           ├── spinner.ts             ← ANSI 스피너 (58행)
│           ├── colors.ts              ← ANSI 컬러 유틸 (10행)
│           └── output.ts              ← 포매팅 (93행)
│       └── test/
│           ├── model-resolver.test.ts
│           └── phase10.test.ts        ← 루트 모드/목록 필터/레거시 차단 (12개)
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
| exec 기본 모델 | `claude-opus-4.6` → `MODEL_PLACEHOLDER_M26` |

---

## 빌드 & 테스트 명령

```bash
# SDK 빌드
cd packages/sdk && npm run build

# Extension 빌드
cd packages/extension && npm run build

# Auto-run hardening 테스트
cd packages/extension && npm run test:auto-run

# Extension .vsix 패키징
cd packages/extension && yes | npx @vscode/vsce package --no-dependencies

# 최신 생성 파일
# packages/extension/antigravity-bridge-extension-0.1.0.vsix

# CLI 실행 (빌드 없이 bun 직접 실행)
bun packages/cli/bin/antigravity-cli.ts <command>

# CLI 테스트
npm -w packages/cli test

# 현재 (Phase 10 1차 적용 후)
bun packages/cli/bin/antigravity-cli.ts "1+1은?" -m flash
bun packages/cli/bin/antigravity-cli.ts --async "분석해"
bun packages/cli/bin/antigravity-cli.ts "이어서" --resume <cascade-id>
bun packages/cli/bin/antigravity-cli.ts --resume

# 상태 확인
bun packages/cli/bin/antigravity-cli.ts server status

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
