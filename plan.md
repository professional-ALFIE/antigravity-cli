# Antigravity SDK Bridge — 통합 구현 계획

## 프로젝트 개요

antigravity-sdk를 **로컬 포크**하여, VS Code Extension(Bridge) + CLI(`antigravity-cli`) 를 하나의 모노레포에서 빌드·설치한다.

```
issue-24-antigravity-sdk/
├── packages/
│   ├── sdk/          ← antigravity-sdk 포크 (protobuf 수정)
│   ├── extension/    ← Bridge Extension (.vsix)
│   └── cli/          ← antigravity-cli (bun 직접 실행)
├── plan.md           ← 이 문서
├── handoff.md        ← 다음 세션 인수인계
└── package.json      ← npm workspaces
```

---

## 현재 진행 상황 (2026-03-10 16:05 KST)

### ✅ 완료

- [x] 모노레포 구조 (npm workspaces)
- [x] Extension 빌드/패키징 (.vsix)
- [x] CLI 전체 커맨드 구현 (exec, list, status, prefs, diag, commands, focus, accept, reject, run, monitor)
- [x] HTTP 서버 + REST API (8개 라우트: health, cascade, ls, commands, state, monitor, integration, auto-run)
- [x] SDK 생성자 버그 수정 (`new AntigravitySDK()` → `new AntigravitySDK(context)`)
- [x] LS Bridge CSRF 토큰 문제 해결 — `fixLsConnection()` lsof Phase 2
- [x] Phase 8: better-antigravity auto-run fix 통합 (macOS/Windows 크로스플랫폼)
- [x] CLAUDE.md 작업 규칙 추가 (추측 금지, 내부 용어 금지)
- [x] `commands list` — 141개 명령어 한줄 설명 + 좌우 정렬 출력
- [x] `server` 서브커맨드 통합 — status/prefs/diag/monitor/state + reload/restart 추가
- [x] `resume` 커맨드 — list+focus 통합 (resume = 목록, resume <id> = 전환)
- [x] `agent` 서브커맨드 — workflow (--global) / rule 생성 (IDE 소스 검증 완료)
- [x] `commands exec` API 버그 수정 — `executeCommand`→`execute` 메서드명 오류
- [x] Phase 9: auto-run fix 안정화 + hardening (세미콜론, 체크섬, 구문검증, hook 탐지, 상태 판정, rollback, 테스트)
- [x] exec 모델 선택 검증 완료 — `claude-sonnet-4.6`, `gemini-3-flash` 실제 동작 확인 (커밋 `9da8f01`)
- [x] UI 등록 정상 확인 — `ls.createCascade()`만으로 IDE UI에 대화 자동 등록됨 (별도 track 호출 불필요)
- [x] Phase 10 1차 완료 — CLI 루트 기본 모드 + `--resume` 통합 + 작업영역 fallback 제거 + 목록 필터링

### ✅ 테스트 통과 (13개)

| CLI 명령 / API | 결과 |
|----------------|------|
| `health` | uptime 반환 |
| `cascade/sessions` | 10+ 대화 목록 |
| `cascade/preferences` | 16개 에이전트 설정 |
| `cascade/diagnostics` | 시스템 정보, 유저, 로그 |
| `commands/list` | 140+ Antigravity 명령어 |
| `ls/list` | 전체 Cascade 대화 목록 (LS Bridge 경유) |
| `ls/user-status` | 유저 이름/이메일/플랜/모델 정보 |
| `list` | 대화 목록 출력 |
| `status` | 유저: 노승경, Pro 플랜, 6개 모델 |
| `prefs`, `prefs --json` | 설정 출력 |
| `commands list --json` | 명령어 JSON |
| `diag --json` | 진단 정보 JSON |

### ✅ 해결 완료: `exec` (createCascade)

- **원인:** SDK `_sendMessage()`의 protobuf-es oneof → ProtoJSON 미변환
- **해결:** `packages/sdk/src/transport/ls-bridge.ts` 수정 (로컬 포크)
- **결과:** cascadeId 정상 반환, 메시지 전송 성공

