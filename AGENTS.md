---
trigger: always_on
---

path: /

## 최우선 조사 규칙

- Antigravity 번들/앱 코드를 조사할 때는 먼저 `ref/prettier-formatted/ANNOTATED_INDEX.md`를 읽어 이미 조사된 항목인지 확인한다.
- 원본 앱 포크는 `ref/antigravity-app/` 아래에 있다. 앱 번들 원본 근거가 필요할 때는 이 포크를 우선 본다.
- 대부분 필요한 런타임 근거는 `ref/antigravity-app/Contents/Resources/app/extensions/antigravity/` 아래에 있다.
- 조사 대상이 `extensions/antigravity/`, `extensions/antigravity/bin/`, `extensions/antigravity/dist/` 중 하나에 걸리면, 해당 디렉토리의 `AGENTS.md`를 먼저 읽어 어디를 봐야 하는지 확인한다.
- Antigravity의 배포 번들은 대부분 minified 상태라서 원본을 그대로 읽으면 함수 경계, 호출 흐름, 분기 구조를 놓치기 쉽다. 그래서 `ref/prettier-formatted/`에 없는 스크립트를 조사해야 할 때는 원본 번들을 바로 읽지 말고, 먼저 `ref/prettier-formatted/` 아래에 prettier로 정형화한 스크립트를 만든다.
- 조사/추적은 반드시 `ref/prettier-formatted/`의 정형화본에서 진행한다. 원본 번들은 최종 symbol, 호출 경로, storage key, 실제 파일 위치를 교차 검증할 때만 사용한다.
- 즉 조사 순서는 항상 `ref/prettier-formatted/ANNOTATED_INDEX.md 확인 → ref에 정형화본이 있으면 그것부터 읽기 → 없으면 원본을 prettier로 정형화해서 ref에 추가 → 정형화본에서 탐구 → 원본으로 교차 검증`이다.
- 정형화한 스크립트에는 새로 알게 된 사실을 `// antigravity-cli 구현용 주석:` 형식으로 즉시 기록한다.
- 조사 작업이 끝나면 `ref/prettier-formatted/ANNOTATED_INDEX.md`에 해당 스크립트의 새 주석 위치와 핵심 내용을 반드시 추가한다.
- 현재 이미 정형화되어 있는 기준 예시는 `ref/prettier-formatted/extension_formatted_latest.js`와 `ref/prettier-formatted/chat_formatted.js`다. 새 번들을 조사할 때도 같은 방식으로 `ref/prettier-formatted/`에 정형화본을 만든 뒤 그 파일을 기준으로 분석한다.

# Antigravity CLI Hybrid Flow

## 이 프로젝트가 하는 일

**하나의 CLI에서 두 proven path를 합친 하이브리드 CLI**다.

- **live path**: 이미 떠 있는 IDE의 LS에 직접 붙는다. UI 즉시 반영이 목표다.
- **offline path**: IDE 없이 LS를 직접 띄우고 fake extension server로 auth handoff, USS topic 구독, Extension Server 역할을 재현한다.
- **auth 멀티계정**: `agcl auth list` / `agcl auth login`으로 여러 Antigravity 계정을 관리하고, 활성 계정을 전환해서 대화한다.

```text
argv/config/model
  → auth subcommand 감지 → auth list / auth login
  → live LS 발견 시: direct attach
  → live LS 없으면: offline fallback (LS spawn)
```

### auth handoff란

Antigravity 앱의 main 프로세스가 OAuth 토큰을 획득한 뒤,
`state.vscdb`라는 로컬 DB에 저장하고, LS 시작 시 Extension Server가
`SubscribeToUnifiedStateSyncTopic` 구독을 통해 `uss-oauth`와
`uss-enterprisePreferences` topic bytes를 LS에 밀어 넣는 과정이다.
standalone으로 LS를 띄우면 이 과정이 없어서 `401 CREDENTIALS_MISSING`으로 실패한다.
offline path에서는 fake extension server가 이 역할을 대신한다. live attach path에서는 이미 떠 있는 IDE LS의 상태를 재사용한다.

### USS (Unified State Sync) topic이란

LS와 Extension 사이에서 상태를 동기화하는 메커니즘이다.
topic 이름(예: `uss-oauth`)으로 구독하면, 해당 상태 변경이 push된다.
현재 확인된 topic:

| Topic | 역할 | 필수 여부 |
| --- | --- | --- |
| `uss-oauth` | OAuth 토큰 전달 | 필수 (baseline auth) |
| `uss-enterprisePreferences` | 엔터프라이즈 설정 | 필수 (baseline auth) |
| `uss-browserPreferences` | 브라우저 설정 | cascade 이후 관찰됨 |
| `uss-agentPreferences` | 에이전트 설정 | cascade 이후 관찰됨 |
| `uss-overrideStore` | 오버라이드 저장소 | cascade 이후 관찰됨 |
| `uss-modelCredits` | 모델 크레딧 | cascade 이후 관찰됨 |

