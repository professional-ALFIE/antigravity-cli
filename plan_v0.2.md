# plan_v0.2.md

> 작성 시각: 2026-03-10 KST
> HEAD: `2906a86`
> 성격: **바로 구현 가능한 작업 지시서**
> 기준: `plan_v0.2.opus.md` 참고 + 실제 워크스페이스 검증 반영
> 원칙: **추후 검증 금지. 이 문서 안에서 런타임/API/출력 형식을 모두 검증하고 고정한다.**

---

## 1. 고정 결정 사항

아래는 이미 결정된 것으로 보고, 구현 중 다시 논의하지 않는다.

- [x] 이 문서는 설계 메모가 아니라 **바로 구현 가능한 지시서**여야 한다
- [x] `-V`는 삭제하고 `-v`만 지원한다
- [x] `packages/cli/src/commands/auto-run.ts`는 **삭제하지 않는다**
- [x] `auto-run.ts`는 등록 함수만 `server` 하위로 바꾸고, 실제 핸들러 로직은 재사용한다
- [x] help 관련 테스트는 새 파일 `packages/cli/test/help-surface.test.ts`로 분리한다
- [x] `--help`의 `--resume`은 **반드시 두 줄**로 표시한다
- [x] `-m, --model <model>` 아래에는 지원되는 모든 모델을 줄바꿈으로 표시한다
- [x] Examples와 help 후미 텍스트는 **예시까지 exact하게 고정**한다
- [x] 체크리스트는 상세하게 둔다
- [x] root `README.md`를 새로 작성한다
- [x] README에는 `--help` 내용 + 구현된 모든 커맨드/플래그 + “추후 공식 지원 예정” 문구를 넣는다

---

## 2. 검증 완료: commander 런타임과 API

이 섹션은 이번 문서의 가장 중요한 전제다.
이전 초안의 오류였던 “실제 런타임 commander = 4.1.1” 가정은 **폐기**한다.

### 2.1 왜 `4.1.1`과 `12.1.0`이 동시에 보였는가

실제 워크스페이스에는 commander가 **두 벌** 들어 있다.

```bash
# 루트 lockfile
package-lock.json: node_modules/commander            -> 4.1.1
package-lock.json: packages/cli/node_modules/commander -> 12.1.0
```

실제 확인 결과:

```bash
$ node -p "require('./node_modules/commander/package.json').version"
4.1.1

$ sed -n '1,20p' packages/cli/node_modules/commander/package.json
"version": "12.1.0"
```

즉, **루트에서 즉석으로 require 하면 4.1.1이 보일 수 있다.**
하지만 그건 CLI 엔트리의 실제 런타임 해석과는 다를 수 있다.

### 2.2 CLI 엔트리가 실제로 가져가는 commander 버전

`packages/cli/bin/antigravity-cli.ts` 기준으로 `createRequire()` 해석 결과를 확인했다.

```bash
$ node --input-type=module -e '
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const cli_url_var = pathToFileURL(process.cwd() + "/packages/cli/bin/antigravity-cli.ts");
const require_from_cli_var = createRequire(cli_url_var);
console.log(require_from_cli_var.resolve("commander"));
'
/Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk/packages/cli/node_modules/commander/index.js
```

따라서 **`antigravity-cli.ts`의 실제 런타임 commander는 `packages/cli/node_modules/commander@12.1.0`** 이다.

이 문서의 모든 구현 전략은 **4.1.1이 아니라 12.1.0 기준**으로 고정한다.

### 2.3 commander@12.1.0 API 실험 결과

실제 `packages/cli/bin/antigravity-cli.ts` 기준으로 commander를 로드해 메서드 존재 여부를 확인했다.

```bash
hasHelpInformation=true
hasConfigureHelp=true
hasCreateHelp=true
hasHideHelpOnCommand=false
hasOptionHideHelp=true
```

정리:

- [x] `helpInformation()` 존재
- [x] `configureHelp()` 존재
- [x] `createHelp()` 존재
- [x] `Command.hideHelp()` 메서드는 없음
- [x] `Option.hideHelp()` 메서드는 있음

### 2.3.1 commander 타입 정의 근거 위치

오퍼스 문서의 장점은 “그 API가 정말 있느냐”를 타입 정의 줄번호까지 박아 둔 점이다.
이번 문서도 그 강점을 가져와 아래처럼 **파일 + 줄번호** 근거를 고정한다.

- [x] `Option.hideHelp(hide?: boolean): this` → `packages/cli/node_modules/commander/typings/index.d.ts:179`
- [x] `Help.formatHelp(cmd: Command, helper: Help): string` → `packages/cli/node_modules/commander/typings/index.d.ts:264`
- [x] `HelpConfiguration = Partial<Help>` → `packages/cli/node_modules/commander/typings/index.d.ts:266`
- [x] `.version(str, flags?, description?)` → `packages/cli/node_modules/commander/typings/index.d.ts:315`
- [x] `.command(nameAndArgs, opts?: CommandOptions)` → `packages/cli/node_modules/commander/typings/index.d.ts:341`
- [x] `createHelp(): Help` → `packages/cli/node_modules/commander/typings/index.d.ts:485`
- [x] `configureHelp(configuration: HelpConfiguration): this` → `packages/cli/node_modules/commander/typings/index.d.ts:491`
- [x] `helpInformation(context?: HelpContext): string` → `packages/cli/node_modules/commander/typings/index.d.ts:908`
- [x] `CommandOptions.hidden?: boolean` → `packages/cli/node_modules/commander/typings/index.d.ts:951`
- [x] `CommandOptions.noHelp?: boolean` deprecated → `packages/cli/node_modules/commander/typings/index.d.ts:953-954`

