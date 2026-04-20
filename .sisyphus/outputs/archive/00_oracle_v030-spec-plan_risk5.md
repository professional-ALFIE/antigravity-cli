# v0.3.0 통합 spec+plan 작성 시 구조상 가장 위험한 누락 5개

## 읽은 범위
- .sisyphus/mandate_v030-spec-plan.md
- .sisyphus/drafts/v030-spec-plan.md
- handoff-plan-spec/v0.3.0-01-handoff.md
- .sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md
- src/services/accounts.ts
- src/services/authList.ts
- src/services/quotaClient.ts
- src/services/rotate.ts
- src/services/wakeup.ts
- src/services/authInject.ts
- src/services/authLogin.ts
- src/services/oauthClient.ts

## 1. `pending-switch.json`의 **의미와 생명주기 재정의** 섹션 누락
### 왜 위험한가
- handoff는 `pending-switch.json`을 **"다음에 바꾸자" 메모가 아니라, 지금 이미 적용된 switch의 기록**으로 정의합니다.
- 그런데 현재 `src/services/rotate.ts`는 `PendingSwitchIntent`를 **deferred intent**로 다루고, `loadPendingSwitchIntent_func()` / `savePendingSwitchIntent_func()` / `clearPendingSwitchIntent_func()`로 **다음 실행에서 재적용**하는 구조입니다.
- 이 차이를 문서에서 별도 섹션으로 못 박지 않으면, 구현자가 기존 intent replay 구조를 유지한 채 handoff 문장을 일부만 반영해서 **pre-turn replay / post-turn immediate switch가 뒤섞인 하이브리드 동작**을 만들 가능성이 큽니다.

### 문서에 반드시 들어가야 할 것
- v0.3.0에서 `pending-switch.json`이 **intent**인지 **applied record**인지 단일 정의
- 생성 시점, 삭제 시점, 재실행 시 읽는지 여부
- 포함 필드: `target_account_id`, `source_account_id`, crossing reason, pre/post quota snapshot, `fingerprint_id`, `serviceMachineId`, `applied_at`
- 금지 필드: raw auth token
- 기존 `rotate.ts` intent 모델에서 어떻게 이행할지 plan 항목

## 2. **source-of-truth / write-order / secret boundary 표** 누락
### 왜 위험한가
- 현재 상태는 최소 5곳으로 분산됩니다.
  - `accounts.json`: 현재 계정 index
  - `accounts/{id}.json`: quota cache, rotation, wake-up history, token
  - `cache/quota/{id}.json`: fetch 결과 캐시
  - `state.vscdb`: 실제 inject 대상
  - `pending-switch.json`: 전환 기록/의도
- 특히 `src/services/quotaClient.ts`의 `QuotaCacheValue`에는 `refreshedToken`이 포함되어 있고, 이 값이 그대로 캐시 파일에 저장됩니다. 즉 **"토큰은 account store만 가진다"**는 규칙을 문서가 명확히 정하지 않으면 cache까지 토큰 저장소가 되어 버립니다.
- `src/services/authInject.ts`는 `state.vscdb`를 직접 바꾸고, `src/services/accounts.ts`는 별도 JSON을 갱신합니다. 어떤 쓰기가 먼저 성공해야 하고 실패 시 무엇을 rollback/보정하는지 없으면 **부분 성공 상태**가 생깁니다.

### 문서에 반드시 들어가야 할 것
- 파일별 책임 1표: “무엇의 진실 원본인가?”
- 명령별 write 순서 1표: refresh/list/select/send/post-turn rotate/wakeup
- 실패 시 보정 규칙: 어느 파일이 실패해도 어떤 파일을 재동기화할지
- secret boundary: token은 어디까지 저장 허용인지, cache에 저장 가능한지 여부
- 권한 정책: `0600`, atomic write 대상 파일 목록

## 3. **명령 × 런타임 경로(side-effect matrix)** 누락
### 왜 위험한가
- handoff는 “프롬프트 시작 전 rotate 선판단 금지, 응답 후 fresh quota 재조회 → crossing 판단 → 즉시 switch”를 강하게 요구합니다.
- 하지만 실제 런타임은 최소한 아래 축으로 갈립니다.
  - 명령: `auth refresh`, `auth list`, `agcl "prompt"`, `agcl -r <id> "prompt"`, read-only 명령
  - 경로: live attach / offline spawn / wake-up용 별도 LS 실행
