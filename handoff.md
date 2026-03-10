# Handoff — 다음 세션 인수인계

> 마지막 업데이트: 2026-03-10 21:23 KST

## 현재 상태 요약

Bridge Extension + CLI 전체 기능 완성. **15개 API/CLI 명령 정상 작동**.
CLI 리팩토링 Phase 7-0, 7-1 **완료**. exec 전체 흐름 검증 완료.
Phase 8 auto-run fix **완료** — macOS/Windows 크로스플랫폼 패치 성공.
Phase 9 auto-run fix hardening **완료**.
Phase 10 **완료** — 루트 기본 모드, `--resume` 통합, 작업영역 fallback 제거, 현재 작업영역 목록 필터 적용, **LS 목록 격리 확인** (UI 전환 격리는 미검증).
Phase 10-6 **완료** — 백그라운드 UI 명시 반영 (`POST /api/ls/track/:id` + `UpdateConversationAnnotations` RPC) + RFC 3339 payload fix + `.vsix` 재설치 후 실환경 검증 완료. `setVisibleConversation` 예시 중립 교체.
CLI 테스트 **14/14 통과** (`npm -w packages/cli test`).
exec 모델 선택 검증 완료 — `claude-sonnet-4.6`, `gemini-3-flash` 실제 동작 확인.
**UI 등록 관찰 (이전 세션)** — `ls.createCascade()`만으로 IDE UI에 대화 자동 등록됨 (IDE 측 동작, SDK 명시 보장 아님).
**실환경 최종 검증 (2026-03-10 21:23 KST)** — issue-24에서 `antigravity-cli "테스트 중이니, 간단하게 응답해봐"` 성공 (`96ad40bf...`, `--resume` 목록 반영, 응답 본문 확인). 주인님 수동 검증으로 issue-18 작업영역 CWD에서도 절대경로 CLI 실행 성공 (`c07c7add...`, UI 반영 확인).

**다음 단계:**
- Phase 7 출력 포맷 개선
- Phase 8-2 SDK integration

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

- [x] **이전 관찰:** `ls.createCascade()`만으로 IDE UI에 대화가 자동 등록됨. 단, 이는 IDE 측 이벤트 감지이며 SDK 명시 보장이 아님. Phase 10-6에서 명시 호출 추가 결정
- [x] `exec "UI 등록 테스트" --no-wait` 실행 → 즉시 IDE UI에 대화 생성 확인
- [x] 모델 선택 검증: `claude-sonnet-4.6`, `gemini-3-flash` 둘 다 성공
- [x] 기존 "UI 등록 불가" 추론은 틀렸음 — 코드 추론보다 런타임 실험이 우선

**새로 발견된 문제: 작업영역 격리**
- issue-24에서 `exec`로 만든 대화가 issue-18 작업영역 창의 UI까지 바꿔버리는 현상 확인
- 원인: 현재 `focusCascade`/`setVisibleConversation` 등은 cascadeId만 받고 workspaceUri/windowId가 없음
- **현재 결론:** Phase 10 1차에서는 UI 제어를 구현하지 않고, 현재 작업영역 인스턴스 매칭 + 목록 필터만 먼저 해결
- [x] **현재 정책:** 외부 CLI 옵션으로 hidden/visible 모드는 두지 않고, 기본 동작은 현재 작업영역의 **백그라운드 UI 목록 등록**으로 유지

### Phase 10 설계 보정 — 유효한 비판 반영 (2026-03-10)

- [x] **UI 등록 경로 재확정:** 이전 관찰에서 `ls.createCascade()`만으로 IDE UI 자동 등록 확인 (IDE 측 이벤트 감지, SDK에는 annotation/track 호출 없음)
  - **Phase 10-6 결정:** 명시적 보장을 위해 `trackBackgroundConversationCreated`와 동일한 효과의 `lastUserViewTime` annotation 갱신을 추가. 구현 경로는 Extension `POST /api/ls/track/:id` + LS RPC 직접 호출 (경로 B)
  - `setVisibleConversation(cascadeId)`는 런타임에 존재하지만 foreground takeover이므로 **기본 경로에서 제외**
- [x] **2026-03-10 의미 보정(주인님 맥락):** `antigravity-cli`는 IDE 메인 세션을 대체하는 도구가 아니라, IDE 안에서 돌리는 **헤드리스 서브에이전트 호출 도구**로 취급한다
  - 따라서 CLI 호출 때마다 현재 IDE에서 보고 있던 메인 대화를 다른 대화로 **강제 전환하면 안 된다**
  - 새 대화는 메인 화면 전환이 아니라, **백그라운드 대화 목록/선택 UI에 등록**되는 쪽으로 해석한다
  - 이전 답변에서 나온 “visible = 현재 활성 대화로 전환” 해석은 **폐기**
  - 이후 문서/구현에서 `focus` 와 백그라운드 등록은 절대 같은 뜻으로 섞지 않는다