### 2.4 숨김 커맨드 API 실험 결과

`command('name', { hidden: true })` 와 `command('name', { noHelp: true })` 둘 다 help에서 숨겨지는 것을 확인했다.

실험 결과:

```text
---hidden:true---
Commands:
  shown           shown cmd
  help [command]  display help for command

---noHelp:true---
Commands:
  shown           shown cmd
  help [command]  display help for command
```

그리고 commander 12.1.0 소스에도 아래가 있다.

```js
cmd._hidden = !!(opts.noHelp || opts.hidden); // noHelp is deprecated old name for hidden
```

따라서 결론은 다음과 같다.

- [x] `{ noHelp: true }` 도 현재는 동작한다
- [x] 하지만 **deprecated alias** 이므로 새 계획서에서는 `{ hidden: true }` 를 사용한다

### 2.5 `helpInformation()` / `addHelpText()` / `configureHelp()` 실험 결과

#### A. `helpInformation()` override

직접 override가 실제로 먹는지 확인했다.

```bash
overrideWorks=true
prototypeHasHelpInformation=true
```

즉, commander 12.1.0에서도 `program.helpInformation = function () { ... }` 방식이 실제로 동작한다.

#### B. `helpInformation()` override + `addHelpText('after', ...)`

실험 결과:

```text
CUSTOM HELP

AFTER BLOCK
```

즉, `helpInformation()`을 통째로 override해도 `addHelpText('after', ...)`는 **따로 한 번 더 붙는다.**
따라서 root help를 exact 문자열로 직접 반환할 경우, **기존 `addHelpText('after', ...)`는 제거해야 중복이 없다.**

#### C. `configureHelp({ formatHelp })`

`configureHelp()` 자체는 존재하고 사용 가능하다.
하지만 naive하게 `helper.formatHelp(...)` 또는 `cmd.createHelp().formatHelp(...)`를 다시 부르면 **재귀로 스택 오버플로우**가 난다.

실험에서 실제로 `RangeError: Maximum call stack size exceeded`를 재현했다.

안전한 기본 호출은 아래 패턴이다.

```typescript
import { Help } from 'commander';

program.configureHelp({
  formatHelp(cmd_var, helper_var) {
    const default_help_var = Help.prototype.formatHelp.call(this, cmd_var, helper_var);
    return default_help_var;
  },
});
```

즉, `configureHelp()`는 쓸 수 있지만 “대충 기본 도움말 문자열 받아와서 replace” 식으로 적으면 바로 꼬일 수 있다.

### 2.6 root README 존재 여부 확인

실제 확인 결과:

```bash
ROOT_MISSING
CLI_MISSING
```

따라서 이번 작업에서 만드는 README는 **root `README.md` 신규 생성**으로 고정한다.

### 2.7 이번 구현에서 채택할 최종 전략

위 검증을 바탕으로 아래를 확정한다.

- [x] **실제 CLI 런타임은 commander 12.1.0**
- [x] 숨김 커맨드는 `{ hidden: true }` 사용
- [x] 숨김 옵션은 `new Option(...).hideHelp()` 사용
- [x] root / `server` / `server auto-run` help는 **`helpInformation()` override로 exact 문자열을 직접 반환**
- [x] 기존 root `addHelpText('after', ...)`는 제거
- [x] `configureHelp()` / `createHelp()`는 “없어서 안 쓰는 것”이 아니라, **이번 목표가 exact public spec 고정이기 때문에 채택하지 않는 것**

### 2.8 왜 이번 문서는 `helpInformation()`을 채택하는가

여기서 선택지는 두 개다.

- `configureHelp({ formatHelp })`로 기본 렌더링을 살리고 일부만 치환한다
- `helpInformation()`으로 최종 문자열 전체를 직접 반환한다

둘 다 commander 12.1.0에서 가능하다.
둘 다 exact spec 구현이 가능하다.
따라서 이번 문서에서는 “가능/불가능”이 아니라 **어떤 trade-off를 감수할지**를 분명히 적어야 한다.

이번 구현에서 `helpInformation()`을 채택하는 이유:

- [x] 이번 help spec은 옵션 줄 몇 개만 바꾸는 수준이 아니라, `Commands`, `Examples`, `Root Mode`, `server`, `server auto-run`까지 **표면 전체를 재정의**한다
- [x] `helpInformation()`을 쓰면 출력 경로가 한 군데라서, `formatHelp` 결과와 `addHelpText` 후미 텍스트가 분리되는 문제를 피할 수 있다
- [x] 이번 작업은 public spec을 테스트로 고정하는 문서화 작업이므로, 현재 규모에서는 “문자열 수동 유지비용”보다 “출력 경로 단일화”가 더 중요하다

