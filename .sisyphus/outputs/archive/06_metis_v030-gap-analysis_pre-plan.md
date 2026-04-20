# v0.3.0 Gap Analysis — spec+plan 사전 점검

> 출발 문서: handoff-plan-spec/v0.3.0-01-handoff.md
> 비교 기준: .sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md + 현재 src 코드

---

## Critical Gaps

### C-1. `auth refresh` 명령이 현재 코드에 존재하지 않음
- handoff [1]에서 `auth refresh = 전체 동기화`, `auth list = 카드 기반 빠른 조회`로 분리한다.
- 현재 코드는 `auth list`만 있고, 내부에서 Cloud Code API 조회를 수행한다.
- **gap**: `auth refresh` 명령 진입점(main.ts detectRootCommand, parseArgv), 라우팅, 별도 핸들러가 전혀 없다.
- plan에 반드시 포함해야 함: `detectRootCommand_func` 확장 → `auth refresh` 분기 + `handleAuthRefresh_func` 신규.

### C-2. `auth list`의 "카드 기반 빠른 조회 + 선택적 갱신" 로직이 미구현
- handoff [1-3]에서 `auth list`는 기본적으로 캐시된 카드만 읽고, 오래된/불확실한 id만 선택적으로 갱신한다.
- 현재 `handleAuthList_func`(main.ts)는 모든 계정에 대해 `quotaClient.fetchQuotaForAccounts_func`를 호출한다.
- **gap**: selective refresh 로직(5h 초과, 실패 이력, null quota, reset 경과, offline-only 미검증 계정 판정)이 plan에 구체적으로 들어가야 한다.

### C-3. rotate가 "응답 후"가 아니라 "응답 전"에 실행됨
- handoff [3] "대답 먼저, rotate 판단은 응답 직후"가 핵심 원칙.
- 현재 main.ts에서 `decideAndPersistAutoRotate_func` 호출이 **L2463** (LS spawn 전, 대화 실행 전)에 위치한다.
- **gap**: 현재 코드는 rotate를 pre-response에 평가하고 있다. handoff 의도대로라면 post-response(observeAndAppendSteps 완료 후)로 이동해야 한다.
- plan에서 `decideAndPersistAutoRotate_func` 호출 위치를 post-chat으로 변경하는 구현 지시가 필요하다.

### C-4. wake-up이 main.ts 오케스트레이션에 전혀 연결되어 있지 않음
- handoff [W]에서 wake-up은 (1) auth refresh 시 미시작 계정 발견, (2) rotate 후 switch한 새 계정이 미시작, (3) 프롬프트 시작 전 background에 실행.
- 현재 `wakeup.ts`는 순수 필터/업데이트 유틸리티 함수만 제공하고, main.ts에 import조차 되지 않는다.
- **gap**: wake-up 실행 경로(auth inject → LS spawn → 1턴 → 종료)를 구현하는 서비스 함수 + main.ts 훅 연결이 plan에 필요하다.

### C-5. post-chat "현재 계정 fresh quota 재조회" 로직이 없음
- handoff [4]에서 응답 종료 후 현재 계정의 fresh quota를 다시 읽어 카드를 갱신한다.
- 현재 코드는 pre-chat에만 quota를 조회하고, post-chat에는 아무것도 하지 않는다.
- **gap**: `observeAndAppendSteps_func` 완료 후 → `quotaClient.fetchQuotaForAccounts_func` (current account only) → 카드 갱신 단계가 plan에 필요.

### C-6. pre-chat "background quick check + background wake-up" 로직이 없음
- handoff [W-2-3]에서 프롬프트 시작 전에 현재 계정 카드 quick check와 미시작 계정의 background wake-up이 허용된다.
- 현재 main.ts에는 이 경로가 전혀 없다.
- **gap**: main.ts의 chat 진입 경로(handleLivePath_func, runOfflineSession_func 호출 전)에 background pre-check 훅을 추가하는 지시가 필요.

### C-7. `pending-switch.json`에 fingerprint_id, serviceMachineId 미포함
- handoff [9]에서 switch 기록에 fingerprint id, serviceMachineId가 포함된다.
- 현재 `PendingSwitchIntent`(rotate.ts L14-19)는 `target_account_id`, `source_account_id`, `reason`, `decided_at`만 있다.
- **gap**: pending-switch 구조 확장 + switch 실행 시 fingerprint_id/serviceMachineId도 inject에 반영하는 로직이 plan에 필요. 다만 v0.2.1 NOT NOW에서 fingerprint는 v0.2.2+이므로, 이것을 NOT NOW로 명시할지 plan에 넣을지 결정 필요.

---

## Minor Gaps