## 실행 전제 조건 (Prerequisites)

| 필수 요소 | 상태 | 경로 / 비고 |
| --- | --- | --- |
| Antigravity IDE.app (LS 바이너리, cert.pem, extension.js) | ✅ 확보 | `/Applications/Antigravity IDE.app` |
| `state.vscdb` (USS topic bytes 소스) | ✅ 확보 | `~/Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb` 또는 managed 계정의 user-data-dir 아래 |
| Bun | ✅ 필요 | shebang, `bun run`, `bun test`, `install.sh` 모두 Bun 전제 |

> **주의:** offline path는 IDE가 실행 중이면 별도 LS spawn과 충돌 여지가 있다.
> live attach는 **IDE가 이미 실행 중이고 해당 workspace의 live LS가 떠 있는 상태**를 전제로 한다.

## Runtime Path Split

Antigravity IDE runtime 경로와 CLI-owned 저장소는 분리한다.

```yaml
Antigravity IDE runtime:
  app bundle: /Applications/Antigravity IDE.app
  default user data: ~/Library/Application Support/Antigravity IDE
  LS app data dir: ~/.antigravity-ide
  LS discovery: ~/.gemini/antigravity-ide/daemon

CLI-owned storage:
  source: ~/.antigravity-cli/source
  accounts: ~/.antigravity-cli/accounts
  active auth: ~/.antigravity-cli/auth.json
  transcripts: ~/.antigravity-cli/projects
  quota cache: ~/.antigravity-cli/cache/quota
```

Rule: Antigravity IDE runtime 경로만 IDE 기준으로 바꾼다. `~/.antigravity-cli`는 CLI 저장소이므로 `antigravity-ide`로 바꾸지 않는다.

## 현재 제품 경로와 진행 상태

| 경로 | 현재 상태 | 핵심 동작 |
| --- | --- | --- |
| `live attach` | **검증됨** | `discoverLiveLanguageServer_func` → `handleLivePath_func` → direct RPC → UI 즉시 반영 |
| `offline fallback` | **검증됨** | `runOfflineSession_func` → fake extension server + LS spawn → create/resume/resume list, transcript/local tracking, `!background`일 때 surfaced post-processing |
| `auth 멀티계정` | **검증됨** | `agcl auth list`, `agcl auth login`, active account 선택 → 이후 chat flow의 `state.vscdb` 결정 |

## 핵심 데이터 흐름

```text
┌──────────────────────────────────────────────────────┐
│                    entrypoints/cli.ts                │
│                     → main.ts                        │
└──────────────────────────┬───────────────────────────┘
                           │
         detectRootCommand_func (auth 분기 감지)
                           │
                 ┌─────────┴─────────┐
                 │                   │
           auth command         chat command
           (list/login)             │
                              argv parse / config / model resolve
                                    │
                          discoverLiveLanguageServer_func
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                    handleLivePath_func   runOfflineSession_func
                          │                   │
                    직접 RPC          fakeExtensionServer + LS spawn
                          │                   │
                          └─────────┬─────────┘
                                    │
                        observeAndAppendSteps_func
                    (StreamAgentStateUpdates 트리거
                     → GetCascadeTrajectorySteps 원본)
                                    │
                  transcript append / local tracking / surfaced state
```

## Structure

### 루트 파일 구조

```
.
├── AGENTS.md
├── README.md
├── docs/
├── CHANGELOG.md
├── install.sh
├── package.json
├── bunfig.toml
├── handoff-plan-spec/
├── ref/
├── screenshots/
├── src/
└── tmp/
```

### 소스 디렉토리 구조

```
src/
├── entrypoints/
│   └── cli.ts                    — 실행 진입점 (package.json bin)
├── main.ts                       — 전체 오케스트레이션
├── main.test.ts                  — main.ts 오케스트레이션 회귀/통합 테스트
├── cli/                          — (예비 디렉토리, 현재 비어 있음)
├── constants/                    — (예비 디렉토리, 현재 비어 있음)
├── types/                        — (예비 디렉토리, 현재 비어 있음)
├── services/
│   ├── accounts.ts               — 멀티 계정 발견/활성화
│   ├── authList.ts               — auth list row/text 렌더링
│   ├── authLogin.ts              — auth login 플로우
│   ├── bundleRuntime.ts          — 앱 번들 schema 추출 (VM sandbox)
│   ├── connectRpc.ts             — ConnectRPC 통신 레이어
│   ├── fakeExtensionServer.ts    — LS 역방향 RPC 수신
│   ├── liveAttach.ts             — live LS 탐지 + attach
│   ├── observeStream.ts          — StreamAgentStateUpdates 파싱
│   └── stateVscdb.ts             — state.vscdb 읽기/쓰기
│   └── *.test.ts                 — 각 모듈별 테스트
└── utils/
    ├── config.ts                 — 경로/환경 설정
    ├── hash.ts                   — djb2 해시 (sanitizePath용)
    ├── makeMetadata.ts           — LS 시작 메타데이터 빌더
    ├── sessionStoragePortable.ts — 세션 디렉토리 관리 (Claude Code 호환)
    └── *.test.ts
```