감수하는 비용:

- [x] 옵션/커맨드를 바꿀 때 등록 코드와 help 문자열을 **둘 다** 수정해야 한다
- [x] commander 기본 정렬/spacing 변경 이점을 거의 버린다

따라서 이번 문서는 다음처럼 고정한다.

- [x] `configureHelp()`는 **검증 완료한 대안**으로 문서에 남긴다
- [x] 하지만 **이번 구현 지시서는 `helpInformation()`만 채택**한다
- [x] built-in formatter를 병행하지 않으므로 `.configureHelp({ sortSubcommands: false })`는 유지하지 않는다

---

## 3. 클로드 비판 반영표

아래 비판은 유효 여부를 검증했고, 이 문서에 반영했다.

| 비판 | 판정 | 반영 내용 |
|------|------|-----------|
| commander 4.1.1 전제가 틀렸을 수 있다 | **유효** | 실제 CLI 런타임을 12.1.0으로 재검증하고 문서 전체 전제 수정 |
| `{ noHelp: true }`는 commander@12에서 애매하다 | **절반 유효** | 동작은 하지만 deprecated alias. 계획서는 `{ hidden: true }`로 변경 |
| `helpInformation()` override 동작이 미검증이다 | **유효** | 실험으로 실제 동작 확인 후 채택 근거 문서화 |
| `configureHelp()` / `createHelp()`를 근거 없이 배제했다 | **유효** | 존재/동작을 검증한 뒤, exact 문자열 고정 목적 때문에 미채택으로 정리 |
| “바로 구현 가능”인데 diff가 없다 | **유효** | 아래 §8에 파일별 실제 변경 코드 조각 추가 |
| Examples / Root Mode 삽입 경로가 불명확하다 | **유효** | root help 문자열 안에 직접 포함하고 `addHelpText` 제거로 고정 |

---

## 4. 목표

현재 CLI는 구현된 내부/유지보수 기능이 default `--help`에 그대로 노출되어 있다.
이번 작업의 목표는 **공식 help 표면을 다시 정의하고**, 사용자가 help에서 보는 것과 실제 동작하는 것을 정확히 맞추는 것이다.

핵심 목표는 5가지다.

- [ ] top-level `--help`에는 `server`, `agent`, `commands`만 보이게 한다
- [ ] `accept`, `reject`, `run`, `ui`는 구현은 유지하되 top-level help에서는 숨긴다
- [ ] `auto-run`은 top-level에서 제거하고 `server auto-run`으로 이동한다
- [ ] `-a`, `-j`, `-v`를 help 표기와 실제 동작 둘 다 맞춘다
- [ ] `README.md`에 public help surface와 hidden/internal surface를 같이 기록한다

---

## 5. 완료 기준

아래 항목이 모두 충족되면 이 작업은 완료다.

- [ ] `antigravity-cli --help` 출력이 아래 “최종 목표 출력”과 **문자열 단위로 동일**하다
- [ ] `antigravity-cli server --help` 출력이 아래 “최종 목표 출력”과 **문자열 단위로 동일**하다
- [ ] `antigravity-cli server auto-run --help` 출력이 아래 “최종 목표 출력”과 **문자열 단위로 동일**하다
- [ ] `antigravity-cli -a "message"`가 `--async`와 동일하게 동작한다
- [ ] `antigravity-cli -j --resume`가 `--json --resume`와 동일하게 동작한다
- [ ] `antigravity-cli -v`가 버전 출력으로 동작한다
- [ ] `antigravity-cli auto-run status`는 채팅으로 오인되지 않고 `server auto-run` 경로를 안내하는 오류를 낸다
- [ ] `antigravity-cli server auto-run status`는 기존 `/api/auto-run/status` 경로를 그대로 호출한다
- [ ] `accept`, `reject`, `run`, `ui`, top-level `auto-run`, `--idle-timeout`이 top-level help에 보이지 않는다
- [ ] root `README.md`가 생성되고, public help + 구현된 모든 명령/플래그 + “추후 공식 지원 예정” 문구가 들어간다

---

## 6. 최종 목표 출력

### 6.1 top-level `--help`

모델 목록은 `packages/cli/src/model-resolver.ts`의 `documented_models_var` 순서를 그대로 따른다.

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
  - 현재 작업영역과 일치하는 Bridge 인스턴스에만 연결합니다
  - --resume 목록도 현재 작업영역 대화만 출력합니다
  - 메시지는 하나의 positional 인자로만 받습니다. 공백이 있으면 반드시 따옴표로 감싸세요
  - exec, resume, --no-wait 는 제거되었습니다
```

### 6.2 `server --help`

```text
Usage: antigravity-cli server [options] [command]

IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)

Options:
  -h, --help           display help for command

Commands:
  status               서버 연결 + 유저 상태
  prefs                에이전트 설정 조회
  diag                 시스템 진단 정보
  monitor              실시간 이벤트 스트림 (Ctrl+C로 종료)
  state [key]          내부 저장소 조회
  reload               IDE 창 리로드
  restart              언어 서버 재시작
  auto-run             Always Proceed auto-run 패치 관리
  help [command]       display help for command
