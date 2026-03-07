# Handoff — 다음 세션 인수인계

> 이 문서는 다음 세션에서 에이전트가 읽고 이어서 작업할 수 있도록 작성되었습니다.

## 현재 상태 요약

Bridge Extension + CLI 전체 기능 완성. **14개 API/CLI 명령이 정상 작동** (exec 포함).
이제 **CLI 도구의 품질을 끌어올리는 리팩토링** 단계.

## 완료된 작업

- [x] Extension + HTTP 서버 + REST API (7개 라우트)
- [x] CLI 전체 커맨드 (exec, list, status, prefs, diag, commands, focus, accept, reject, run, monitor, state, ui)
- [x] SDK 로컬 포크 (`packages/sdk/`) + protobuf ProtoJSON 수정
- [x] CLI 모델 이름→ID 매핑 (기본: opus)
- [x] 14/14 통합 테스트 통과

## 다음 세션에서 할 일: CLI 리팩토링

> **⚠️ 리팩토링 항목은 명령어 하나하나 주인님과 상의 후 진행한다.**

### 문제점

1. **출력이 날것** — JSON 덤프 수준. `list` 하면 거대한 객체가 쏟아짐. codex처럼 요약된 테이블이 필요
2. **색상 없음** — 모든 출력이 무색. 성공/실패/키/값 구분이 안 됨
3. **exec가 fire-and-forget** — cascade 생성만 하고 끝. 응답 스트리밍/폴링이 없음
4. **에러 메시지가 기술적** — 사용자 친화적이지 않음
5. **코드 구조** — 317행 단일 파일에 모든 커맨드가 몰려있음
6. **글로벌 설치 불가** — `bun packages/cli/bin/antigravity-cli.ts`로만 실행 가능

### 리팩토링 항목

#### 1. 출력 포매팅 개선 (`output.ts` 재작성)

`list` 출력 — Before vs After:
```
Before:
{ "0aaf20ee-...": { "summary": "Understanding CLI...", "createdAt": "2026-..." } }

After:
  ID          TITLE                          MODEL    CREATED
  0aaf20ee    Understanding CLI Tool Cre...  flash    2h ago
  f81d4fae    Designing game frontend        pro      5h ago
  (12 conversations)
```

`status` 출력 — Before vs After:
```
Before:
{ server: { uptime: 123.4 }, user: { userStatus: { name: "노승경", ... } } }

After:
  ◉ Bridge Online (uptime: 2m 3s)
  ◉ User: 노승경 (nsk1221aa3@gmail.com)
  ◉ Plan: Pro  |  Models: 6 available
```

`exec` 출력 — Before vs After:
```
Before:
f25ff6ab-0ef5-40c6-884c-6de32fde4f24

After:
  ◉ Cascade created: f25ff6ab
  ⠋ Waiting for response...
  ───────────────────────
  답: 1+1 = 2
  ───────────────────────
  ✓ Done (3.2s, flash, 142 tokens)
```

#### 2. 컬러 출력 (chalk 또는 ANSI 직접)

- 성공: 초록 (`✓`)
- 실패: 빨강 (`✗`)
- 키: dim/회색
- 값: 밝은 흰색
- cascade ID: 시안/파랑
- `--no-color` 플래그로 비활성화 가능

#### 3. exec 응답 스트리밍

현재 exec는 cascade ID만 반환하고 끝남. 개선:
1. cascade 생성 → ID 출력
2. `monitor/events` SSE로 스텝 변경 감지
3. 완료 시 결과 출력 + 소요시간/토큰 수
4. `--no-wait` 옵션으로 기존 fire-and-forget 동작 유지

#### 4. 커맨드 파일 분리 ✅ (완료)

```
packages/cli/
├── bin/antigravity-cli.ts          ← 진입점 (64행, program 정의 + 커맨드 등록)
├── src/
│   ├── commands/
│   │   ├── exec.ts                 ← exec 커맨드 + MODEL_MAP + resolveModel
│   │   ├── list.ts                 ← list 커맨드
│   │   ├── focus.ts                ← focus 커맨드
│   │   ├── step-control.ts         ← accept/reject/run
│   │   ├── status.ts               ← status 커맨드
│   │   ├── monitor.ts              ← monitor SSE 커맨드
│   │   ├── prefs.ts                ← prefs 커맨드
│   │   ├── diag.ts                 ← diag 커맨드
│   │   ├── commands.ts             ← commands list/exec 서브커맨드
│   │   ├── state.ts                ← state 커맨드
│   │   └── ui.ts                   ← ui install 서브커맨드
│   ├── client.ts                   ← HTTP 클라이언트 (현행 유지)
│   ├── discovery.ts                ← 인스턴스 탐색 (현행 유지)
│   ├── helpers.ts                  ← 공유 헬퍼 (getClient, isJsonMode, run)
│   ├── output.ts                   ← 포매팅 (전면 재작성 대상)
│   └── colors.ts                   ← ANSI 컬러 유틸리티
```

#### 5. 글로벌 설치 지원

`packages/cli/package.json`에 `bin` 필드 추가:
```json
{ "bin": { "antigravity-cli": "./bin/antigravity-cli.ts" } }
```
→ `bun install -g` 또는 `npm link`로 글로벌 사용 가능

## 핵심 파일 위치

| 파일 | 역할 |
|------|------|
| `packages/cli/bin/antigravity-cli.ts` | CLI 진입점 (317행, 리팩토링 대상) |
| `packages/cli/src/output.ts` | 출력 포매팅 (93행, 전면 재작성 대상) |
| `packages/cli/src/client.ts` | HTTP 클라이언트 (125행, 유지) |
| `packages/cli/src/discovery.ts` | 인스턴스 탐색 (59행, 유지) |
| `packages/extension/src/server/routes/ls.ts` | LS API 엔드포인트 |
| `packages/sdk/src/transport/ls-bridge.ts` | SDK LS Bridge (수정 완료) |
| `~/.antigravity-cli/instances.json` | 포트 매핑 |