### 공유 인프라 모듈

- `config.ts` — app paths, workspace root (process.cwd()), state.vscdb 경로, daemon dir. account-aware: `userDataDirPath` 옵션으로 managed 계정 경로 지원. `readIdeVersion_func`로 Antigravity IDE.app Info.plist에서 `ideVersion`을 동적 읽기.
- `makeMetadata.ts` — LS startup metadata builder; protobuf wire layout + redacted textproto.
- `stateVscdb.ts` — **1537줄**. USS topic bytes 추출, sidebar workspace 관리, trajectory summary hydration, user status/quota 파싱, 모델 선호도 추출. `StateDbReader` 클래스가 모든 DB 접근을 소유.
- `fakeExtensionServer.ts` — LS 역방향 RPC 수신. `PushUnifiedStateSyncUpdate`를 받으면 state.vscdb에 local hydration 수행 (trajectorySummaries + sidebarWorkspaces 보강).
- `connectRpc.ts` — **895줄**. Connect v1 protocol, unary/streaming RPC, protobuf request builder, discovery file 대기.
- `liveAttach.ts` — **516줄**. ps 기반 LS 프로세스 탐지, CSRF 추출, ConnectRPC port probe, live attach 진입 조건 판정.
- `bundleRuntime.ts` — `extension.js` VM-sandbox 로드, protobuf schema/client 추출. **regex 기반 부트스트랩 매칭.**
- `observeStream.ts` — `StreamAgentStateUpdates` parser; step overwrite + status history + `response ?? modifiedResponse` recovery.
- `sessionStoragePortable.ts` — Claude Code 호환 세션 디렉토리 관리. `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl`.
- `accounts.ts` — 계정 발견 (default + managed user-*), 활성 계정 persistence (`~/.antigravity-cli/auth.json`).
- `authList.ts` — auth list row/text 렌더링, quota progress bar, family (GEMINI/CLAUDE) 요약.
- `authLogin.ts` — browser Google OAuth callback flow. 기존 local IDE state.vscdb 계정 import 후, OAuth token/userinfo를 `~/.antigravity-cli/accounts/*.json`에 저장하고 active account를 전환한다.

### 현재 실행 진입점

- `entrypoints/cli.ts` — `antigravity-cli` (`agcl`) 실행 진입점. `main(argv)` 호출 + --json 에러 핸들링.
- `main.ts` — hybrid CLI 오케스트레이션 허브:
  - `detectRootCommand_func` (auth vs chat 분기)
  - `handleAuthCommand_func` + `interactiveAuthListSelect_func` (auth list/login + TTY selector)
  - `parseArgv_func` (--model, --json, --resume, --background 등)
  - `discoverLiveLanguageServer_func` → `handleLivePath_func` / `runOfflineSession_func`
  - `observeAndAppendSteps_func` (stream 트리거 → trajectory 재조회 → step append)
  - `trackConversationVisibility_func` + `hydrateSurfacedStateToStateDb_func` (`!background`일 때 surfaced post-processing)

## Where To Edit

| Task | Primary file | Also touch |
| --- | --- | --- |
| app path / workspace / output dir / env | `src/utils/config.ts` | `src/utils/config.test.ts` |
| metadata wire format | `src/utils/makeMetadata.ts` | `src/utils/makeMetadata.test.ts` |
| 세션 디렉토리 / transcript 경로 | `src/utils/sessionStoragePortable.ts` | `src/utils/sessionStoragePortable.test.ts` |
| live LS discovery / attach gate | `src/services/liveAttach.ts` | `src/services/liveAttach.test.ts` |
| USS topic additions / state.vscdb persist | `src/services/stateVscdb.ts` | `src/services/stateVscdb.test.ts`, `src/services/fakeExtensionServer.ts` |
| extension-side fake RPC behavior | `src/services/fakeExtensionServer.ts` | `src/services/fakeExtensionServer.test.ts` |
| protobuf request/response shape | `src/services/connectRpc.ts` | `src/services/connectRpc.test.ts`, `src/main.ts` |
| hybrid orchestration / live-offline 분기 | `src/main.ts` | `src/entrypoints/cli.ts`, service modules |
| bundle schema extraction | `src/services/bundleRuntime.ts` | `src/services/bundleRuntime.test.ts` |
| streamed-step parsing | `src/services/observeStream.ts` | `src/services/observeStream.test.ts`, `src/main.ts` |
| 멀티 계정 발견/활성화 | `src/services/accounts.ts` | `src/services/accounts.test.ts`, `src/main.ts` |
| auth list row/text 렌더링 | `src/services/authList.ts` | `src/services/authList.test.ts` |
| auth login 플로우 | `src/services/authLogin.ts` | `src/services/authLogin.test.ts` |
| auth list interactive selector | `src/main.ts` | `src/services/authList.ts`, `src/main.test.ts` |
| resume list 호환성 / workspace filter | `src/main.ts` | `src/main.test.ts` |
| 사용자 표면 문서 / 도움말 / 설치 | `README.md` | `docs/README.ko.md`, `install.sh`, `package.json`, `src/main.ts` |