- [x] **백그라운드 등록 의미 고정:** 새 대화는 IDE가 그 대화를 **나중에 접근 가능한 상태로 목록/선택 UI에 등록**하는 뜻으로만 쓴다
  - 현재 보고 있는 메인 대화를 갈아끼우는 뜻이 아니다
  - 현재 보고 있는 대화를 바꾸는 동작은 `focus` 라는 별도 기능으로만 다룬다
- [x] **숨김 모드 제거:** `--hidden` 옵션과 hidden 강등(fallback) 정책은 제거
  - 이유: 현재 런타임에서 `ls.createCascade()`만으로 UI 자동 등록이 일어나므로, “headless 경로를 명시하면 hidden”이라는 약속을 지킬 수 없다
  - 따라서 외부 사용자에게는 기본 백그라운드 등록 동작만 노출하고, hidden은 구현/문서 정책에서 제외한다
- [x] **명령 역할 구분 고정:** `setVisibleConversation` 과 `trackBackgroundConversationCreated` 는 이름이 비슷해 보여도 역할이 다르다
  - `antigravity.setVisibleConversation`: 특정 대화를 **현재 IDE에서 보이는 대화로 전환**하는 성격의 명령이다. 효과는 foreground takeover 에 가깝기 때문에, 헤드리스 서브에이전트 기본 경로로 쓰면 안 된다
  - `antigravity.trackBackgroundConversationCreated`: `cascadeId`를 인자로 받아 `UpdateConversationAnnotations` RPC로 `lastUserViewTime`만 갱신하는 명령이다 (앱 번들 workbench.desktop.main.js에서 확인)
  - **정정 (2026-03-10 15:19):** 2026-03-10 포트 56526 런타임에서 두 명령 모두 `commands list --json`에 존재 확인. 이전 세션(포트 63065)에서 `setVisibleConversation`이 안 보인 원인은 미확정
  - Phase 10-6 기본 경로: `lastUserViewTime` annotation 명시 갱신. `setVisibleConversation`은 존재하지만 기본 경로에서 제외
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
| 10-5 | LS 목록 격리 실험 + `port-file.ts` 레이스 수정 | **완료** |
| 10-6 | 백그라운드 UI 명시 반영 (`trackBackgroundConversationCreated` 명시 호출) | **완료** |

**10-5 실험 결과 (2026-03-10 09:23 KST):**
- `ls.createCascade()`로 생성한 대화는 해당 LS 인스턴스(= 작업영역)의 `ls/list`에만 나타남 → **LS 목록 격리 확인**
- issue-24에서 만든 `955a6a83`이 issue-18의 `ls/list`에 나타나지 않음
- `port-file.ts`에 lockfile(`O_EXCL` + stale 검사) 추가 (best-effort 잠금, lock 실패 시 경고 후 등록 진행)
- ⚠️ **미검증:** `focusCascade` 등 UI 전환 명령이 다른 작업영역 창을 바꾸는지는 확인 안 됨

**10-6 실환경 최종 검증 (2026-03-10 21:23 KST):**
- 초기 구현의 `{ seconds, nanos }` payload는 LS가 `invalid_argument: unexpected token {`로 거부함
- 수정 커밋 `92cf508`에서 `lastUserViewTime`을 RFC 3339 ISO 문자열로 변경
- `.vsix` 재설치 후 issue-24에서 `antigravity-cli "테스트 중이니, 간단하게 응답해봐"` 실행 성공
  - 새 대화 `96ad40bf-e2cd-412b-9974-2350fa1e858f` 생성
  - `--resume` 목록 맨 위에 `96ad40bf  Testing Simple Response` 반영 확인
  - 대화 상세 조회에서 응답 본문 `테스트 확인됐습니다. 정상 동작 중이에요!` 확인
- 주인님 수동 검증: issue-18 작업영역 CWD에서 `/Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk/packages/cli/bin/antigravity-cli.ts "테스트중. 간 단응답해봐"` 실행 성공
  - 새 대화 `c07c7add...` 생성, `✓ 완료 (5 steps, 15.0s)` 출력, UI 반영 확인
- 결론: CLI 실행 파일 경로가 아니라 **현재 작업 디렉터리(workspace CWD)** 기준으로 Bridge 인스턴스를 선택하며, `create -> track -> 응답 완료 -> UI 반영` 흐름이 실환경에서 정상 동작함

### 미완료 리팩토링 (plan.md Phase 7 나머지)

| Phase | 대상 | 핵심 | 상태 |
|-------|------|------|------|
| 7 | `server status/prefs/diag/monitor` | 출력 포맷 개선 | ✅ |
| 7 | ~~`list`~~ | Phase 10에서 `--resume` 목록으로 대체 완료 | ✅ |
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
│   │   │           ├── ls.ts          ← LS API (create/send/track/focus/list/conversation)
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
│           │   ├── exec.ts            ← 루트 대화 실행 본체 + track 호출 (130행)
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
│           └── phase10.test.ts        ← 루트 모드/목록 필터/레거시 차단/track 검증 (14개)
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
