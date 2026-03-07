---
trigger: always_on
---

# CLAUDE.md — Antigravity SDK Bridge 프로젝트

## 프로젝트 개요

`antigravity-sdk`를 사용하여 **VS Code 확장(Extension)**을 만들고, 그 확장 안에 **로컬 HTTP 서버**를 내장하여, **외부 CLI 도구**에서 antigravity-sdk의 모든 기능을 호출할 수 있게 하는 프로젝트.

### 왜 필요한가

VS Code 확장은 IDE 프로세스 안에서만 실행되므로, 외부 터미널이나 CI/CD 파이프라인에서 직접 호출할 수 없다.
이 프로젝트는 그 Gap을 메우기 위해 **확장 내부에 HTTP 서버를 내장**하고, 해당 서버와 통신하는 **CLI 도구**를 별도로 제공한다.

### 아키텍처

```
┌───────────────────────────────────────────────────────┐
│                  Antigravity IDE                       │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │         VS Code Extension (이 프로젝트)          │  │
│  │                                                 │  │
│  │  ┌───────────────┐    ┌──────────────────────┐  │  │
│  │  │ antigravity-sdk│───▶│  SDK API 호출        │  │  │
│  │  │  (npm 패키지)  │    │  (cascade, ls, etc.) │  │  │
│  │  └───────────────┘    └──────────────────────┘  │  │
│  │         ▲                                       │  │
│  │         │                                       │  │
│  │  ┌──────┴──────────────────────┐                │  │
│  │  │  내장 HTTP 서버              │                │  │
│  │  │  (127.0.0.1:PORT)           │                │  │
│  │  │  REST API 엔드포인트 제공    │                │  │
│  │  └──────▲──────────────────────┘                │  │
│  └─────────┼───────────────────────────────────────┘  │
│            │                                          │
└────────────┼──────────────────────────────────────────┘
             │ HTTP (localhost only)
┌────────────┼──────────────────────────────────────────────────┐
│  외부 CLI  │                                                    │
│  antigravity-cli  ▼                                             │
│  $ antigravity-cli cascade list                                 │
│  $ antigravity-cli cascade create --model flash --msg "분석해"   │
│  $ antigravity-cli cascade send <id> --msg "다음 단계"           │
│  $ antigravity-cli monitor status                               │
│  $ antigravity-cli prefs get                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## antigravity-sdk 소스 구조 (Kanezal/antigravity-sdk v1.6.0)

```
src/
├── index.ts                       # Public exports
├── sdk.ts                         # AntigravitySDK 메인 클래스
├── cascade/
│   ├── index.ts
│   └── cascade-manager.ts         # CascadeManager — 세션/대화 관리
├── core/
│   ├── index.ts
│   ├── disposable.ts              # Disposable 패턴
│   ├── errors.ts                  # 커스텀 에러 (AntigravityNotFoundError 등)
│   ├── events.ts                  # 이벤트 정의
│   ├── logger.ts                  # 내부 로거
│   └── types.ts                   # 모든 타입/인터페이스/enum 정의
├── integration/
│   └── integration-manager.ts     # IntegrationManager — Agent View UI 커스터마이징
└── transport/
    ├── index.ts
    ├── command-bridge.ts          # CommandBridge — vscode.commands 실행 (60+ 명령)
    ├── event-monitor.ts           # EventMonitor — USS/trajectory 폴링 기반 이벤트 감지
    ├── ls-bridge.ts               # LSBridge — Language Server 직접 통신 (headless cascade)
    └── state-bridge.ts            # StateBridge — state.vscdb 읽기 (sql.js, read-only)