---

## 모듈별 API 레퍼런스

### config.ts — 경로/환경 설정의 단일 소스

**핵심 export: `resolveHeadlessBackendConfig(options?)`**

```ts
interface HeadlessBackendConfig {
  repoRootPath: string;
  homeDirPath: string;
  envFilePath: string;
  env: HeadlessBackendEnv;
  appPath: string;                           // '/Applications/Antigravity IDE.app'
  extensionRootPath: string;
  distPath: string;
  binPath: string;
  languageServerPath: string;
  certPath: string;
  extensionVersion: string;
  ideVersion: string;                        // Info.plist CFBundleVersion 동적 읽기
  workspaceRootPath: string;                 // process.cwd() 고정
  workspaceRootUri: string;
  workspaceId: string;
  globalStorageDirPath: string;              // {userDataDirPath}/User/globalStorage
  stateDbPath: string;                       // globalStorageDirPath/state.vscdb
  daemonDirPath: string;                     // ~/.gemini/antigravity-ide/daemon
  outputDirPath: string;
}
```

- `userDataDirPath` 옵션으로 managed 계정 경로를 지정할 수 있다. 미지정 시 `~/Library/Application Support/Antigravity IDE` fallback.
- workspace는 항상 `process.cwd()` 고정 (`.env`의 `ANTIGRAVITY_WORKSPACE_ROOT_PATH`는 무시).
- `AppVariant` 개념은 제거됨. Antigravity IDE.app 하나만 지원.
- `profileDirPath`: `@deprecated` alias. `globalStorageDirPath`와 동일한 경로를 가리킨다. 신규 코드에서는 `globalStorageDirPath`를 사용한다.

### makeMetadata.ts — LS 스타트업 메타데이터

**protobuf wire layout (field 번호 → 의미):**

| Field # | Type | 내용 |
| --- | --- | --- |
| 1 | string | ideName (`"antigravity"`) |
| 2 | string | extensionVersion |
| 3 | string | apiKey (OAuth access token) |
| 4 | string | locale (`"ko"`) |
| 5 | string | os (`"mac"`) |
| 7 | string | ideVersion |
| 8 | string | hardware (`process.arch`) |
| 10 | string | sessionId (UUID) |
| 12 | string | extensionName (`"antigravity"`) |
| 17 | string | extensionPath |
| 25 | string | triggerId (UUID) |
| 27 | string | id (UUID) |
| 29 | string | userTierId (기본 빈 문자열) |

### stateVscdb.ts — USS topic bytes + DB 읽기/쓰기

**핵심 export:**

```ts
class StateDbReader {
  constructor(dbPath: string);
  async getTopicBytes(topicName: TopicName): Promise<Buffer>;
  async getBase64Value(storageKey: string): Promise<string | null>;
  async extractOAuthAccessToken(): Promise<string | null>;
  async extractUserStatusSummary_func(): Promise<UserStatusSummary | null>;
  async extractLastSelectedModelEnum(): Promise<number | null>;
  async createSidebarWorkspaceTopicRowAtomicUpsert_func(workspaceUri: string): Promise<TopicRowValueAtomicUpsert | null>;
  async upsertTopicRowValuesAtomic(rows: TopicRowValueAtomicUpsert[]): Promise<void>;
  async applyUnifiedStateUpdateRequestBytes(body: Buffer): Promise<UnifiedStateUpdateRequestLike>;
  async close(): Promise<void>;
}
```

**topic → DB storage key 매핑:**

| topic | DB storage key |
| --- | --- |
| `uss-oauth` | `antigravityUnifiedStateSync.oauthToken` |
| `uss-enterprisePreferences` | `antigravityUnifiedStateSync.enterprisePreferences` |
| `uss-userStatus` | `antigravityUnifiedStateSync.userStatus` |
| `uss-browserPreferences` | `antigravityUnifiedStateSync.browserPreferences` |
| `uss-agentPreferences` | `antigravityUnifiedStateSync.agentPreferences` |
| `uss-overrideStore` | `antigravityUnifiedStateSync.overrideStore` |
| `uss-modelCredits` | `antigravityUnifiedStateSync.modelCredits` |
| `uss-modelPreferences` | `antigravityUnifiedStateSync.modelPreferences` |
| `trajectorySummaries` | `antigravityUnifiedStateSync.trajectorySummaries` |
| `sidebarWorkspaces` | `antigravityUnifiedStateSync.sidebarWorkspaces` |
| `uss-windowPreferences` | `antigravityUnifiedStateSync.windowPreferences` |
| `uss-theme` | `antigravityUnifiedStateSync.theme` |
| `uss-editorPreferences` | `antigravityUnifiedStateSync.editorPreferences` |
| `uss-tabPreferences` | `antigravityUnifiedStateSync.tabPreferences` |
| (기타) | `antigravityUnifiedStateSync.*` 패턴 |