- **에러:** `neither PlanModel nor RequestedModel specified. You must specify a valid model.`
- **원인 (Codex 분석 확정):**
  - SDK `_sendMessage()`가 protobuf-es 내부 oneof 표현을 `JSON.stringify`로 그대로 직렬화
  - LS 서버는 **ProtoJSON 형식**을 기대 → oneof 그룹 이름(`chunk`, `choice`, `plannerTypeConfig`)이 아닌 **선택된 필드 이름**을 직접 키로 사용해야 함
  - `_rpc()`가 `toJson()` 변환 없이 raw 객체를 보내서 LS가 `requestedModel`을 인식 못함
- **Codex 분석 로그:** `/tmp/codex_analysis3.log` (JSONL, 완료)
- **참고 문서:** [ProtoJSON spec](https://protobuf.dev/programming-guides/json/), [Protobuf-ES manual](https://github.com/bufbuild/protobuf-es/blob/main/MANUAL.md)

현재 SDK가 보내는 payload vs LS가 기대하는 payload:

```diff
 // items
-{ "chunk": { "case": "text", "value": "메시지" } }
+{ "text": "메시지" }

 // plannerConfig
-"plannerTypeConfig": { "case": "conversational", "value": {} }
+"conversational": {}

 // requestedModel
-"choice": { "case": "model", "value": 1018 }
+"model": 1018
```

---

## 수정 이력

| # | 수정 내용 | 파일 |
|---|----------|------|
| 1 | `AntigravitySDK(context)` context 누락 수정 | `extension.ts` |
| 2 | `fixLsConnection()` Phase 1: workspace_id 변환 (`[^a-zA-Z0-9]` → `_`) | `extension.ts` |
| 3 | `fixLsConnection()` Phase 2: lsof → ConnectRPC 포트 탐색 (ext_port, lsp_port 제외) | `extension.ts` |
| 4 | 에러 응답에 실제 메시지 노출 | `http-server.ts` |

---

## 주요 설계 결정

### 1. 헤드리스 전용 — LSBridge가 핵심 경로

| 경로 | UI 의존 | CLI 사용 |
|------|---------|---------|
| `cascade.sendPrompt()` | ✅ 필요 | ❌ |
| `cascade.createBackgroundSession()` | ⚠️ 반쯤 | ❌ |
| **`ls.createCascade()`** | **❌ 무관** | **✅** |

> **확인 완료 (2026-03-10):** `ls.createCascade()`만으로 IDE UI에 대화가 자동 등록됨.
> 별도 `trackBackgroundConversationCreated` 호출 불필요.

### 2. CLI 커맨드 — exec를 루트 기본 모드로 승격

> **변경 결정 (2026-03-10):** `exec` 서브커맨드를 없애고, 루트 명령 자체가 기본 대화 모드.
> `resume`도 별도 서브커맨드가 아닌 `--resume` 옵션으로 통합.
> 이번 단계에서는 `--hidden`/visible UI 제어를 구현하지 않음.

```bash
# 핵심 (exec → 루트 기본 모드)
antigravity-cli "메시지"                           # 새 대화 생성
antigravity-cli --async "메시지"                   # 응답 대기 없이 즉시 종료
antigravity-cli "메시지" --model flash             # 모델 지정
antigravity-cli "메시지" --resume <uuid>           # 기존 대화에 이어쓰기
antigravity-cli --resume                           # 현재 작업영역 대화 목록 (uuid + 제목)

# 서브커맨드 (exec 아닌 기능은 그대로)
antigravity-cli server status                      # 서버 상태
antigravity-cli commands list / exec <cmd>         # 명령어
antigravity-cli agent workflow --global            # 에이전트
antigravity-cli auto-run status                    # auto-run
```

### 3. 이번 단계 UI 정책

| 항목 | 상태 |
|------|------|
| 새 대화 생성 / 이어쓰기 | 이번 단계 구현 |
| `--async` | 이번 단계 구현 |
| `--resume` 목록 / 이어쓰기 | 이번 단계 구현 |
| `--hidden` / visible UI 제어 | 후속 단계로 보류 |

> **보류 이유:** 현재 런타임에서 `antigravity.setVisibleConversation` 명령을 확인하지 못했고,
> `ls.ts`의 `create` 라우트도 현재는 headless 생성만 담당한다.

### 4. 멀티 인스턴스: `~/.antigravity-cli/instances.json`

### 5. Models enum (SDK 내부)

| 이름 | ID |
|------|----|
| GEMINI_FLASH | 1018 |
| GEMINI_PRO_LOW | 1164 |
| GEMINI_PRO_HIGH | 1165 |
| CLAUDE_SONNET | 1163 |
| CLAUDE_OPUS | 1154 |
| GPT_OSS | 342 |

---

## 다음 단계: SDK 포크 + exec 수정

### Phase 1. SDK 포크

- [x] `antigravity-sdk` GitHub 레포를 `packages/sdk/`로 clone
  ```bash
  cd packages && git clone https://github.com/Kanezal/antigravity-sdk.git sdk
  ```
- [x] `packages/sdk/package.json`의 `name`이 `antigravity-sdk`인지 확인
- [x] 루트 `package.json`의 workspaces에 `packages/sdk` 추가
- [x] `npm install`로 workspace 심볼릭 링크 확인

### Phase 2. Codex 분석 결과 반영 ✅

- [x] `/tmp/codex_analysis3.log`에서 최종 결론 확인
- [x] protobuf-es oneof → ProtoJSON 변환 방식 확정 → `{ model: 1018 }` 형태

### Phase 3. SDK `_sendMessage()` 수정 ✅

- [x] `packages/sdk/src/transport/ls-bridge.ts` 의 `_sendMessage()` 수정
  - [x] `items`: oneof → `[{ text: text }]`
  - [x] `requestedModel`: oneof → `{ model: 1018 }`
  - [x] `plannerTypeConfig`: oneof → `conversational: {}` plannerConfig 직속
- [x] SDK 빌드 확인

### Phase 4. Extension 의존성 변경 ✅

- [x] `packages/extension/package.json`에서 `antigravity-sdk` → `"*"` (workspace 링크)
- [x] Extension 재빌드
- [x] `.vsix` 패키징

### Phase 5. CLI 모델 이름→ID 매핑 ✅

- [x] exec 모델 체계 교체 (`claude-opus-4.6`, `claude-sonnet-4.6`, `gemini-3.1-pro-high`, `gemini-3.1-pro`, `gemini-3-flash`)
- [x] 기본 모델: `claude-opus-4.6` → `MODEL_PLACEHOLDER_M26`
- [x] `--help` codex 스타일 개선 (Examples, Models 섹션)

### Phase 6. 통합 테스트 ✅

- [x] `.vsix` 재설치 → exec 동작 확인 (cascadeId 반환)
- [x] exec --resume 이어서 전송 확인
- [x] 기존 13개 회귀 테스트 통과

### Phase 7. CLI 리팩토링

> **⚠️ 리팩토링 항목은 명령어 하나하나 주인님과 상의 후 진행한다.**
> handoff.md에 상세 Before/After 예시 포함

#### 7-0. 기반 작업 ✅
- [x] chalk 또는 ANSI 유틸 도입 → `src/colors.ts` (ANSI 직접, NO_COLOR 표준 지원)
- [x] 컬러 규칙: 성공(초록 ✓), 실패(빨강 ✗), 키(dim), cascade ID(시안)
- [x] `--no-color` 플래그 추가
- [x] 커맨드 파일 분리: `bin/antigravity-cli.ts` → 진입점(64행), `src/commands/*.ts`(11개 파일)
- [x] 공유 헬퍼: `src/helpers.ts` (getClient, isJsonMode, run)
- [x] 글로벌 설치: `package.json`에 `bin` 필드 이미 존재, 동작 확인 완료

#### 7-1. `exec` 응답 스트리밍 ✅
- [x] Extension `ls.ts` — `GET /api/ls/conversation/:id` 라우트 추가
- [x] CLI `spinner.ts` — ANSI 스피너 유틸 (NO_COLOR 지원, 외부 의존성 없음)
- [x] CLI `client.ts` — `streamUntil()` 메서드 추가 (SSE + idle timeout 자동 종료)
- [x] CLI `exec.ts` — SSE 기반 응답 대기 + 완료 감지 + 응답 출력
  - cascade 생성 후 ID 즉시 출력 (`◉ Cascade 생성: f25ff6ab`)
  - SSE `stepCountChanged` 감시 → 스피너 (`⠋ AI 응답 대기 중... (step N)`)
  - idle timeout (기본 10초) 완료 감지 → `✓ 완료 (256 steps, 13.1s)`
  - `--no-wait`: 기존 fire-and-forget 유지
  - `--idle-timeout <ms>`: idle timeout 밀리초 설정
  - `-r, --resume <id>`: 기존 대화에 이어서 전송
- [x] `--no-wait` 모드 테스트 통과
- [x] 기본 모드 (응답 대기) 테스트 통과: 256 steps, 13.1s
- [x] 전체 흐름 검증 완료: `exec "2+2는?" -m flash` → 128 steps, 25s, 응답 본문 정상 출력
- [x] 모델 선택 검증 완료: `claude-sonnet-4.6`, `gemini-3-flash` 실제 동작 확인

#### 7-2~7-7. 서브커맨드 통합 ✅
- [x] `server` 서브커맨드 통합 (status/prefs/diag/monitor/state + reload/restart)
- [x] `resume` 서브커맨드 (list+focus 통합)
- [x] `commands list` — 141개 명령어 한줄 설명 + 좌우 정렬 출력
- [ ] `server status/prefs/diag/monitor` 출력 포맷 개선
- [ ] `list` JSON 덤프 → 정렬된 테이블 출력
- [ ] 나머지 명령의 출력 형태 개선

---

### Phase 8. better-antigravity 통합 ✅ (기본 전체 auto-accept)

> 출처: [Kanezal/better-antigravity](https://github.com/Kanezal/better-antigravity) — `/tmp/better-antigravity`에 클론 완료

**목표:** Extension 시작 시 Antigravity의 "Always Proceed" 정책이 **실제로 동작하도록** 자동 패치. CLI에서 수동 accept/reject 불필요.

#### 8-1. Auto-Run Fix (핵심) — 기본 ON ✅

- [x] `auto-run.ts` 통합 → Extension `src/` 하위로 복사 + 리팩토링
  - workbench JS에 누락된 `useEffect` 패치를 자동 적용
  - `onChange` 핸들러에만 있던 EAGER 자동확인을 **마운트 시점에도** 실행
- [x] `getAppRoot()` + `discoverTargetFiles()` macOS/Windows 크로스플랫폼 지원
  - macOS workbench: `app/out/vs/workbench/workbench.desktop.main.js`
  - macOS jetski: `app/out/jetskiAgent/main.js`
  - Windows: `app/out/vs/code/electron-browser/workbench/` 하위
- [x] macOS 호환 regex — optional chaining(`?.`) + 비빈 dep array 매칭
- [x] Extension `activate()`에서 `autoApply()` 자동 실행 (silent, 프롬프트 없음)
- [x] `revertAll()` 기능 포함 (CLI/커맨드로 원본 복원 가능)
- [x] `.ba-backup` 파일로 원본 자동 백업

#### 8-2. SDK Integration (Chat Rename + Integrity Suppression) — 미착수

- [ ] `sdk.integration.enableTitleProxy()` — 대화 제목 커스텀 변경 지원
- [ ] `sdk.integration.installSeamless()` — 첫 설치 시 프롬프트 + 업데이트 시 자동 재로드
- [ ] `sdk.integration.enableAutoRepair()` — AG 업데이트 후 자동 재패치
- [ ] `sdk.integration.signalActive()` — 30초 하트비트 (렌더러 스크립트 유지)

#### 8-3. CLI 연동 ✅

- [x] `antigravity-cli auto-run status` — 패치 상태 확인
- [x] `antigravity-cli auto-run revert` — 원본 복원
- [x] `antigravity-cli auto-run apply` — 수동 패치 적용

---

### Phase 9. Auto-Run Fix 안정화 + Hardening ✅ (재시작 흰 화면 방지)

> 상세: `revise-plan-opus.md` 참조

**목표:** auto-run 패치 후 IDE 재시작 시 흰 화면이 뜨는 문제 해결.

#### 9-1. 패치 문자열 세미콜론 추가 ✅
- [x] 패치 문자열 앞뒤 `;` 추가 → 독립 JS 문장 보장
- [x] `[])return` 구문 오류 제거

#### 9-2. product.json 체크섬 갱신/복원 ✅
- [x] `updateChecksum()` — SHA-256 → base64, product.json 갱신
- [x] `restoreChecksum()` — 해당 키만 원본 복원 (partial revert 안전)
- [x] product.json 첫 패치 시 `.ba-backup` 백업

#### 9-3. 쓰기 전 구문 검증 ✅
- [x] `.ba-tmp` → `node --check` → rename 원자적 교체
- [x] 실패 시 원본 미수정 보장

#### 9-4. hook 탐지 로직 수정 ✅
- [x] `findUseEffect()` → `useEffect:(\w+)` dispatcher alias 직접 추출
- [x] useMemo 오탐지 문제 완전 해결 (workbench: xi→fn, jetski: Oe→At)

#### 9-5. 부수 수정 ✅
- [x] `extension.ts` 로깅 보강 (✓/✗ + detail)
- [x] `routes/auto-run.ts` `revertAll()` await 추가 (async 변경 반영)

#### 9-6. Hardening 후속 수정 ✅
- [x] `detectPatchStateFromContent()` — `unpatched | patched | patch-corrupted` 3단계 상태 판정 통합
- [x] marker-only / 중복 삽입 / 구조 불일치 → `patch-corrupted` 처리
- [x] `autoApply()` / `revertAll()` 순차 처리 → `product.json` 동시 쓰기 경쟁 제거
- [x] `product.json` 쓰기 원자화 (`.ba-tmp` + rename) + checksum 실패 시 JS 롤백
- [x] revert 시 checksum restore 실패하면 JS를 patched snapshot으로 롤백
- [x] `GET /api/auto-run/status` → `files[].state` 추가 (`patched` boolean 유지)
- [x] CLI `auto-run status` → `patched / not patched / corrupted` 3단계 출력
- [x] `packages/extension/test/auto-run.test.ts` 추가 — 9개 검증 (lock 대기 포함)
- [x] `npm -w packages/extension run test:auto-run` 통과
- [x] 최신 hardening 반영본 `.vsix` 재패키징 완료 — `packages/extension/antigravity-bridge-extension-0.1.0.vsix`
- [x] 최신 `.vsix` 재설치 후 실제 IDE에서 `workbench/jetskiAgent: already-patched` 확인
- [x] CLI 확인: `auto-run status` = 둘 다 `patched`
- [x] CLI 확인: `server prefs --json` 에서 `terminalExecutionPolicy: 3`, `secureModeEnabled: false`

---

### Phase 10. CLI 재설계 — exec 루트 승격 + 작업영역 격리 ✅ (1차)

> **결정 (2026-03-10 코덱스 대화):**
> 1. `exec` 서브커맨드를 제거하고 루트 명령 자체가 기본 대화 모드
> 2. `resume` 서브커맨드를 `--resume` 옵션으로 통합
> 3. 이번 단계에서는 `--hidden` / visible UI 제어를 구현하지 않음
> 4. 현재 작업영역 한정 동작은 `instances.json` 매칭 + `ls/list` 필터링으로 먼저 보장
> 5. 응답 대기 생략 플래그는 `--no-wait` 대신 `--async`
> 6. 루트 기본 모드는 `process.argv` 사전 분기 방식으로 구현

#### 10-0. UX 요구사항 고정
- [x] **대화1 반영:** A 작업영역(폴더)에서 실행한 명령은 A 작업영역 bridge 인스턴스에만 연결
- [x] **대화2 반영:** 대화 선택 목록은 `<uuid 앞 8자> + ls/list.summary`만 간단히 출력
- [x] **대화3 반영:** 이어쓰기는 위치 키워드 `resume` 이 아니라 `--resume` 옵션으로 통일
- [x] **추가 반영:** 응답 대기 생략은 `--async`로 통일 (`--no-wait`는 새 UX에서 제거)
- [x] **대화4 반영:** `antigravity-cli exec "..."`의 주 사용 흐름을 `antigravity-cli "..."`로 승격
- [x] **입력 규칙 고정:** 프롬프트/메시지는 반드시 `"..."` 로 감싸서 전달
- [x] **레거시 정리:** 기존 `exec`, `resume` 문법은 alias 없이 제거. `antigravity-cli exec "하이"` 는 오류로 처리
- [x] **레거시 정리:** `--no-wait`는 과거 구현/문서 기록으로만 남기고, 새 UX 문서와 예시에서는 `--async`만 사용
- [x] **정의 명확화:** 이 CLI의 기본 모드는 “헤드리스 대화 생성기”이며, `exec`는 별도 기능이 아니라 기본 동작
- [x] **이번 단계 범위:** `--hidden` / visible UI 제어는 이번 Phase 10에 포함하지 않음

#### 10-1. CLI 진입점 재설계
- [x] 루트 기본 동작 = 기존 exec (첫 토큰이 예약 서브커맨드가 아니면 메시지로 해석)
- [x] `process.argv.slice(2)` 사전 분기로 유지보수 서브커맨드를 먼저 분기
- [x] `antigravity-cli "메시지"` → 새 대화 생성
- [x] `antigravity-cli --async "메시지"` → 새 대화 생성 후 응답 대기 없이 즉시 종료
- [x] `antigravity-cli "메시지" --async` → 위와 동일 (옵션 위치 유연 허용)
- [x] `antigravity-cli "메시지" --resume <uuid>` → 기존 대화에 이어쓰기
- [x] `antigravity-cli --resume <uuid> "메시지"` → 위와 동일 (옵션 위치 유연 허용)
- [x] `antigravity-cli --resume` → 현재 작업영역의 이어갈 대화 목록 출력
- [x] `antigravity-cli --resume <uuid>` → 메시지가 필요하다는 명시적 오류 출력
- [x] `antigravity-cli exec ...` 입력 시 명시적 오류 출력
- [x] `antigravity-cli resume ...` 입력 시 명시적 오류 출력
- [x] 유지보수 서브커맨드는 `server`, `commands`, `agent`, `auto-run` + 기존 `accept`, `reject`, `run`, `ui`를 유지
- [x] `exec`, `resume`은 예약된 레거시 금지어로 처리하여 메시지로 해석하지 않음
- [x] 메시지는 단일 positional 인자로만 받으며, 공백 포함 메시지는 반드시 따옴표 사용

#### 10-2. 실행 경로 고정
- [x] `exec.ts`는 새 추상화 계층 없이 실행 함수만 export 하여 루트 기본 모드와 재사용
- [x] `exec` 서브커맨드 등록은 제거하고, 진입점에서 root/default 경로만 사용
- [x] `resume.ts`는 사용자-facing 금지어 오류를 진입점에서 처리한 뒤 제거
- [x] 새 대화 생성은 `POST /api/ls/create`만 사용 (`text`, `model`만 전달)
- [x] 기존 대화 이어쓰기는 `POST /api/ls/send/:id`만 사용
- [x] 이번 단계에서는 `ls.ts` `create` 라우트 수정 없음
- [x] 이번 단계에서는 `client.ts` 수정 없음
- [x] create/send 경로에서 `ls/focus`, `commands/exec`, UI 관련 command 호출 없음
- [x] `--no-wait` 옵션/도움말/예시는 제거하고 `--async`로 치환

#### 10-3. 현재 작업영역 판정과 목록 필터
- [x] 현재 작업영역 판정 기준은 `discoverInstance()`가 선택한 `instances.json`의 `workspace`
- [x] `discoverInstance()`는 `정확 일치 > 상위 경로 포함`까지만 허용
- [x] 현재 작업영역과 매칭되는 인스턴스가 없으면 첫 번째 항목으로 fallback 하지 않고 오류 처리
- [x] `--resume` 목록은 `ls/list` 1회 호출 결과만 사용
- [x] 목록 필터 1순위는 `workspaces[].workspaceFolderAbsoluteUri`
- [x] `workspaceFolderAbsoluteUri`가 없을 때만 `gitRootAbsoluteUri`를 보조 비교
- [x] 현재 작업영역과 일치하지 않거나 workspace 메타데이터가 없는 대화는 목록에서 제외
- [x] 일반 출력은 `lastModifiedTime` 내림차순, 동률이면 `createdTime` 내림차순 정렬
- [x] `--json --resume`은 기존 raw 구조를 유지하되, 현재 작업영역으로 필터된 항목만 남김

#### 10-4. `--resume` 대화 목록 포맷
- [x] 기본 포맷: `<uuid 앞 8자>  <summary>`
- [x] 제목 소스는 `ls/list` 응답의 `summary`를 그대로 사용
- [x] `summary`가 없으면 `(session)` 표시
- [x] 목록 목적은 “고를 수 있게만” 이므로 branch, 용량, 긴 preview, 복잡한 테이블은 기본값에서 제외
- [x] 필요 시 최근 수정 시각은 보조 정보로만 추가 (기본은 숨김 또는 dim 처리)
- [x] 첫줄 fallback 조회는 구현하지 않음 (추가 RPC 없이 최소 구현 유지)
- [x] `--json --resume`의 키 구조는 유지하고, 일반 출력만 단순화

#### 10-5. 이번 단계에서 하지 않는 것
- [x] `--hidden` 옵션 구현은 이번 단계에서 보류
- [x] visible UI 제어 보장은 이번 단계에서 보류
- [x] `ls.ts` `create` 라우트에 `visible` 파라미터 추가는 이번 단계에서 보류
- [x] `antigravity.setVisibleConversation` 의존 구현은 이번 단계에서 보류

---


### 빌드 & 설치

```bash
cd packages/extension
npm run build
npm run test:auto-run
npx -y @vscode/vsce package --no-dependencies
# → antigravity-bridge-extension-0.1.0.vsix
```

최신 패키징 확인:
- 2026-03-10 01:39 KST 기준 hardening 반영본 `.vsix` 재생성 완료
- 설치 대상: `packages/extension/antigravity-bridge-extension-0.1.0.vsix`
- 2026-03-10 02:02 KST 기준 재설치 후 정상 확인:
  - Extension Output: `workbench: ✓ already-patched`, `jetskiAgent: ✓ already-patched`
  - `bun packages/cli/bin/antigravity-cli.ts auto-run status` → 둘 다 `patched`
  - `bun packages/cli/bin/antigravity-cli.ts server prefs --json` → `terminalExecutionPolicy: 3`, `secureModeEnabled: false`

Antigravity IDE → `Cmd+Shift+P` → `Extensions: Install from VSIX...` → 파일 선택

### 확인

- StatusBar에 `Bridge :포트번호` 표시
- Output 패널 → "Antigravity Bridge" 채널에서 `[Bridge] LS fix: reconnected` 확인

### CLI 테스트

```bash
cd /Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk

# 현재 (Phase 10 적용 후)
bun packages/cli/bin/antigravity-cli.ts server status
bun packages/cli/bin/antigravity-cli.ts "Hello" --model flash
bun packages/cli/bin/antigravity-cli.ts --async "1+1은?"
bun packages/cli/bin/antigravity-cli.ts "분석해" --idle-timeout 15000
bun packages/cli/bin/antigravity-cli.ts "이어서" --resume <uuid>
bun packages/cli/bin/antigravity-cli.ts --resume
```

### 트러블슈팅

| 증상 | 원인 | 대응 |
|------|------|------|
| StatusBar에 Bridge 안 나옴 | Extension activate 실패 | Output 패널 → "Antigravity Bridge" 에러 확인 |
| `ECONNREFUSED` | 서버 안 떠있음 | `cat ~/.antigravity-cli/instances.json` 확인 |
| SDK 초기화 에러 | 일반 VS Code에서 실행 | **Antigravity IDE**에서만 실행 |
| 403 Invalid CSRF | LS 프로세스 매칭 실패 | Extension 재시작 (Reload Window) |