```

### 6.3 `server auto-run --help`

```text
Usage: antigravity-cli server auto-run [options] [command]

Always Proceed auto-run 패치 관리

Options:
  -h, --help           display help for command

Commands:
  status               패치 적용 상태 확인
  apply                수동으로 패치 적용
  revert               패치 원본 복원 (.ba-backup에서)
  help [command]       display help for command
```

---

## 7. 구현 전략 고정

### 7.1 help 출력 전략

이번 구현은 commander 기본 help 렌더링에 “적당히 손대는” 방식이 아니라,
**public help surface를 직접 문자열로 고정**하는 방식으로 간다.

- [ ] root `program.helpInformation()`을 override해서 §6.1 전체 문자열을 직접 반환한다
- [ ] `serverCmd_var.helpInformation()`도 override해서 §6.2 전체 문자열을 직접 반환한다
- [ ] `server auto-run` subgroup도 `helpInformation()`을 override해서 §6.3 전체 문자열을 직접 반환한다
- [ ] root 기존 `.addHelpText('after', ...)`는 제거한다
- [ ] Examples / Root Mode / 모델 목록 / `--resume` 두 줄 표시는 **모두 custom 문자열 안에 직접 넣는다**
- [ ] 모델 목록만 `documented_models_var`를 읽어 동적으로 만든다
- [ ] `.configureHelp({ sortSubcommands: false })`는 `helpInformation()` override와 함께 두지 않는다
- [ ] `configureHelp()` / `createHelp()`는 검증된 대안이지만 **이번 구현에서는 채택하지 않는다**

### 7.2 숨김 처리 전략

- [ ] `accept`, `reject`, `run`, `ui`는 `.command(name, { hidden: true })`로 등록한다
- [ ] `--idle-timeout`은 `new Option(...).hideHelp()`로 숨긴다
- [ ] `{ noHelp: true }`는 현재 동작하지만 deprecated alias이므로 쓰지 않는다
- [ ] `Command.hideHelp()` 같은 메서드는 없으므로 가정하지 않는다

### 7.3 `auto-run` 이동 전략

- [ ] `packages/cli/src/commands/auto-run.ts` 파일은 유지한다
- [ ] export는 top-level registrar가 아니라 부모 command를 받아 등록하는 시그니처로 바꾼다
- [ ] 시그니처는 아래로 고정한다

```typescript
export function registerUnder_func(parent_var: Command, h_var: Helpers): void
```

- [ ] `status`, `apply`, `revert` 핸들러 로직은 유지한다
- [ ] help 표시 순서를 목표 출력과 맞추기 위해 등록 순서를 `status -> apply -> revert`로 바꾼다
- [ ] HTTP API 경로 `auto-run/status`, `auto-run/apply`, `auto-run/revert`는 바꾸지 않는다

### 7.4 root mode 처리 전략

- [ ] `packages/cli/src/root-mode.ts`에 `-a`, `-j`, `-v`를 반영한다
- [ ] `-V`는 더 이상 지원하지 않는다
- [ ] top-level `auto-run` 입력은 reserved command가 아니라 **legacy redirect 대상** 으로 처리한다
- [ ] 오류 메시지는 아래 exact 문구로 고정한다

```text
`auto-run`은 `server auto-run`으로 이동했습니다. 예: antigravity-cli server auto-run status
```

- [ ] `findFirstPositional_func`는 수정하지 않는다. `-j`는 이미 `startsWith('-')`로 positional 후보에서 제외된다

---

## 8. 파일별 변경 지시서

이 섹션은 “무엇을 어떻게 바꾸는지”를 파일 기준으로 고정한 것이다.

### 8.1 `packages/cli/bin/antigravity-cli.ts`

#### import 변경

```diff
- import { Command } from 'commander';
- import { default_model_name_var, formatDocumentedModels_func } from '../src/model-resolver.js';
+ import { Command, Option } from 'commander';
+ import { documented_models_var } from '../src/model-resolver.js';

- import { register as registerAutoRun } from '../src/commands/auto-run.js';
```

#### program 옵션 정의 변경

```diff
  .name('antigravity-cli')
  .usage('[options] [message]')
  .description('현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI')
- .version('0.1.0')
- .option('-p, --port <port>', 'Bridge 서버 포트 (자동 탐색 대신 수동 지정)', parseInt)
- .option('--json', 'JSON 형식으로 출력')
- .option('-m, --model <model>', `루트 대화 모드 모델 (기본: ${default_model_name_var})`)
- .option('-r, --resume [id]', '루트 대화 모드: id 없이 목록, id와 메시지를 함께 주면 현재 작업영역 대화에 이어쓰기')
- .option('--async', '루트 대화 모드: 응답 대기 없이 즉시 종료')
- .option('--idle-timeout <ms>', '루트 대화 모드 idle timeout 밀리초 (기본: 10000)')
- .addHelpText('after', `...`);
+ .version('0.1.0', '-v, --version')
+ .option('-p, --port <port>', 'Bridge 서버 포트 수동 지정', parseInt)
+ .option('-j, --json', 'JSON 형식으로 출력')
+ .option('-m, --model <model>', '대화 모델 설정')
+ .option('-r, --resume [id]', '세션 조회 / 이어쓰기')
+ .option('-a, --async', '응답 대기 없이 지시 후 즉시 종료')
+ .addOption(new Option('--idle-timeout <ms>', '루트 대화 모드 idle timeout 밀리초 (기본: 10000)').hideHelp());
```

#### root help 문자열 생성 함수 추가

아래 형태로 **정적 문자열 + 동적 모델 목록** 조합 함수를 넣는다.

```typescript
function buildModelHelpLines_func(): string {
  return documented_models_var
    .map((model_var, index_var) => (
      `                        ${model_var.cliName}${index_var === 0 ? ' (default)' : ''}`
    ))
    .join('\n');
}

