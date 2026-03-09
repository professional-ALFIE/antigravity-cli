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

## 현재 진행 상황 (2026-03-10)

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

### 2. CLI 커맨드 — claude/codex 패턴

```bash
antigravity-cli exec "메시지" --model flash       # 핵심
antigravity-cli list / focus <id>                  # 대화 관리
antigravity-cli accept / reject / run              # 스텝 제어
antigravity-cli status / prefs / diag              # 상태
antigravity-cli commands list / exec <cmd>         # 고급
```

### 3. 멀티 인스턴스: `~/.antigravity-cli/instances.json`

### 4. Models enum (SDK 내부)

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

- [x] 모델 매핑 추가 (flash/pro/pro-high/sonnet/opus/gpt)
- [x] 기본 모델: `opus` (1154)
- [x] `--help` codex 스타일 개선 (Examples, Models 섹션)

### Phase 6. 통합 테스트 ✅

- [x] `.vsix` 재설치 → exec 동작 확인 (cascadeId 반환)
- [x] exec --resume 이어서 전송 확인
- [x] 기존 13개 회귀 테스트 통과

### Phase 7. CLI 리팩토링 (다음 세션)

> **⚠️ 리팩토링 항목은 명령어 하나하나 주인님과 상의 후 진행한다.**
> handoff.md에 상세 Before/After 예시 포함

#### 7-0. 기반 작업 ✅
- [x] chalk 또는 ANSI 유틸 도입 → `src/colors.ts` (ANSI 직접, NO_COLOR 표준 지원)
- [x] 컬러 규칙: 성공(초록 ✓), 실패(빨강 ✗), 키(dim), cascade ID(시안)
- [x] `--no-color` 플래그 추가
- [x] 커맨드 파일 분리: `bin/antigravity-cli.ts` → 진입점(64행), `src/commands/*.ts`(11개 파일)
- [x] 공유 헬퍼: `src/helpers.ts` (getClient, isJsonMode, run)
- [x] 글로벌 설치: `package.json`에 `bin` 필드 이미 존재, 동작 확인 완료

#### 7-1. `exec` 응답 스트리밍 ✅ (Extension 재로드 후 최종 검증 필요)
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
- [ ] Extension 재로드 후 `getConversation` 응답 본문 출력 최종 검증

#### 7-2. `list` 리팩토링 (주인님 상의)
- [ ] JSON 덤프 → 정렬된 테이블 출력
- [ ] 컬럼: ID(앞 8자), TITLE(30자 말줄임), MODEL, CREATED(상대시간)
- [ ] 총 개수 표시

#### 7-3~7-6. `server` 서브커맨드 통합 ✅
- [x] status/prefs/diag/monitor/state 5개를 `server` 서브커맨드로 병합
- [x] `server reload` — IDE 원격 리로드 (commands/exec 경유)
- [x] `server restart` — 언어 서버 재시작 (commands/exec 경유)
- [x] 기존 5개 개별 파일(status.ts, prefs.ts, diag.ts, monitor.ts, state.ts) 삭제
- [x] 진입점 5개 import → 1개(server)로 교체
- [ ] `server status` 출력 포맷 개선 (JSON 덤프 → 요약)
- [ ] `server prefs` 출력 포맷 개선 (enum → 사람이 읽을 수 있는 이름)
- [ ] `server diag` 출력 포맷 개선
- [ ] `server monitor` 이벤트 타임스탬프/아이콘 개선

#### 7-7. 기타 명령 (주인님 상의)
- [x] `commands list` — 141개 명령어 한줄 설명 매핑 + cyan/dim 좌우 정렬 출력
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
- [x] `packages/extension/test/auto-run.test.ts` 추가 — 8개 fixture 기반 검증
- [x] `npm -w packages/extension run test:auto-run` 통과

---

### 빌드 & 설치

```bash
cd packages/extension
npm run build
npm run test:auto-run
npx -y @vscode/vsce package --no-dependencies
# → antigravity-bridge-extension-0.1.0.vsix
```

Antigravity IDE → `Cmd+Shift+P` → `Extensions: Install from VSIX...` → 파일 선택

### 확인

- StatusBar에 `Bridge :포트번호` 표시
- Output 패널 → "Antigravity Bridge" 채널에서 `[Bridge] LS fix: reconnected` 확인

### CLI 테스트

```bash
cd /Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk

bun packages/cli/bin/antigravity-cli.ts status
bun packages/cli/bin/antigravity-cli.ts list
bun packages/cli/bin/antigravity-cli.ts prefs
bun packages/cli/bin/antigravity-cli.ts exec "Hello" --model flash
bun packages/cli/bin/antigravity-cli.ts exec "1+1은?" --no-wait       # fire-and-forget
bun packages/cli/bin/antigravity-cli.ts exec "분석해" --idle-timeout 15000  # 응답 대기
```

### 트러블슈팅

| 증상 | 원인 | 대응 |
|------|------|------|
| StatusBar에 Bridge 안 나옴 | Extension activate 실패 | Output 패널 → "Antigravity Bridge" 에러 확인 |
| `ECONNREFUSED` | 서버 안 떠있음 | `cat ~/.antigravity-cli/instances.json` 확인 |
| SDK 초기화 에러 | 일반 VS Code에서 실행 | **Antigravity IDE**에서만 실행 |
| 403 Invalid CSRF | LS 프로세스 매칭 실패 | Extension 재시작 (Reload Window) |