### fakeExtensionServer.ts — LS 역방향 RPC 수신

**핵심 export: `class FakeExtensionServer`**

```ts
class FakeExtensionServer {
  constructor(options: { stateDbPath: string; workspaceRootUri?: string });
  async start(): Promise<void>;
  async stop(): Promise<void>;
  get port(): number;
  get requests(): FakeExtensionServerRequest[];
}
```

**처리하는 RPC 경로와 응답 방식:**

| 요청 경로 | 처리 방식 |
| --- | --- |
| `*/SubscribeToUnifiedStateSyncTopic` | topic bytes 조회 → USS envelope 응답 (long-lived stream) |
| `*/LanguageServerStarted` | 빈 성공 응답 |
| `*/Heartbeat` | 빈 성공 응답 |
| `*/CheckTerminalShellSupport` | 하드코딩된 성공 응답 (zsh) |
| `*/PushUnifiedStateSyncUpdate` | **state.vscdb에 local hydration** (trajectorySummaries + sidebarWorkspaces 보강) |
| `*/GetChromeDevtoolsMcpUrl` | 빈 성공 응답 |

### connectRpc.ts — ConnectRPC 통신 레이어

**Connect protocol 상세:**

| 항목 | 값 |
| --- | --- |
| Content-Type (JSON unary) | `application/json` |
| Content-Type (Proto unary) | `application/proto` |
| Content-Type (Proto stream) | `application/connect+proto` |
| CSRF header | `x-codeium-csrf-token: <discovery.csrfToken>` |
| Streaming frame 형식 | 5-byte envelope: `[flags(1)] [length(4 big-endian)] [data(length)]` |

**주요 protobuf request builder:**

| Builder | 용도 |
| --- | --- |
| `buildStartCascadeRequestProto` | 새 대화 시작 |
| `buildSendUserCascadeMessageRequestProto` | 메시지 전송 |
| `buildSendAllQueuedMessagesRequestProto` | queued 메시지 flush |
| `buildSignalExecutableIdleRequestProto` | executor idle 신호 |
| `buildStartChatClientRequestStreamRequestProto` | chat client stream 시작 |

### bundleRuntime.ts — 앱 번들 schema 추출

`extension.js` (webpack 번들)에서 protobuf schema를 직접 추출한다.

**부트스트랩 매칭:** regex 기반 (`BUNDLE_BOOTSTRAP_REGEX_var`)

```ts
const BUNDLE_BOOTSTRAP_REGEX_var = /var ([a-z])=o\(o\.s=(\d+)\),([a-z])=exports;/;
```

> webpack minifier가 빌드마다 변수명을 뒤바꿀 수 있으므로 regex로 매칭한다.

**고정 모듈 ID (앱 업데이트 시 바뀌면 즉시 깨진다):**

| 모듈 ID | 내용물 | export 이름 |
| --- | --- | --- |
| `20217` | protobuf `create()` / `toBinary()` / `fromBinary()` | `create`, `toBinary`, `fromBinary` |
| `62573` | ConnectRPC `createClient()` | `createClient` |
| `30495` | ConnectRPC `createConnectTransport()` | `createConnectTransport` |
| `29076` | LanguageServerService 정의 | `LanguageServerService` |
| `17028` | Jetski schemas | `StreamAgentStateUpdatesRequestSchema`, etc. |

### observeStream.ts — StreamAgentStateUpdates 파싱

**핵심 export:**

| 함수 | 역할 |
| --- | --- |
| `createObservedConversationState_func()` | 빈 상태 생성 |
| `applyAgentStateUpdate_func(state, update)` | step overwrite + status history |
| `recoverObservedResponseText_func(state)` | `response ?? modifiedResponse` 복구 |
| `hasIdleRunningIdleTransition_func(state)` | IDLE → RUNNING → IDLE 전이 판정 |
| `collectAgentStateStream_func(options)` | 전체 스트림 수집 (isDone 조건까지) |

### liveAttach.ts — live LS 탐지

**핵심 export:**

| 함수 | 역할 |
| --- | --- |
| `discoverLiveLanguageServer_func(workspacePath, config)` | live LS 발견 시 `LiveLsConnection` 반환, 없으면 null |
| `findRunningAntigravityApps_func(appPath)` | 실행 중인 Antigravity 앱 정보 목록 |
| `findLiveLanguageServerProcess_func(workspacePath)` | ps 기반 LS 프로세스 탐지 |
| `findWorkingConnectRpcPort_func(candidates, certPath)` | 실제 응답하는 포트 probe |

### accounts.ts — 멀티 계정 관리

```ts
interface AccountInfo {
  name: string;              // "default" 또는 "user-01" 등
  userDataDirPath: string;   // Antigravity --user-data-dir 인자용 경로
}
```