function buildRootHelp_func(): string {
  const model_lines_var = buildModelHelpLines_func();
  return [
    'Usage: antigravity-cli [options] [message]',
    '',
    '현재 작업영역 Bridge를 외부에서 제어하는 헤드리스 CLI',
    '',
    'Options:',
    '  -m, --model <model>   대화 모델 설정',
    model_lines_var,
    '  -r, --resume          세션 조회',
    '      --resume [uuid]   해당 세션에 이어쓰기',
    '  -a, --async           응답 대기 없이 지시 후 즉시 종료',
    '  -j, --json            JSON 형식으로 출력',
    '  -p, --port <port>     Bridge 서버 포트 수동 지정',
    '  -v, --version         output the version number',
    '  -h, --help            display help for command',
    '',
    'Commands:',
    '  server                IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)',
    '  agent                 워크플로우/규칙 관리',
    '  commands              Antigravity 내부 명령어 조회/직접 실행',
    '',
    'Examples:',
    '  $ antigravity-cli "코드 리뷰해줘"                       새 대화 생성',
    '  $ antigravity-cli -r                                   현재 작업영역 대화 목록',
    '  $ antigravity-cli -r SESSION_UUID "이어서 진행해"       기존 대화에 메시지 전송',
    '  $ antigravity-cli -a "빠르게 답해"                      응답 대기 없이 즉시 종료',
    '  $ antigravity-cli server status                        서버 + 유저 상태',
    '  $ antigravity-cli server auto-run status               auto-run 패치 상태 확인',
    '',
    'Root Mode:',
    '  - 새 대화 / 이어쓰기 모두 백그라운드 UI 반영을 명시 실행합니다',
    '  - 현재 보고 있는 메인 대화 화면은 절대 바꾸지 않습니다',
    '  - 현재 작업영역과 일치하는 Bridge 인스턴스에만 연결합니다',
    '  - --resume 목록도 현재 작업영역 대화만 출력합니다',
    '  - 메시지는 하나의 positional 인자로만 받습니다. 공백이 있으면 반드시 따옴표로 감싸세요',
    '  - exec, resume, --no-wait 는 제거되었습니다',
  ].join('\n');
}

program.helpInformation = function helpInformation_func(): string {
  return buildRootHelp_func();
};
```

#### 커맨드 등록 변경

```diff
  registerStepControl(program, helpers_var);
  registerServer(program, helpers_var);
  registerAgent(program, helpers_var);
  registerCommands(program, helpers_var);
  registerUi(program, helpers_var);
- registerAutoRun(program, helpers_var);
```

### 8.2 `packages/cli/src/root-mode.ts`

#### `reserved_subcommands_var` / `legacy_subcommands_var`

```diff
  const reserved_subcommands_var = new Set([
    'accept',
    'reject',
    'run',
    'server',
    'agent',
    'commands',
    'ui',
-   'auto-run',
    'help',
  ]);

  const legacy_subcommands_var = new Set([
    'exec',
    'resume',
+   'auto-run',
  ]);
```

#### `hasRootOption_func`

루트 short/long 옵션을 동일하게 처리하도록 아래를 추가한다.
현재 코드에는 `json` 계열 옵션이 이 함수에 아예 없으므로, **`-j`와 `--json`을 둘 다 새로 추가**하는 것으로 고정한다.

```diff
+   token_var === '-j'
+   || token_var === '--json'
    || token_var === '-m'
    || token_var === '--model'
    || token_var === '-r'
    || token_var === '--resume'
+   || token_var === '-a'
    || token_var === '--async'
    || token_var === '--idle-timeout'
    || token_var === '--no-wait'
