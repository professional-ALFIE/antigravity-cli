[English](../README.md) | **[한국어](./README.ko.md)** | [日本語](./README.ja.md) | [中文](./README.zh.md)

# antigravity-cli

> **터미널에서 Antigravity의 Opus에게 직접 명령하세요.**
>
> Claude Code나 Codex에서, Antigravity를 서브에이전트처럼 쓸 수 있습니다.

- [Releases](https://github.com/professional-ALFIE/antigravity-cli/releases)
- [Changelog](../CHANGELOG.md)

## 주요 특징

- **프로젝트별 transcript 자동 저장** — `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl` 경로에 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 관례와 동일하게 저장합니다. grep, replay, pipe 모두 가능합니다.
- **`--json`은 실시간 스트리밍** — step이 도착할 때마다 JSONL 이벤트를 stdout으로 즉시 emit합니다. 텔레그램 봇, 로그 수집기, 대시보드 등 어디든 파이프로 붙여 쓸 수 있습니다.

## 버전 변천

| 버전 | 접근 방식 |
|------|----------|
| **v0.1.0** | Extension → Bridge HTTP API → SDK |
| **v0.1.3** | Offline 전용 — 자체 LS spawn, IDE 불필요 |
| **v0.2.0** | **하이브리드** — IDE가 떠 있으면 live sync(!), 없으면 offline spawn(!!) |

## 빠른 시작

### 원라이너 설치

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

## 데모

<div align="center">
  <img src="../screenshots/screen-recoding-2026-04-12-02.55.33.gif" alt="antigravity-cli 데모 — 터미널에서 Antigravity 세션까지" />
</div>

---

## 왜 필요한가요?

### 1. Antigravity 할당량을 합법적으로 활용하세요

Antigravity Pro/ULTRA는 **Opus**를 제공하지만, IDE 안에서만 쓸 수 있습니다.

OpenClaw, 프록시, opencode 같은 도구들이 Antigravity의 OAuth 토큰을 빼돌려서 외부에서 쓰려 했고,
**Google은 해당 계정들을 대량 밴했습니다.**

**이 CLI는 토큰을 빼돌리지 않습니다.**
Antigravity.app에 내장된 공식 LS 바이너리를 직접 실행하고, IDE가 로컬에 저장한 인증 정보(`state.vscdb`)를 그대로 사용합니다. 계정 밴 걱정? 없습니다.

### 2. 다른 에이전트에서 Antigravity를 서브에이전트로 소환하세요

Claude Code나 Codex로 작업 중일 때:

```bash
# Claude Code 안에서 Antigravity의 Opus에게 별도 작업 던지기
antigravity-cli "이 모듈 리팩토링해줘"
antigravity-cli -b "테스트 코드 작성해"     # 백그라운드 — UI 표시 생략
```

다른 에이전트가 메인 작업에 집중하는 동안, **Antigravity가 병렬로 서브 작업을 처리합니다.**

### 3. Antigravity 안에서도 서브에이전트처럼 사용하며 컨텍스트를 분리하세요

Antigravity에서 긴 작업을 하다 보면:
- **컨텍스트 폭발** — 한 대화에 이것저것 시키면 토큰이 차서 품질이 떨어짐
- **흐름 끊김** — "잠깐 이것만" 하려고 끼워 넣으면 맥락이 꼬임

이 CLI로 서브에이전트를 따로 소환하면, **메인 대화 컨텍스트를 오염시키지 않고** 별도 작업을 던질 수 있어요.

*에이전트 하나에 모든 걸 쑤셔넣지 마세요. 컨텍스트도 효율적으로 관리하세요.*

---

## 뭘 하는 건가요?

| 명령 | → | 효과 |
|------|---|------|
| `antigravity-cli "리팩토링해"` | → | **새 세션** 생성, 응답을 기다림 |
| `antigravity-cli -r` | → | 현재 작업영역 **세션 목록** 조회 |
| `antigravity-cli -r <cascadeId> "이어서"` | → | 기존 세션에 **이어쓰기** |
| `antigravity-cli -b "빠르게 답해"` | → | **UI 표시 등록 생략** |
| `antigravity-cli -j "요약해줘"` | → | **JSONL transcript 이벤트 출력** |
| `antigravity-cli auth list` | → | **계정 목록** + GEMINI/CLAUDE quota 상태 표시 |
| `antigravity-cli auth login` | → | Antigravity 앱으로 **새 managed 계정 추가** |

**핵심:** Antigravity IDE가 실행 중이면 **떠 있는 LS에 직접 연결**해서 UI에 즉시 반영합니다. IDE가 없으면 **자체 LS를 spawn**하고 내장 extension shim으로 인증을 주입합니다 — IDE 창 불필요.

---

## 설치

### 원라이너

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

하는 일:
- `~/.antigravity-cli/source` 아래에 레포를 clone 또는 업데이트
- `bun install`로 의존성 설치
- `~/.local/bin`에 `antigravity-cli` 및 `agcl`(단축 alias) 심볼릭 링크 생성
- `antigravity-cli --help`로 설치 검증

**필수:** macOS, Antigravity.app 설치 + 최소 1회 로그인, Git, [Bun](https://bun.sh)

> **업데이트?** 같은 명령을 다시 실행하면 됩니다.

### 수동 설치

```bash
git clone https://github.com/professional-ALFIE/antigravity-cli.git ~/.antigravity-cli/source
cd ~/.antigravity-cli/source
bun install
chmod +x src/main.ts src/entrypoints/cli.ts
mkdir -p ~/.local/bin
ln -sf ~/.antigravity-cli/source/src/entrypoints/cli.ts ~/.local/bin/antigravity-cli
```

`~/.local/bin`이 `PATH`에 없으면 추가하세요:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## 사용법

```bash
antigravity-cli 'hello'                               # 또는: agcl 'hello'
antigravity-cli "hello"                               # 또는: agcl "hello"
antigravity-cli hello world                           # 따옴표 없이 — 자동으로 합쳐짐
antigravity-cli 'review this code'                    # 새 대화 생성
antigravity-cli 'write tests' --model flash           # 또는: agcl -m flash 'write tests'
antigravity-cli --resume                              # 또는: agcl -r ⭢ 현재 작업영역 세션 목록
antigravity-cli --resume <cascadeId> 'continue'       # 또는: agcl -r <cascadeId> 'continue'
antigravity-cli --background 'quick task'             # 또는: agcl -b 'quick task'
antigravity-cli --json 'summarize this'               # 또는: agcl -j 'summarize this' ⭢ JSONL → stdout
antigravity-cli --help                                # 또는: agcl -h

# 계정 관리
antigravity-cli auth list                             # 또는: agcl auth list ⭢ 계정 + quota 표시
antigravity-cli auth login                            # 또는: agcl auth login ⭢ 새 managed 계정 추가

# Stdin pipe — 쉘 이스케이프 문제(!, " 등)를 회피
antigravity-cli -                                     # 명시적 stdin 마커
echo "hello!" | antigravity-cli
cat prompt.txt | antigravity-cli
```

---

## 지원 옵션

| 옵션 | 설명 |
|------|------|
| *(`--model` 생략 시)* | **IDE에서 마지막으로 사용한 모델을 자동 적용** — IDE에서 모델을 바꾸면 CLI도 따라감 |
| `"메시지"` | 새 대화 생성 (여러 단어는 자동으로 합쳐짐) |
| `-m, --model <모델>` | 대화 모델 지정 (기본값: IDE 마지막 사용 모델) |
| `-r, --resume` | 세션 목록 |
| `-r, --resume [cascadeId] "메시지"` | cascadeId(UUID)로 세션 이어쓰기 |
| `-b, --background` | UI 표시 등록 생략 |
| `-j, --json` | transcript 이벤트를 JSONL로 stdout에 출력 |
| `--timeout-ms <숫자>` | 타임아웃 오버라이드 (밀리초, 기본값: 120000) |
| `-h, --help` | 도움말 표시 |
| `auth list` | 계정 목록 + GEMINI/CLAUDE quota progress bar 표시 |
| `auth login` | Antigravity 앱으로 새 managed 계정 추가 |

**지원 모델:**
- `claude-opus-4.6`
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

`--model`을 생략하면, CLI가 **Antigravity IDE에서 마지막으로 선택한 모델을 자동으로 사용**합니다 (`state.vscdb`에서 읽음). IDE에서 모델을 바꾸면 CLI도 따라갑니다 — 플래그 없이도.

---

## Transcript

모든 대화는 `--json` 유무와 관계없이 JSONL로 자동 저장됩니다.

```
~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl
```

공식 Antigravity IDE는 transcript를 제공하지 않습니다. 이 CLI는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)의 관례(`~/.claude/projects/…/<sessionId>.jsonl`)를 따라, 대화 기록을 파일로 남깁니다. grep, replay, 파이프 등 동일한 방식으로 활용할 수 있습니다.

plain 모드 세션 종료 후 다음과 같은 안내가 출력됩니다:

```
cascadeId: 8ed28f7a-…
transcript_path: ~/.antigravity-cli/projects/-Users-…/8ed28f7a-….jsonl

To continue this session, run antigravity-cli --resume 8ed28f7a-… '<message>'
```

`--json`에서는 이 footer가 출력되지 않습니다.

plain 모드에서는 trajectory의 user-facing error message가 들어오는 즉시 stderr로 출력되며, provider short error와 retry guidance를 final generic warning 대신 바로 보여줍니다.

---

## 작동 원리

CLI가 실행 경로를 자동으로 판단합니다:

```
                      antigravity-cli
                            │
                  argv / config / model
                            │
                 live Language Server 탐색
                            │
                 ┌──────────┴──────────┐
                 │                     │
           LS가 떠 있음?          LS를 못 찾음?
                 │                     │
          ⭢ Live Sync           ⭢ Offline Spawn
                 │                     │
          IDE의 기존 LS에         자체 LS spawn +
          직접 연결               extension shim 주입
                 │                     │
                 └──────────┬──────────┘
                            │
                 ConnectRPC (HTTPS)
                            │
                 StartCascade → stream
                 → steps → transcript
```

### 경로 A — Live Sync (IDE 실행 중)

1. 프로세스 탐색(`ps` + `lsof`)으로 실행 중인 LS를 발견
2. live discovery 파일에서 CSRF 토큰과 HTTPS 포트 추출
3. 기존 LS에 **ConnectRPC**로 직접 연결 — spawn 없음, fake server 없음
4. 대화가 IDE UI에 즉시 반영됨
5. `state.vscdb`는 **건드리지 않음** — IDE가 자체적으로 관리

### 경로 B — Offline Spawn (IDE 없음)

1. **`state.vscdb`**에서 OAuth 토큰, 모델 설정, USS topic bytes를 읽음
2. `Antigravity.app`의 **LS 바이너리**를 spawn하고 stdin으로 protobuf 메타데이터 전달
3. **내장 extension shim**이 역방향 RPC 처리 (USS 인증 핸드오프, heartbeat)
4. spawn된 LS에 **ConnectRPC** over HTTPS (자체 서명 `cert.pem`)로 통신
5. agent state 업데이트를 스트리밍하고, 대화 진행에 따라 trajectory steps를 가져옴
6. 후처리: `trajectorySummaries`를 `state.vscdb`에 hydration하여 나중에 IDE에서 보이게 함

**Bridge Extension 불필요.** IDE 창 유무와 관계없이 LS 바이너리와 직접 통신합니다.

---

## 참고

- `--model`을 생략하면, CLI가 **IDE의 마지막 사용 모델을 자동으로 따릅니다** — IDE에서 모델을 바꾸면 CLI도 따라갑니다.
- `--background`는 UI 표시 등록을 생략합니다 (`trajectorySummaries` hydration 안 함).
- 여러 단어를 따옴표 없이 나열하면 자동으로 공백으로 합쳐집니다 — 따옴표는 선택 사항입니다.
- stdin pipe(`echo "프롬프트" | agcl`)로 `!`, `"` 등 쉘 이스케이프 문제를 회피할 수 있습니다.
- Antigravity.app이 설치되어 있고 최소 1회 로그인한 상태여야 합니다 (`state.vscdb` 필요).
- IDE가 실행 중이면 **떠 있는 LS에 연결**합니다. 없으면 **LS 인스턴스를 새로 spawn**합니다 (1:1 one-shot).

---

## Contributors

이 프로젝트는 AI 에이전트와 함께 만들었습니다.

| | 역할 |
|---|------|
| **[professional-ALFIE](https://github.com/professional-ALFIE)** | 설계, 디렉션, 검증 |
| **[Antigravity](https://antigravity.google)** | 구현, 디버깅, 리팩토링 |
| **[Codex](https://openai.com/codex)** | protobuf 분석, 코드 검증 |

---

## 라이선스

AGPL-3.0-or-later