| 함수 | 역할 |
| --- | --- |
| `discoverAccounts_func(options)` | default + managed (`~/.antigravity-cli/user-data/user-*`) 계정 발견 |
| `getActiveAccountName_func(options)` | `~/.antigravity-cli/auth.json`에서 활성 계정 이름 읽기 |
| `setActiveAccountName_func(options)` | 활성 계정 이름 쓰기 |
| `getNextManagedAccountName_func(accounts)` | hole-fill 방식으로 다음 managed 계정 이름 결정 |
| `getStateDbPath_func(options)` | 계정별 `state.vscdb` 경로 계산 |
| `getDefaultCliDir_func()` | `~/.antigravity-cli` 반환 |
| `getDefaultDataDir_func()` | `~/Library/Application Support/Antigravity IDE` 반환 |

### authLogin.ts — auth login 플로우

```ts
type AuthLoginResult =
  | { status: 'success'; accountName: string }
  | { status: 'timeout'; accountName: string }
  | { status: 'cancelled'; accountName: string }
  | { status: 'open_failed'; accountName: string; message: string };
```

1. `discoverAccounts → getNextManagedAccountName` → next account label 계산
2. `importLocalFromStateDb_func`: Antigravity IDE `state.vscdb`에서 기존 계정 import 시도
3. local OAuth callback server 시작
4. browser Google OAuth URL open
5. callback code 수신 → token exchange → userinfo fetch
6. `upsertAccount_func`: `~/.antigravity-cli/accounts/*.json` 저장
7. fingerprint baseline/profile 생성
8. `setCurrentAccountId_func` → active 전환

### sessionStoragePortable.ts — 세션 디렉토리 관리

Claude Code의 `src/utils/sessionStoragePortable.ts`에서 필요한 축만 이식.

- `sanitizePath(name)` — 경로 → 안전한 디렉토리명 (200자 초과 시 djb2 hash suffix)
- `getProjectsDir()` — `~/.antigravity-cli/projects/`
- `getProjectDir(projectDir)` — `~/.antigravity-cli/projects/<sanitized>/`
- `getTranscriptPath(projectDir, cascadeId)` — `<projectDir>/<cascadeId>.jsonl`
- `ensureProjectDir(projectDir)` — 디렉토리 생성 보장

---

## main.ts 실행 흐름 상세

### main() 오케스트레이션

```text
1. detectRootCommand_func: auth vs chat 분기
   → auth: handleAuthCommand_func (list/login)
   → chat: 아래 계속

2. parseArgv_func: --model, --json, --resume, --background, --timeout-ms
3. active account → config 로드 (managed 계정이면 userDataDirPath 지정)
4. model alias 해석 (IDE last-used model fallback)
5. stdin prompt 해석 (pipe 자동감지, "-" 마커)
6. 미구현 표면 차단 (server/commands/agent/--async)
7. discoverLiveLanguageServer_func
   → found: handleLivePath_func
   → not found: runOfflineSession_func
```

### handleLivePath_func

live LS에 직접 RPC로 대화 진행. FakeExtensionServer, LS spawn, USS topic wait 모두 건너뜀.

```text
분기:
  - resume list (read-only) → handleResumeList_func
  - resume send → handleLiveResumeSend_func
  - new conversation → handleLiveNewConversation_func

세부 흐름:
  - new conversation → StartCascade → SendUserCascadeMessage → [queued] → observeAndAppendSteps_func
  - resume send → SendUserCascadeMessage → [queued] → observeAndAppendSteps_func
  - resume list → GetAllCascadeTrajectories 기반 read-only 경로
  - `!background`이면 `trackConversationVisibility_func`는 시도하지만
    ❌ state.vscdb hydration 없음 (IDE가 소유)
```

### runOfflineSession_func

자체 LS를 띄워서 전체 흐름 수행.

```text
5. metadata 생성 (state.vscdb에서 OAuth token 추출)
6. FakeExtensionServer 시작
7. LS spawn (metadata → stdin)
8. discovery file 대기 (offline bootstrap timeout)
9. USS topic 구독 대기 (uss-oauth, uss-enterprisePreferences)
10. StartChatClientRequestStream (retry 1회 포함)
11. 실행 분기: resume list / resume send / new conversation
12. new/resume send에서만 관찰 루프 실행
13. `!background`일 때만
    - `trackConversationVisibility_func`
    - `hydrateSurfacedStateToStateDb_func`
    를 수행
14. cleanup: fake server stop → LS SIGTERM → SIGKILL
```

### LS 스폰 시 전달되는 CLI 인자 (L219~238)

```bash
language_server_macos_arm \
  --enable_lsp \
  --csrf_token=<UUID> \
  --extension_server_port=<fake server port> \
  --extension_server_csrf_token=<UUID> \
  --persistent_mode \
  --workspace_id=<config.workspaceId> \
  --app_data_dir antigravity-ide \
  --http_server_port=0 \
  --https_server_port=0 \
  --cloud_code_endpoint=https://cloudcode-pa.googleapis.com
```