```

#### help/version 우회 조건

```diff
- if (argv_var.includes('-h') || argv_var.includes('--help') || argv_var.includes('-V') || argv_var.includes('--version')) {
+ if (argv_var.includes('-h') || argv_var.includes('--help') || argv_var.includes('-v') || argv_var.includes('--version')) {
```

#### `parseRootInvocation_func`

```diff
+     case '-j':
      case '--json':
        result_var.json_var = true;
        continue;
```

```diff
+     case '-a':
      case '--async':
        result_var.async_var = true;
        continue;
```

#### legacy redirect 오류

```diff
        if (legacy_subcommands_var.has(token_var)) {
          if (token_var === 'exec') {
            throw new Error('`exec` 서브커맨드는 제거되었습니다. `antigravity-cli "메시지"` 형식을 사용하세요.');
          }

+         if (token_var === 'auto-run') {
+           throw new Error('`auto-run`은 `server auto-run`으로 이동했습니다. 예: antigravity-cli server auto-run status');
+         }
+
          throw new Error('`resume` 서브커맨드는 제거되었습니다. `antigravity-cli --resume` 또는 `antigravity-cli --resume <uuid> "메시지"`를 사용하세요.');
        }
```

### 8.3 `packages/cli/src/commands/server.ts`

#### import 추가

```diff
+ import { registerUnder_func as registerAutoRun_func } from './auto-run.js';
```

#### description 변경

```diff
  const serverCmd_var = program
    .command('server')
-   .description('IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart)');
+   .description('IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)');
```

#### server help 문자열 고정

```typescript
function buildServerHelp_func(): string {
  return [
    'Usage: antigravity-cli server [options] [command]',
    '',
    'IDE 서버 관리 (status/prefs/diag/monitor/state/reload/restart/auto-run)',
    '',
    'Options:',
    '  -h, --help           display help for command',
    '',
    'Commands:',
    '  status               서버 연결 + 유저 상태',
    '  prefs                에이전트 설정 조회',
    '  diag                 시스템 진단 정보',
    '  monitor              실시간 이벤트 스트림 (Ctrl+C로 종료)',
    '  state [key]          내부 저장소 조회',
    '  reload               IDE 창 리로드',
    '  restart              언어 서버 재시작',
    '  auto-run             Always Proceed auto-run 패치 관리',
    '  help [command]       display help for command',
  ].join('\n');
}

serverCmd_var.helpInformation = function helpInformation_func(): string {
  return buildServerHelp_func();
};
```

#### `server auto-run` 등록 추가

`register()` 함수 마지막에서 아래를 호출한다.

```typescript
registerAutoRun_func(serverCmd_var, h);
```

### 8.4 `packages/cli/src/commands/auto-run.ts`

#### 시그니처 변경

```diff
- export function register(program: Command, h: Helpers): void {
-   const auto_run = program
+ export function registerUnder_func(parent_var: Command, h_var: Helpers): void {
+   const auto_run_var = parent_var
      .command('auto-run')
      .description('Always Proceed auto-run 패치 관리');
```

#### help 문자열 고정

```typescript
function buildAutoRunHelp_func(): string {
  return [
    'Usage: antigravity-cli server auto-run [options] [command]',
    '',
    'Always Proceed auto-run 패치 관리',
    '',
    'Options:',
    '  -h, --help           display help for command',
    '',
    'Commands:',
    '  status               패치 적용 상태 확인',
    '  apply                수동으로 패치 적용',
    '  revert               패치 원본 복원 (.ba-backup에서)',
    '  help [command]       display help for command',
  ].join('\n');
}

auto_run_var.helpInformation = function helpInformation_func(): string {
  return buildAutoRunHelp_func();
};
```

#### 등록 순서

현재 파일은 `status -> revert -> apply` 순서다.
목표 출력과 맞추기 위해 **정의 순서를 `status -> apply -> revert`로 바꾼다.**
핸들러 내용은 유지한다.

### 8.5 `packages/cli/src/commands/step-control.ts`

```diff
  program
-   .command('accept')
+   .command('accept', { hidden: true })
    .description('대기 중인 스텝 수락')

  program
-   .command('reject')
+   .command('reject', { hidden: true })
    .description('대기 중인 스텝 거부')

  program
-   .command('run')
+   .command('run', { hidden: true })
    .description('대기 중인 터미널 명령 실행')
```

### 8.6 `packages/cli/src/commands/ui.ts`

```diff
  const uiCmd_var = program
-   .command('ui')
+   .command('ui', { hidden: true })
    .description('Agent View UI 관리');
```

### 8.7 `packages/cli/test/help-surface.test.ts` 신규 생성

테스트 원칙:

- [ ] 이 파일이 help public spec의 source of truth 역할을 한다
- [ ] `contains` 중심이 아니라 **exact 비교**를 우선한다
- [ ] `stdout` 최종 newline까지 비교한다
- [ ] 기존 `phase10.test.ts`는 root mode 회귀 위주로 유지하고, help 표면 검증은 이 파일로 옮긴다

필수 테스트:

- [ ] `--help` exact 출력 비교
- [ ] `server --help` exact 출력 비교
- [ ] `server auto-run --help` exact 출력 비교
- [ ] `--help`에 `accept/reject/run/ui/auto-run/--idle-timeout`이 없는지 확인
- [ ] `--help` 모델 블록이 `documented_models_var` 순서와 같은지 확인
- [ ] `-a`가 `--async`와 동일하게 `create -> track` 흐름을 타는지 확인
- [ ] `-j --resume`이 JSON 구조를 출력하는지 확인
- [ ] `-v`가 버전 출력 후 종료하는지 확인
- [ ] `antigravity-cli auto-run status`가 redirect 오류를 내는지 확인
- [ ] `antigravity-cli server auto-run status`가 `/api/auto-run/status`를 호출하는지 stub 서버로 확인

테스트 뼈대:

```typescript
const expected_root_help_var = `Usage: antigravity-cli [options] [message]
...
`;

assert.equal(result_var.stdout, `${expected_root_help_var}\n`);
assert.equal(result_var.stderr, '');
assert.equal(result_var.status, 0);
```

### 8.8 root `README.md` 신규 생성

실제 root와 `packages/cli/` 둘 다 README가 없는 상태를 확인했으므로,
이번 작업은 **root `README.md` 신규 생성**으로 고정한다.
그리고 이 결정은 의도적이다.
이 저장소는 monorepo이지만, **사용자 관점의 진입점은 CLI** 이므로 README도 root에 두고 CLI를 전면에 내세운다.
대신 첫머리에서 monorepo 구성은 짧게 밝혀 혼동을 막는다.

오퍼스 문서의 좋은 점은 README를 “대충 쓴다”가 아니라 섹션 단위로 고정한 점이다.
이번 문서도 root README 구조를 아래처럼 고정한다.

~~~markdown
# antigravity-cli

이 저장소는 `packages/sdk`, `packages/extension`, `packages/cli`를 포함한 monorepo입니다.
하지만 실제 사용자 진입점은 CLI이므로, root README도 CLI 사용법을 중심으로 설명합니다.

## 저장소 구성

- `packages/sdk` — 로컬 포크 SDK
- `packages/extension` — Bridge VS Code extension
- `packages/cli` — `antigravity-cli`

## 설치

### 저장소 의존성 설치
```bash
npm install
```

### CLI 직접 실행
```bash
node --import tsx packages/cli/bin/antigravity-cli.ts --help
```

### CLI 빠른 실행 (검증 완료, 선택 사항)
```bash
bun packages/cli/bin/antigravity-cli.ts --help
```

## CLI 사용법

```text
(§6.1 top-level --help 전체 출력 그대로)
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
| `server auto-run status|apply|revert` | auto-run 패치 관리 |

### agent

| 서브커맨드 | 설명 |
|------------|------|
| `agent workflow [--global]` | 워크플로우 생성 |
| `agent rule` | 규칙 생성 |

### commands

| 서브커맨드 | 설명 |
|------------|------|
| `commands list` | 내부 명령어 목록 |
| `commands exec <cmd> [args...]` | 내부 명령 직접 실행 |

## 구현됨 / 추후 공식 지원 예정

아래 명령/옵션은 구현되어 있으나 현재 default `--help`에는 노출되지 않습니다.

| 명령/옵션 | 설명 | 비고 |
|-----------|------|------|
| `accept` | 대기 중인 스텝 수락 | auto-run ON이면 일반 사용자가 직접 누를 일이 거의 없음 |
| `reject` | 대기 중인 스텝 거부 | auto-run ON이면 일반 사용자가 직접 누를 일이 거의 없음 |
| `run` | 대기 중인 터미널 명령 실행 | auto-run ON이면 일반 사용자가 직접 누를 일이 거의 없음 |
| `ui install` | Agent View UI 요소 설치 | 내부/유지보수 성격이 강함 |
| `--idle-timeout <ms>` | 루트 대화 모드 idle timeout | 고급 사용자용 디버그성 옵션 |
~~~

필수 포함 항목:

- [ ] 프로젝트 한 줄 설명
- [ ] monorepo 루트 소개 섹션
- [ ] CLI public help surface 섹션
- [ ] §6.1 top-level help block 그대로 포함
- [ ] 구현된 모든 커맨드 목록
- [ ] 구현된 모든 플래그 목록
- [ ] 숨김 커맨드/옵션 목록 + 비고 컬럼
- [ ] `auto-run`이 `server auto-run`으로 이동했다는 설명
- [ ] `accept`, `reject`, `run`, `ui`, `--idle-timeout`은 구현되어 있으나 default help에서는 숨겨졌다는 설명
- [ ] “일부 구현은 추후 공식 지원 예정” 문구

---

## 9. 테스트 순서

### 9.1 자동 테스트

```bash
npm -w packages/cli test
```

이 한 번으로 아래가 통과해야 한다.

런타임 기준:

- [x] `packages/cli/package.json`의 test 스크립트는 `node --import tsx --test ...` 이다
- [x] 기존 `phase10.test.ts`도 `process.execPath` + `--import tsx` 로 CLI를 spawn 한다
- [x] 따라서 **help spec의 기준 런타임은 node + tsx** 로 통일한다
- [x] `bun packages/cli/bin/antigravity-cli.ts --help` 는 보조 smoke check로만 취급한다

- [ ] 기존 `model-resolver.test.ts`
- [ ] 기존 `phase10.test.ts`
- [ ] 신규 `help-surface.test.ts`

### 9.2 수동 확인

자동 테스트와 같은 런타임 경로를 쓰기 위해, 수동 확인도 `node --import tsx`를 기준으로 한다.

```bash
node --import tsx packages/cli/bin/antigravity-cli.ts --help
node --import tsx packages/cli/bin/antigravity-cli.ts server --help
node --import tsx packages/cli/bin/antigravity-cli.ts server auto-run --help
node --import tsx packages/cli/bin/antigravity-cli.ts -v
node --import tsx packages/cli/bin/antigravity-cli.ts -j --resume
node --import tsx packages/cli/bin/antigravity-cli.ts -a "테스트 메시지"
node --import tsx packages/cli/bin/antigravity-cli.ts auto-run status
node --import tsx packages/cli/bin/antigravity-cli.ts server auto-run status
```

수동 확인 체크리스트:

- [ ] top-level help가 §6.1과 정확히 같은지
- [ ] `server --help`가 §6.2와 정확히 같은지
- [ ] `server auto-run --help`가 §6.3과 정확히 같은지
- [ ] `-v`는 정상 동작하고 `-V`는 공식 지원하지 않는지
- [ ] `-j`가 JSON 출력으로 동작하는지
- [ ] `-a`가 async로 동작하는지
- [ ] top-level `auto-run`이 redirect 오류를 내는지
- [ ] `server auto-run status`가 기존 상태 조회를 수행하는지

### 9.3 작업 기록 반영

오퍼스 문서의 좋은 점 중 하나는 “구현 끝나면 문서/커밋까지 닫는다”가 분명하다는 점이다.
이번 계획도 아래를 완료 조건에 포함한다.

- [ ] 구현 완료 후 `plan.md`에 Phase 11 또는 대응 항목으로 반영
- [ ] 구현 완료 후 `handoff.md`에 현재 help surface 변경 내용 반영
- [ ] 작업 단위 커밋 수행

---

## 10. 리스크와 방지책

### 리스크 1. exact help 문자열과 실제 출력이 어긋남

방지책:

- [ ] help 문자열을 commander 기본 렌더링 추론에 맡기지 않는다
- [ ] `helpInformation()` override로 exact 문자열을 직접 반환한다
- [ ] `help-surface.test.ts`에서 exact 비교를 건다

### 리스크 2. `auto-run`이 root mode 메시지로 오인됨

방지책:

- [ ] `reserved_subcommands_var`에서 `auto-run` 제거
- [ ] `legacy_subcommands_var`에 추가
- [ ] redirect 오류 테스트를 추가한다

### 리스크 3. 숨김 커맨드가 다시 help에 섞여 나옴

방지책:

- [ ] `{ hidden: true }` 사용
- [ ] top-level custom help에는 아예 넣지 않는다
- [ ] `help-surface.test.ts`에 미노출 검증을 둔다

### 리스크 4. commander 버전 혼동으로 잘못된 API를 다시 쓰게 됨

방지책:

- [ ] 이 문서 §2에 root 4.1.1 / CLI 12.1.0 이중 구조를 명시한다
- [ ] 이후 구현 판단은 반드시 `packages/cli/bin/antigravity-cli.ts` 기준 런타임으로 한다

### 리스크 5. Examples / Root Mode 문구가 중복 출력됨

방지책:

- [ ] root `addHelpText('after', ...)` 제거
- [ ] custom help 문자열 안에 직접 포함
- [ ] `--help` exact 비교 테스트로 중복 여부를 잡는다

---

## 11. 범위 제외

이번 문서 범위에 포함하지 않는 항목은 아래와 같다.

- `accept`, `reject`, `run`, `ui` 기능 삭제
- `commands` 기능 축소 또는 권한 제한
- `server state/reload/restart` 공개 범위 재설계
- root mode UX 자체 재설계
- Extension 빌드 / `.vsix` 재패키징
- `plan.md` / `handoff.md` 대규모 재작성

---

## 12. 최종 구현 순서

아래 순서를 그대로 따른다.

- [ ] 1. `help-surface.test.ts` 먼저 작성
- [ ] 2. `auto-run.ts`를 parent command 하위 registrar로 변경
- [ ] 3. `server.ts`에서 `server auto-run` 연결 + help 문자열 고정
- [ ] 4. `antigravity-cli.ts`에서 `-a/-j/-v` 지원 및 root help exact 렌더링
- [ ] 5. `root-mode.ts`에 `-a/-j/-v`와 top-level `auto-run` redirect 반영
- [ ] 6. `step-control.ts`, `ui.ts` help 숨김
- [ ] 7. root `README.md` 신규 작성
- [ ] 8. 전체 테스트 실행
- [ ] 9. 수동 help/CLI 확인
- [ ] 10. `plan.md`, `handoff.md` 반영
- [ ] 11. 작업 단위 커밋 (`refactor: CLI help 정리 — 약어 추가, auto-run → server 하위 이동, 내부 커맨드 help 숨김`)

---

## 13. 최종 규칙

이번 작업은 기능을 지우는 작업이 아니다.
이번 작업은 **public help surface를 다시 정의하고**, 숨길 기능은 숨기되 구현은 유지하며,
보여주는 help/README와 실제 CLI 동작을 일치시키는 작업이다.

따라서 구현자는 아래를 반드시 지켜야 한다.

- [ ] help에 보이면 실제로 동작해야 한다
- [ ] exact help 문자열은 테스트로 고정해야 한다
- [ ] `auto-run.ts`는 살리고 재사용해야 한다
- [ ] root `README.md`까지 포함해 public surface 문서를 같이 맞춰야 한다
