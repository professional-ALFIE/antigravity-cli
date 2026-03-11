# antigravity-cli

이 저장소는 `packages/sdk`, `packages/extension`, `packages/cli`를 포함한 monorepo입니다.
하지만 실제 사용자 진입점은 CLI이므로, root README도 CLI 사용법을 중심으로 설명합니다.

## 저장소 구성

- `packages/sdk` — 로컬 포크 SDK
- `packages/extension` — Bridge VS Code extension
- `packages/cli` — `antigravity-cli`

## 설치

### 원라이너 설치 (권장)

```bash
curl -sL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

SDK 빌드 → Bridge Extension 빌드/패키징 → Antigravity IDE 설치 → CLI 설정까지 전부 자동으로 진행됩니다.

**필수 요구사항:** Git, Node.js 18+, npm
**권장:** [bun](https://bun.sh) (CLI 실행 속도 향상)

### 업데이트

같은 명령을 다시 실행하면 자동으로 업데이트됩니다.

### 수동 설치

```bash
git clone https://github.com/professional-ALFIE/antigravity-cli.git ~/.antigravity-cli
cd ~/.antigravity-cli
npm install
npm -w packages/sdk run build
npm -w packages/extension run build
cd packages/extension && yes | npx @vscode/vsce package --no-dependencies && cd ../..
# Antigravity IDE에 Extension 설치
/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity --install-extension packages/extension/*.vsix --force
```

## CLI 사용법

```text
Usage: antigravity-cli [options] [message]

현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI

Options:
  -m, --model <model>   대화 모델 설정
                        claude-opus-4.6 (default)
                        claude-sonnet-4.6
                        gemini-3.1-pro-high
                        gemini-3.1-pro
                        gemini-3-flash
  -r, --resume          세션 조회
      --resume [uuid]   해당 세션에 이어쓰기
  -a, --async           응답 대기 없이 지시 후 즉시 종료
  -j, --json            JSON 형식으로 출력
  -p, --port <port>     Bridge 서버 포트 수동 지정
  -v, --version         output the version number
  -h, --help            display help for command

Commands:
  server                IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)
  agent                 워크플로우/규칙 관리
  commands              Antigravity 내부 명령어 조회/직접 실행

Examples:
  $ antigravity-cli "코드 리뷰해줘"                       새 대화 생성
  $ antigravity-cli -r                                   현재 작업영역 대화 목록
  $ antigravity-cli -r SESSION_UUID "이어서 진행해"       기존 대화에 메시지 전송
  $ antigravity-cli -a "빠르게 답해"                      응답 대기 없이 즉시 종료
  $ antigravity-cli server status                        서버 + 유저 상태
  $ antigravity-cli server auto-run status               auto-run 패치 상태 확인

Root Mode:
  - 새 대화 / 이어쓰기 모두 백그라운드 UI 반영을 명시 실행합니다
  - 현재 보고 있는 메인 대화 화면은 절대 바꾸지 않습니다
  - 현재 작업영역 Bridge가 없고 Antigravity가 이미 실행 중이면, 새 작업영역 창만 생성 직후 최소화한 뒤 연결합니다
  - --resume 목록도 현재 작업영역 대화만, 전체 UUID로 출력합니다
  - 메시지는 하나의 positional 인자로만 받습니다. 공백이 있으면 반드시 따옴표로 감싸세요
  - exec, resume, --no-wait 는 제거되었습니다
```

## CLI 공식 명령

### 루트 모드 (기본 대화)

| 옵션/인자 | 설명 |
|-----------|------|
| `antigravity-cli "메시지"` | 새 대화 생성 |
| `-m, --model <model>` | 대화 모델 설정 |
| `-r, --resume` | 세션 조회 |
| `-r, --resume [uuid] "메시지"` | 기존 대화 이어쓰기 |
| `-a, --async` | 응답 대기 없이 즉시 종료 |
| `-j, --json` | JSON 형식으로 출력 |
| `-p, --port <port>` | Bridge 서버 포트 수동 지정 |
| `-v, --version` | 버전 출력 |
| `-h, --help` | 도움말 출력 |

### server

| 서브커맨드 | 설명 |
|------------|------|
| `server status` | 서버 연결 + 유저 상태 |
| `server prefs` | 에이전트 설정 조회 |
| `server diag` | 시스템 진단 정보 |
| `server monitor` | 실시간 이벤트 스트림 |
| `server state [key]` | 내부 저장소 조회 |
| `server reload` | IDE 창 리로드 |
| `server restart` | 언어 서버 재시작 |
| `server auto-run status` | auto-run 패치 적용 상태 확인 |
| `server auto-run apply` | auto-run 패치 수동 적용 |
| `server auto-run revert` | auto-run 원본 복원 |

### agent

| 서브커맨드 | 설명 |
|------------|------|
| `agent workflow` | 워크스페이스 워크플로우 생성 |
| `agent workflow --global` | 글로벌 워크플로우 생성 |
| `agent rule` | 규칙 생성 |

### commands

| 서브커맨드 | 설명 |
|------------|------|
| `commands list` | 내부 명령어 목록 |
| `commands exec <cmd> [args...]` | 내부 명령 직접 실행 |

## 구현됨 / 추후 공식 지원 예정

아래 명령과 옵션은 이미 구현되어 있지만 현재 기본 `--help`에는 노출하지 않습니다.
일부 구현은 추후 공식 지원 예정입니다.

| 명령/옵션 | 설명 | 비고 |
|-----------|------|------|
| `accept` | 대기 중인 스텝 수락 | auto-run 사용 시 일반 사용자가 직접 호출할 일이 적습니다 |
| `reject` | 대기 중인 스텝 거부 | auto-run 사용 시 일반 사용자가 직접 호출할 일이 적습니다 |
| `run` | 대기 중인 터미널 명령 실행 | auto-run 사용 시 일반 사용자가 직접 호출할 일이 적습니다 |
| `ui install` | Agent View UI 요소 설치 | 내부/유지보수 성격이 강합니다 |
| `--idle-timeout <ms>` | 루트 대화 모드 idle timeout | 고급 사용자용 디버그성 옵션입니다 |

## 참고

- `auto-run` top-level 명령은 `server auto-run`으로 이동했습니다.
- `accept`, `reject`, `run`, `ui`, `--idle-timeout`은 구현되어 있으나 기본 help 표면에서는 숨겨집니다.
- macOS에서 Antigravity가 이미 실행 중이고 현재 작업영역 Bridge가 없으면, 새 작업영역 창만 생성 직후 최소화한 뒤 그 창의 Bridge를 기다립니다.