```

---

## SDK가 제공하는 기능 (= HTTP API로 노출해야 할 기능 목록)

### 1. CascadeManager (`sdk.cascade`)

대화(세션) 관리 및 에이전트 스텝 제어.

| 메서드 | 설명 |
|--------|------|
| `getSessions()` | 모든 대화 목록 조회 (id, title, stepCount, timestamps) |
| `focusSession(id)` | 특정 대화로 전환 (UI 포커스) |
| `sendPrompt(text)` | 현재 활성 대화에 메시지 전송 |
| `createBackgroundSession(task)` | 백그라운드 대화 생성 (UI 전환 없음) |
| `getPreferences()` | 에이전트 설정 16개 읽기 (terminalExecutionPolicy, secureModeEnabled 등) |
| `getDiagnostics()` | 시스템 정보, 로그, recent trajectories 조회 |
| `acceptStep()` | 현재 대기 중인 코드 편집 수락 |
| `rejectStep()` | 현재 대기 중인 코드 편집 거부 |
| `acceptTerminalCommand()` | 터미널 명령 실행 수락 |
| `rejectTerminalCommand()` | 터미널 명령 실행 거부 |
| `runTerminalCommand()` | 대기 중인 터미널 명령 실행 |
| `acceptCommand()` | 비-터미널 액션 수락 |
| `getMcpUrl()` | MCP 서버 URL 조회 |
| `getBrowserPort()` | 브라우저 에이전트 포트 조회 |
| `isFileGitIgnored(path)` | 파일이 .gitignore에 포함되는지 확인 |
| `initialize()` | 매니저 초기화 |

### 2. LSBridge (`sdk.ls`)

Language Server와 직접 통신. UI 깜빡임 없이 백그라운드에서 Cascade 생성/관리.

| 메서드 | 설명 |
|--------|------|
| `createCascade({ text, model })` | 헤드리스 Cascade 생성 (모델 지정 가능) |
| `sendMessage({ cascadeId, text, model })` | 기존 Cascade에 메시지 전송 |
| `focusCascade(cascadeId)` | Cascade를 UI에 표시 |
| `listCascades()` | 모든 Cascade 목록 조회 |
| `getUserStatus()` | 유저 상태 조회 |
| `initialize()` | LS 포트/CSRF 토큰 자동 탐색 |
| `setConnection(port, csrfToken)` | 수동 연결 설정 |

**사용 가능 모델 (Models enum):**
- `Models.GEMINI_FLASH`
- `Models.GEMINI_PRO`
- `Models.GEMINI_PRO_HIGH`
- (기타 SDK에서 정의된 모델)

### 3. EventMonitor (`sdk.monitor`)

실시간 이벤트 감지 (폴링 기반).

| 메서드 | 설명 |
|--------|------|
| `onStepCountChanged(callback)` | 에이전트 스텝 수 변경 감지 |
| `onActiveSessionChanged(callback)` | 활성 세션 전환 감지 |
| `onNewConversation(callback)` | 새 대화 생성 감지 |
| `onStateChanged(callback)` | USS 상태 변경 감지 (설정 등) |
| `start(ussPollMs, trajectoryPollMs)` | 모니터링 시작 |
| `stop()` | 모니터링 중지 |

### 4. CommandBridge (`sdk.commands`)

Antigravity 내부 명령어 실행 (60+ verified commands).

| 메서드 | 설명 |
|--------|------|
| `getAntigravityCommands()` | 등록된 Antigravity 명령 목록 조회 |
| `executeCommand(cmd, ...args)` | 명령어 실행 |

### 5. StateBridge (`sdk.state`)

USS(state.vscdb) read-only 접근.

| 메서드 | 설명 |
|--------|------|
| `initialize()` | sql.js로 state.vscdb 열기 |
| `get(key)` | 특정 키 값 읽기 |
| `getAll()` | 전체 상태 덤프 |

> ⚠️ SENSITIVE_KEYS 블록리스트에 의해 oauthToken, agentManagerInitState 등 인증 관련 키는 접근 차단됨.

### 6. IntegrationManager (`sdk.integration`)

Agent View 패널에 커스텀 UI 요소 삽입 (9개 integration point).

| 메서드 | 설명 |
|--------|------|
| `addTopBarButton(id, icon, tooltip, popup)` | 상단 바 버튼 추가 |
| `addInputButton(id, icon, tooltip)` | 입력 영역 버튼 추가 |
| `addTurnMetadata(id, fields)` | 턴별 메타데이터 표시 |
| `addUserBadges(id, type)` | 유저 메시지 뱃지 추가 |
| `addBotAction(id, icon, label)` | 봇 응답 액션 버튼 추가 |
| `addDropdownItem(id, label, icon)` | 드롭다운 메뉴 항목 추가 |
| `addTitleInteraction(id, event, label)` | 타이틀 인터랙션 추가 |
| `install()` | 등록한 UI 요소들 설치 |
| `enableAutoRepair()` | Antigravity 업데이트 시 자동 복구 |
| `signalActive()` | 하트비트 갱신 (확장 활성 표시) |

---

## 핵심 타입 정의 (`src/core/types.ts`)

### Enums

```typescript
enum TerminalExecutionPolicy { OFF = 1, AUTO = 2, EAGER = 3 }
enum ArtifactReviewPolicy { ALWAYS = 1, TURBO = 2, AUTO = 3 }
enum CortexStepType {
  RunCommand, WriteToFile, ViewFile, ViewFileOutline, ViewCodeItem,
  SearchWeb, ReadUrlContent, OpenBrowserUrl, ReadBrowserPage,
  ListBrowserPages, ListDirectory, FindByName, CodebaseSearch,
  GrepSearch, SendCommandInput, ReadTerminal, ShellExec, McpTool,
  InvokeSubagent, Memory, KnowledgeGeneration, UserInput,
  SystemMessage, PlannerResponse, Wait, ProposeCode, WriteCascadeEdit
}
enum StepStatus { Running, Completed, Failed, WaitingForUser, Cancelled }
enum TrajectoryType { Chat = 'chat', Cascade = 'cascade' }
```

### 주요 인터페이스

- `ISessionInfo` — 세션 정보 (id, title, createdAt, lastActiveAt, type, isActive, tags)
- `ICortexStep` — 단일 스텝 (id, index, type, status, summary, data, metadata)
- `IStepMetadata` — 스텝 메타 (inputTokens, outputTokens, model, autoApproved)
- `IChatMessage` — 채팅 메시지 (role, content, id, createdAt)
- `IAgentPreferences` — 에이전트 설정 16개 전체
- `IContextInfo` / `ITokenBreakdown` — 컨텍스트 윈도우 사용량
- `IModelConfig` — 모델 설정 (id, name, isActive, maxContextTokens)
- `ICreateSessionOptions` — 세션 생성 옵션 (task, background, model)
- `IAgentState` — 에이전트 상태 (isEnabled, isProcessing, activeCascadeId, currentModel)
- `IDiagnosticsInfo` — 진단 정보 (isRemote, systemInfo, raw)

---

## 프로젝트 구성 (이 레포가 만들 두 패키지)

### 패키지 1: VS Code Extension (`packages/extension/`)

- Antigravity IDE에 설치되는 확장
- `antigravity-sdk`를 의존성으로 사용
- 확장 activate 시 로컬 HTTP 서버를 시작 (127.0.0.1 전용, 외부 접근 차단)
- 모든 SDK 기능을 REST API 엔드포인트로 노출
- 확장 deactivate 시 서버 종료

### 패키지 2: CLI Tool (`packages/cli/`)

- 독립 실행형 CLI (`antigravity-cli`)
- Shebang `#!/usr/bin/env bun` — TypeScript를 bun으로 직접 실행 (별도 빌드 불필요)
- 로컬 HTTP 서버에 요청을 보내 SDK 기능 호출
- `bun install -g`로 글로벌 설치 가능
- 주요 커맨드 구조:
  ```
  antigravity-cli cascade list                           # 대화 목록
  antigravity-cli cascade create --model flash --msg "…" # 새 대화 생성
  antigravity-cli cascade send <id> --msg "…"            # 메시지 전송
  antigravity-cli cascade focus <id>                     # 대화 포커스
  antigravity-cli step accept                            # 스텝 수락
  antigravity-cli step reject                            # 스텝 거부
  antigravity-cli terminal accept                        # 터미널 명령 수락
  antigravity-cli terminal reject                        # 터미널 명령 거부
  antigravity-cli terminal run                           # 터미널 명령 실행
  antigravity-cli prefs get                              # 에이전트 설정 조회
  antigravity-cli diag                                   # 시스템 진단 정보
  antigravity-cli monitor start                          # 이벤트 모니터링 (SSE 또는 polling)
  antigravity-cli ls create --model pro --msg "…"        # 헤드리스 Cascade 생성
  antigravity-cli ls send <cascade-id> --msg "…"         # LS를 통한 메시지 전송
  antigravity-cli ls list                                # LS Cascade 목록
  antigravity-cli ls focus <cascade-id>                  # LS Cascade UI 표시
  antigravity-cli commands list                          # Antigravity 명령 목록
  antigravity-cli commands exec <cmd> [args...]          # 명령 실행
  antigravity-cli state get [key]                        # USS 상태 조회
  antigravity-cli ui install                             # Agent View UI 요소 설치
  ```