### observeAndAppendSteps_func

**핵심 관찰 루프:**

```text
1. bundle 로드 → LS client 생성
2. StreamAgentStateUpdates 구독
3. for-await 루프:
   - 매 update마다 applyAgentStateUpdate_func (상태 갱신)
   - shouldFetchStepsForUpdate_func → GetCascadeTrajectorySteps 재조회
   - collectFetchedStepEvents_func → transcript append (pending tail 보류)
   - 종료 조건:
     a) IDLE → RUNNING → IDLE 전이
     b) status=IDLE + plannerResponse step 존재
4. 최종 재조회 + pending tail flush
5. recoverObservedResponseText_func fallback
```

**설계 원칙:**
- StreamAgentStateUpdates는 **트리거**로만 쓴다
- GetCascadeTrajectorySteps가 **진실 원본**이다
- fetch 시점의 마지막 step 1개는 항상 **pending tail**로 보류한다
- Response recovery는 항상 `response ?? modifiedResponse`

---

## 핵심 RPC 표면

### Extension → LS (CLI가 호출하는 RPC)

| RPC | 용도 | 경로 |
| --- | --- | --- |
| `StartCascade` | 새 대화 시작 | live + offline |
| `SendUserCascadeMessage` | 메시지 전송 | live + offline |
| `SendAllQueuedMessages` | queued 메시지 flush | live + offline |
| `GetCascadeTrajectory` | 대화 상태 확인 | live + offline |
| `GetCascadeTrajectorySteps` | step 원본 조회 | live + offline |
| `GetAllCascadeTrajectories` | resume list용 | live + offline |
| `UpdateConversationAnnotations` | UI surfaced 후처리 | live + offline |
| `StartChatClientRequestStream` | chat client stream 시작 | offline only |
| `StreamAgentStateUpdates` | 실시간 state 구독 | live + offline |
| `GetUserStatus` | ConnectRPC 포트 probe (live LS 탐지) | liveAttach.ts 내부 |
| `SignalExecutableIdle` | executor idle 신호 (현재 미사용, reserved) | — |

### LS → Extension (fake server가 수신하는 RPC)

| RPC | 용도 |
| --- | --- |
| `LanguageServerStarted` | LS 시작 완료 알림 |
| `SubscribeToUnifiedStateSyncTopic` | USS topic 구독 (long-lived stream) |
| `Heartbeat` | 연결 유지 |
| `CheckTerminalShellSupport` | 터미널 셸 지원 확인 |
| `PushUnifiedStateSyncUpdate` | USS 상태 업데이트 → local hydration |
| `GetChromeDevtoolsMcpUrl` | Chrome DevTools MCP URL |

## 고정 상수

| 이름 | 값 | 의미 |
| --- | --- | --- |
| `CASCADE_CLIENT` | `1` | cascade source enum |
| `CHAT_CLIENT_TYPE_IDE` | `1` | 클라이언트 타입 |
| `MESSAGE_ORIGIN_SDK_EXECUTABLE` | `2` | 메시지 출처 |
| `CASCADE_RUN_STATUS_IDLE` | `1` | IDLE 상태 enum |
| `CLIENT_TRAJECTORY_VERBOSITY_PROD_UI` | `2` | steps 조회 verbosity |
| `DEFAULT_MODEL_ENUM` | `1026` | `claude-opus-4.6` (기본 모델) |

### 모델 alias 테이블

| alias | enum |
| --- | --- |
| `claude-opus-4.6` / `opus` | 1026 |
| `claude-sonnet-4.6` / `sonnet` | 1035 |
| `gemini-3.1-pro-high` / `pro-high` | 1037 |
| `gemini-3.1-pro` / `pro` | 1036 |
| `gemini-3-flash` / `flash` | 1018 |

## Local Conventions

- Run TS with `bun run src/main.ts`; CLI 설치 후에는 `antigravity-cli` 또는 `agcl`.
- Keep ESM import style with `./file.js`, not `./file.ts`.
- Match current naming style: helper functions end with `_func`, local variables with `_var`.
- Preserve real Antigravity RPC/topic names verbatim.
- When an offline session uses `StartChatClientRequestStream`, start it before `StartCascade` / `SendUserCascadeMessage`.
- Response recovery rule is always `response ?? modifiedResponse`.
- When polling, use bounded waits and state checks. No "sleep and hope" gating.

## Hot Spots

- Largest blast radius: `main.ts` (모든 오케스트레이션), `connectRpc.ts`, `stateVscdb.ts`.
- `bundleRuntime.ts` survives by regex-patching bundle bootstrap; app bundle format drift will break this first.
- `observeAndAppendSteps_func`는 stream/fetch/append/pending-tail/stabilize 5단계 파이프라인이라 한 곳 건드리면 연쇄 영향.
- `fakeExtensionServer.ts`의 `PushUnifiedStateSyncUpdate` 핸들러는 offline later-open surfaced의 핵심 보강 지점.
- resume list 호환성 경계는 `extractTrajectorySummaryEntries_func` + `collectTrajectoryWorkspaceUris_func`다. `trajectorySummaries` vs `cascadeTrajectories` 응답 shape와 nested workspace URI 수집이 여기서 결정된다.