- 현재 `authInject.ts`는 **DB만 바꾸고 live LS를 갱신하지 않습니다**. 즉 문서가 “즉시 바뀐다”처럼 쓰이면 live attach 상태에서 실제 UX와 어긋납니다.
- `wakeup.ts`는 아직 후보 선택/히스토리 갱신 helper 수준이고, 실제 orchestration은 main path에 걸려야 합니다. 문서가 hook point를 안 박아두면 구현 범위가 모호해집니다.

### 문서에 반드시 들어가야 할 것
- 표 형태로: command × runtime path × allowed side effects
- 각 셀에 아래 여부 명시
  - cloud fetch
  - local quick check
  - background wake-up
  - auth inject
  - restart-needed 메시지
  - post-turn rotate/switch
- 특히 live attach에서 “DB inject는 가능하지만 현재 live LS에 즉시 반영된다고 보장하지 않음” 같은 문구

## 4. **legacy → v0.3.0 계정 저장소 migration/cutover/rollback** 섹션 누락
### 왜 위험한가
- 현재 코드는 이미 신구 체계를 동시에 품고 있습니다.
  - `accounts.ts`는 `accounts.json`이 있으면 새 체계, 없으면 `auth.json` + `user-data/user-*`를 씁니다.
  - `authLogin.ts`는 로그인 전에 `importLocalFromStateDb_func()`로 legacy state DB들을 먼저 끌어옵니다.
- 즉 v0.3.0 문서가 migration 단계를 별도 섹션으로 고정하지 않으면, 구현 중간에 **새 index가 생긴 뒤 legacy 계정 발견 로직이 갑자기 우회**되어 일부 계정이 UI에서 사라지거나, active account 해석이 split-brain이 될 수 있습니다.

### 문서에 반드시 들어가야 할 것
- 최초 cutover 트리거: 언제 `accounts.json`을 authoritative로 간주하는지
- legacy import 순서와 dedupe 기준: email 기준 upsert, 같은 email 재로그인 정책
- rollback: 실패 시 `auth.json` / `user-data`를 어떻게 계속 존중할지
- 사용자 표면 계약: migration 후 어떤 파일은 읽기만 하고 어떤 파일은 더 이상 쓰지 않는지

## 5. **상태 전이 / 후보 제외 / 99% 보정 규칙의 canonical table** 누락
### 왜 위험한가
- handoff에는 아래 핵심 정책이 prose로 흩어져 있습니다.
  - reset 경과 계정의 99%는 **표시 보정**이지 cloud truth가 아님
  - `needs_reauth` 계정은 rotate/wake-up 후보에서 제외
  - CLAUDE를 기본 family로 보고, Gemini 모델일 때만 GEMINI 기준
  - 90% 회복 reset 같은 규칙은 넣지 않음
- 그런데 현재 `rotate.ts`는 **90% 이상이면 bucket을 null로 reset**하고, rotate 후보에서 `needs_reauth`를 제외하지 않습니다.
- `wakeup.ts`도 `forbidden/disabled/protected`만 제외하고 `needs_reauth`는 제외하지 않습니다.
- `authList.ts`의 99%는 purely display clamp입니다. 이 구분을 문서가 표로 못 박지 않으면 list/refresh/rotate/wakeup이 서로 다른 상태 모델로 구현됩니다.

### 문서에 반드시 들어가야 할 것
- `active / protected / forbidden / disabled / needs_reauth` 상태 전이표
- `fresh / stale / uncertain / wake-up target` 분류표
- 99% 보정의 정확한 의미: UI 표시인지, refresh 대상 신호인지, rotate 입력값인지
- rotate 후보 제외표: `needs_reauth` 포함 여부를 명시
- bucket 규칙 표: Ultra/Pro threshold, pre/post snapshot 비교, **no 90%-recovery reset** 명시

## 한 줄 결론
v0.3.0 문서에서 가장 위험한 누락은 개별 기능 설명보다, **상태 파일의 책임 분리 / switch 생명주기 / 명령별 side-effect / legacy cutover / 정책 canonical table**를 문서 구조로 못 박지 않는 것입니다. 이 다섯 개가 빠지면, 구현자가 같은 문서를 읽고도 서로 다른 시스템을 만들 가능성이 높습니다.