---

## 개발 워크플로우

- **작업 단위별 커밋 필수**: 리팩토링·기능 추가 등 논리적 작업 단위가 완료될 때마다 반드시 `git commit`한다. 여러 작업을 묶어서 한 번에 커밋하지 않는다.
- **커밋 메시지**: 한글로 작성. 접두어 사용 (`refactor:`, `feat:`, `fix:`, `chore:`)

---

## 보안 제약 사항

1. **HTTP 서버는 반드시 `127.0.0.1`에만 바인드** — 외부 네트워크 접근 차단
2. **OAuth 토큰 접근 불가** — SDK 자체에 SENSITIVE_KEYS 블록리스트 내장
3. **인증 토큰 추출/프록시 절대 금지** — Google TOS 위반으로 계정 밴 대상
4. **서버 포트는 랜덤 할당** → CLI가 자동 발견하는 메커니즘 필요 (파일 기반 또는 설정 기반)

---

## 기술 스택

- **언어**: TypeScript (strict mode)
- **빌드**: tsup (SDK와 동일)
- **확장 런타임**: VS Code Extension API (`@types/vscode ^1.85.0`)
- **HTTP 서버**: Node.js 내장 `http` 모듈 또는 가벼운 프레임워크 (fastify 권장)
- **CLI 프레임워크**: commander.js 또는 yargs
- **의존성**: `antigravity-sdk@^1.6.0`, `sql.js@^1.14.0` (SDK peer)
- **패키지 관리**: npm workspaces (모노레포)
- **라이선스**: AGPL-3.0-or-later (SDK와 동일)

---

## 참고 자료

- **SDK GitHub**: https://github.com/Kanezal/antigravity-sdk
- **SDK npm**: https://www.npmjs.com/package/antigravity-sdk
- **SDK 문서**: https://kanezal.github.io/antigravity-sdk
- **Antigravity 공식**: https://antigravity.google
- **Google TOS 관련**: OAuth 토큰 추출/외부 사용 시 무관용 밴 정책 적용 중