### M-1. 99% 보정 규칙의 범위 불명확
- handoff [1-2]와 현재 authList.ts L90의 `isStale → 99%` 보정은 존재하지만, v0.3.0에서 "reset 시각이 지난 계정" 판정을 어디서 수행하는지가 auth list 서비스에만 있는지, quota client에도 있는지 불명확.
- plan에서 이 보정이 authList 표시 레이어에만 있는지, quota 데이터 레이어에도 반영되는지 명시하면 좋음.

### M-2. Offline-Gateway 경로가 handoff에만 있고 plan에서 제외 가능
- handoff [4-(1)]의 "Offline-Gateway" 경로는 아직 존재하지 않는 기능에 대한 전망이다.
- v0.3.0 범위에서 NOT NOW로 명시하면 plan이 간결해진다.

### M-3. 모델 family 판정 로직이 main.ts에 하드코딩됨
- main.ts L1079-1083에서 `model.toLowerCase().includes('claude')` 기반 판정.
- 이 로직이 handoff [5]의 "기본은 Claude, 명확히 Gemini일 때만 Gemini"와 일치하지만, `gemini-3.1-pro-high` 같은 모델명이 `gemini`를 포함하므로 패턴은 맞음. 다만 이 판정을 rotate.ts에서 재사용할 수 없는 구조.
- plan에서 model→family 해석 유틸 함수를 별도로 둘지 결정 필요.

### M-4. accounts.json에서 `needs_reauth` 상태의 계정을 rotate에서 제외하는 로직 확인
- rotate.ts L123에서 `forbidden, disabled, protected`만 제외하고 `needs_reauth`는 제외하지 않음.
- handoff [8]과 v0.2.1 plan §6-6에서 `needs_reauth`는 제외 대상임.
- **코드 버그 가능성**: `needs_reauth` 계정이 rotate 후보에 올라갈 수 있음.

### M-5. `auth refresh`의 wake-up 후보 표시 vs 실제 실행 구분
- handoff [W-2-1]에서 "auth refresh는 wake-up 대상을 표시만 한다"와 실제 wake-up 실행의 타이밍이 다름.
- plan에서 "표시" 단계와 "실행" 단계를 명확히 분리할 것.

---

## Recommended Defaults

### D-1. NOT NOW에 들어가야 할 항목 (v0.3.0 범위 밖)
- **Offline-Gateway** (handoff [4-(1)]): 아직 존재하지 않는 기능
- **Device Fingerprint 자동 교체** (handoff [9]의 fingerprint_id): v0.2.2+ 연속
- **Background Daemon (cron/launchd 주기적 wake-up)**: handoff [W] 보조 타이밍 중 "명시적 명령"도 NOT NOW
- **YAML 정책 엔진**: handoff에 명시적 언급 없지만 v0.2.1 NOT NOW에서 이어짐
- **USS re-push 경로 C**: Seamless Switch 실험 중 불확실 경로
- **serviceMachineId 자동 교체**: pending-switch에 포함은 하되, 자동 생성은 NOT NOW

### D-2. 성공조건에 반드시 들어가야 할 항목 (handoff 기준)
- auth refresh: 모든 계정 cloud quota 조회 + 카드 최신화 + 5h 미시작 계정 wake-up 표시
- auth list: 캐시된 카드 즉시 표시 + 오래된/불확실 id만 선택 갱신
- pre-chat: 현재 계정으로 바로 실행, background 작업이 첫 응답을 막지 않음
- post-chat: 현재 계정 fresh quota 재조회 + 카드 갱신 + threshold crossing 판단 + rotate(즉시 switch)
- wake-up: switch 후 새 계정이 미시작이면 background wake-up
- 73%→64% rotate, 67%→64% 재rotate 아님
- bucket 기록으로 같은 구간 반복 방지
- Pro 20% 미만 절대 금지, Ultra 10% 후순위
- pending-switch.json에 토큰 원문 없음

### D-3. plan checklist 구체성 기준
- handoff 사용자 요구: "당장 구현 가능한 수준의 파일/모듈 단위 지시"
- 각 checklist 항목은 최소 (1) 대상 파일, (2) 변경 성격(신규/수정/재작성), (3) 의존 모듈, (4) 관련 테스트 ID를 포함해야 함
- 특히 main.ts 변경은 줄번호 대신 함수명 기준으로 지시(줄번호는 코드 변동으로 곧 무효)

### D-4. 기존 v0.2.1 구현과의 충돌 지점
- `handleAuthList_func` (main.ts): 현재 전체 조회 → selective refresh로 로직 교체 필요
- `decideAndPersistAutoRotate_func` (main.ts L2463): 호출 위치를 post-chat으로 이동
- `PendingSwitchIntent` (rotate.ts): fingerprint_id, serviceMachineId 필드 추가 검토
- rotate.ts L123: `needs_reauth` 제외 누락 수정