## Footguns

- Live path에서는 **절대 offline fallback하지 않는다**. mutating RPC(StartCascade, SendUserCascadeMessage) 실패를 offline으로 숨기면 이중 세션/이중 메시지 문제 발생.
- `queued:true`를 즉시 실패로 판단하지 말 것. `IDLE` 전이 후 `SendAllQueuedMessages`로 최종 반영되는 정상 경로.
- Missing `response` does not mean missing answer. check `modifiedResponse` before classifying failure.
- 번들 모듈 ID는 앱 업데이트 시 바뀔 수 있다. `bundleRuntime.ts`의 고정 ID 테이블이 가장 먼저 깨진다.
- `trackConversationVisibility_func`(UpdateConversationAnnotations)는 later-open surfaced 보장이 아니라 best-effort 보완.
- `hydrateSurfacedStateToStateDb_func`는 offline path 전용. live path에서는 IDE가 DB를 소유하므로 hydration하지 않는다.

## Commands

```bash
# 전체 테스트
bun test

# CLI help
bun run src/main.ts --help

# 새 대화
bun run src/main.ts "hello"

# 모델 지정
bun run src/main.ts -m flash "hello"

# 현재 workspace 세션 목록
bun run src/main.ts --resume

# 기존 세션 이어쓰기
bun run src/main.ts --resume <cascadeId> "continue"

# stdin pipe
echo "hello" | bun run src/main.ts

# auth 계정 목록
bun run src/main.ts auth list

# auth 새 계정 추가
bun run src/main.ts auth login
```

## Transcript / Local Tracking

`~/.antigravity-cli`는 CLI 전용 저장소다. Antigravity IDE LS runtime인 `~/.antigravity-ide` / `~/.gemini/antigravity-ide`와 분리한다.

| 경로 | 역할 |
| --- | --- |
| `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl` | step-by-step transcript (JSONL) |
| `~/.antigravity-cli/projects/<sanitized-cwd>/conversations.jsonl` | 로컬 대화 tracking (resume list fallback) |
| `~/.antigravity-cli/auth.json` | 활성 계정 이름 |
| `~/.antigravity-cli/user-data/user-*/` | managed 계정 user-data-dir |

## --json 모드 (JSON lifecycle events)

```json
{"type":"init","session_id":"...","cascadeId":"...","model":"...","cwd":"...","resume":false}
{"index":0,"step":{...}}
{"index":1,"step":{...}}
{"type":"done","session_id":"...","cascadeId":"...","exit_code":0}
```

에러 시:

```json
{"type":"error","session_id":null,"cascadeId":null,"message":"...","exit_code":1}
```

## 문서 체계 진입점

실사용 표면 계약은 `README.md`, `docs/README.ko.md`, `src/main.ts --help`, `install.sh`에 있다.
설계/결정 맥락은 `handoff-plan-spec/` 아래에 있다.

| 문서 | 역할 |
| --- | --- |
| `README.md` | 현재 영문 사용자 표면 계약 |
| `docs/README.ko.md` | 현재 한국어 사용자 표면 계약 |
| `install.sh` | 설치/업데이트 계약 + `agcl` alias 생성 |
| `handoff-plan-spec/v0.2.1-02-spec-opus.md` | v0.2.1 기술 사양 (Opus 버전, 최신) |
| `handoff-plan-spec/v0.2.1-02-spec-gpt.md` | v0.2.1 기술 사양 (GPT 버전) |
| `handoff-plan-spec/v0.2.1-02-handoff-gpt.md` | v0.2.1 핸드오프 문서 (GPT) |
| `handoff-plan-spec/v0.2.1-01-plan-gpt-5.4.md` | v0.2.1 구현 계획 (GPT 5.4) |
| `handoff-plan-spec/v0.2.1-01-investigation-cascadeModelConfigData.md` | cascade 모델 설정 데이터 조사 |
| `handoff-plan-spec/v0.2.1-01-investigation-cockpit-tools.md` | Cockpit Tools 심층 조사 |
| `handoff-plan-spec/cockpit조사-01-auth.md` | Cockpit Tools auth 아키텍처 조사 |
| `handoff-plan-spec/cockpit조사-02-ui.md` | Cockpit Tools UI 조사 |
| `handoff-plan-spec/cockpit조사-03-quota.md` | Cockpit Tools quota 조사 |
| `handoff-plan-spec/v0.2.0-01-investigation-sidebarWorkspaces-writeback.md` | surfaced/write-back 조사 |
| `handoff-plan-spec/brain-storming.md` | 아이디어 브레인스토밍 |
| `handoff-plan-spec/brain-storming 복사본.md` | 브레인스토밍 복사본 |
