# v0.3.0 통합 spec+plan 검증 결과

## Critical Issues

1. **seamlessSwitch.ts가 plan checklist에 완전 누락됨**
   - `src/services/seamlessSwitch.ts` (974 bytes) + `seamlessSwitch.test.ts` (951 bytes)가 이미 존재하나, plan §9-3의 12개 checklist 항목 중 어디에도 등장하지 않는다.
   - 이 모듈은 live attach / plugin transport / USS push path를 평가해 seamless switch feasibility를 판단하는 코드다.
   - handoff [9]에서 "switch는 그 시점에 바로 수행"이라고 했고, plan §5-10에서도 "live attach 상태에서는 restart-needed 계약과 함께 서술"이라고 했으나, seamlessSwitch 모듈은 이 계약의 실제 구현체다.
   - Checklist에 `seamlessSwitch.ts` 보강 항목이 있어야 한다. 최소한 "experimental vs unsupported 판정 로직이 switch 적용 흐름과 연결되는지" 검증이 필요하다.

2. **rotate.ts의 90% bucket reset 코드가 여전히 살아 있음 (plan은 "제거"라고 함)**
   - `rotate.ts` L103: `currentRemainingPct_var !== null && currentRemainingPct_var >= 90 ? null : currentAccount_var.familyBuckets[bucketKey_var] ?? null`
   - `rotate.ts` L107-109: `if (currentRemainingPct_var !== null && currentRemainingPct_var >= 90) { updatedCurrentAccount_var.familyBuckets[bucketKey_var] = null; }`
   - plan §5-15 bucket 규칙 표와 checklist #5 모두 "90% reset 제거"라고 명시했으나, 실제 코드 베이라인을 보면 이 로직이 아직 살아 있는 상태에서 "제거"를 지시해야 한다.
   - Checklist #5의 "해야 할 일"에 구체적인 라인 범위나 함수명(`thresholdBucket_func` 내 90% 분기, `decideAutoRotate_func` 내 90% 리셋 블록)을 명시해야 구현자가 정확히 타격할 수 있다.

3. **rotate.ts candidate filter에 `needs_reauth`가 빠져 있음**
   - `rotate.ts` L123: `.filter((account_var) => !['forbidden', 'disabled', 'protected'].includes(account_var.accountStatus))`
   - handoff [8]과 plan §5-7 모두 "재로그인 필요한 계정"을 rotate 후보에서 제외한다고 했으나, 현재 코드의 filter list에 `needs_reauth`가 없다.
   - Checklist #5는 이 문제를 인지하고 "rotate 후보에서 needs_reauth 제외"를 썼으나, 구체적인 라인(L123)을 명시하지 않아 구현자가 찾아야 한다.

4. **PendingSwitchIntent 스키마가 plan 계약과 불일치**
   - 현재 `rotate.ts`의 `PendingSwitchIntent` 인터페이스 (L14-19):
     ```ts
     target_account_id, source_account_id, reason, decided_at
     ```
   - plan §5-8에서 요구하는 필드:
     ```
     target_account_id, source_account_id, crossing reason, pre/post quota 요약,
     decided/applied timestamp, fingerprint id, serviceMachineId 식별 정보
     ```
   - 누락: `pre/post quota 요약`, `applied timestamp` (현재는 `decided_at` 하나뿐), `fingerprint id`, `serviceMachineId`
   - Checklist #5는 "pre/post quota snapshot 필드와 fingerprint/serviceMachineId 메타 필드 추가"라고 썼으나, 이것은 **인터페이스 스키마 변경**임을 명시해야 한다. 단순 "추가"가 아니라 `PendingSwitchIntent` 타입 정의 자체를 확장하는 작업이다.

5. **decideAndPersistAutoRotate_func이 pre-response 위치에 있음 — plan은 post-prompt 이동을 요구**
   - `main.ts` L2463: `decideAndPersistAutoRotate_func`이 live LS discovery **이전**에 호출된다.
   - handoff [3]: "먼저 rotate를 판단하지 않는다. 이번 턴은 이미 정해져 있는 current account로 바로 실행한다."
   - plan checklist #6: "rotate 호출 위치를 post-prompt로 이동"이라고 정확히 지적했으나, 이동 대상 위치(observeAndAppendSteps 완료 후? cleanup 전?)를 명시하지 않는다.
   - 3557줄짜리 main.ts에서 "어디로 이동하라"는 지시 없이 "post-prompt로 이동"만 쓰면 구현자가 탐색 비용을 크게 치른다.

6. **auth refresh 명령 표면이 main.ts에 전혀 없음 — 신규 진입점 필요**
   - `main.ts`의 auth subcommand 분기에서 `auth refresh` 경로가 존재하지 않는다.
   - 현재 `grep -n "auth refresh\|authRefresh\|handleAuthRefresh"` 결과가 모두 무관한 token refresh 문맥뿐이다.
   - Checklist #1은 이것을 정확히 지적하지만, "신규 진입점"이라는 표현 대신 어디에 추가할지(detectRootCommand_func 분기, handleAuthCommand_func 확장 등)를 구체화해야 한다.

## Minor Issues

1. **auth list의 "selective refresh" 세부 판정 로직이 코드에 아직 없음**
   - plan §5-3에서 "오래된 계정"과 "불확실한 계정"의 판정 기준을 정의했으나, 이 판정을 수행하는 함수가 현재 코드에 존재하지 않는다.
   - Checklist #3에서 "오래된/불확실한 계정만 selective refresh"라고 했으나, 이 판정 함수를 어디에 정의할지(authList.ts? quotaClient.ts? 신규 모듈?)가 불명확하다.

2. **wakeup.ts가 2551 bytes로 매우 작음 — 실제 LS 1턴 실행 로직이 없음**
   - `wakeup.ts`는 sleeping account 필터링 유틸만 있고, plan §5-9-a에서 요구하는 "대상 계정으로 LS 1턴 실행" 오케스트레이션이 없다.
   - Checklist #9가 이것을 인지하고 "LS 1턴 실행 orchestration 추가"라고 했으나, LS 1턴 실행은 `runOfflineSession_func` 수준의 복잡도를 가진다. 이 정도 복잡도면 checklist 항목 하나로는 부족할 수 있다.

3. **effective family 판정이 main.ts에 하드코딩되어 있음**
   - `main.ts` L1079-1083: `model?.toLowerCase().includes('claude') ? 'CLAUDE' : model?.toLowerCase().includes('gemini') ? 'GEMINI' : null`
   - plan §5-5: "기본값은 CLAUDE, 사용 모델이 명확히 Gemini 계열일 때만 GEMINI"
   - 현재 코드는 null fallback인데, plan은 "기본값 CLAUDE"라고 함. null과 'CLAUDE'의 차이가 실제 동작에 영향을 미치는지 확인 필요.

4. **fingerprint 준비 흐름이 authLogin.ts에 아직 없음**
   - plan §5-10, checklist #8: "auth login 시점에 fingerprint를 생성/준비"
   - `authLogin.ts` (16164 bytes)에 fingerprint 생성 로직이 존재하는지, 아니면 전혀 새로 넣어야 하는지 plan이 명시하지 않는다.
   - fingerprint의 구체적 형식(랜덤 UUID? 브라우저 fingerprint? 디바이스 ID?)이 정의되지 않았다.

5. **serviceMachineId의 출처와 적용 방식이 불명확**
   - plan §5-10: "switch 시 auth + fingerprint + serviceMachineId 동시 적용"
   - `authInject.ts` (6730 bytes)에 serviceMachineId 관련 코드가 있는지, 아니면 새로 추가해야 하는지 불명확하다.
   - "serviceMachineId가 무엇인지" (Antigravity LS startup metadata의 field #27 id? 별도 머신 식별자?)에 대한 정의가 plan에 없다.

6. **NOT NOW에 "Offline-Gateway 완전한 제품화"가 있으나, checklist #10은 "최소 동작경로"를 다룸**
   - NOT NOW에는 "Offline-Gateway의 완전한 제품화"가 있고, checklist #10은 "최소 동작경로 계획 반영"이다.
   - 이 둘의 경계가 명확하지 않다. "최소 동작경로"가 NOT NOW 경계 안에 들어가는지, 밖에 있는지 불명확하다.
   - handoff의 "Offline-Gateway 제품화, fingerprint 자동화는 성급히 NOT NOW로 잠그지 않는다"는 사용자 요구와 모순될 여지가 있다.

7. **legacy → v0.3.0 migration 섹션이 spec에 있으나 checklist에 구현 항목이 없음**
   - plan §5-14에서 "accounts.json이 authoritative 저장소가 되는 시점", "legacy auth.json, user-data/user-* import", "migration 실패 시 rollback"을 언급했으나, checklist에 migration 관련 항목이 없다.
   - 이것이 "이번 버전에서 구현"인지 "문서만"인지 불명확하다.

8. **checklist 항목 간 실행 순서 의존성이 명시되지 않음**
   - Checklist #1(auth refresh 진입점)과 #2(auth refresh 동기화 흐름)는 당연히 #1이 먼저여야 하지만, 이 의존성이 명시되지 않았다.
   - #4(계정 카드 스키마)는 #2, #3, #5, #7, #8, #9 모두에 선행될 가능성이 높으나 명시되지 않았다.
   - #12(테스트)는 모든 구현 항목 이후여야 하지만, TDD 원칙상 먼저 작성되어야 할 수도 있다.

## Approved Decisions

1. **refresh/list 역할 분리**: handoff [1]의 핵심 주장을 정확히 반영했다. auth refresh는 전체 동기화, auth list는 빠른 조회로 분리하는 방향이 올바르다.

2. **90% 회복 reset 폐기**: 사용자가 명시적으로 거부한 규칙이며, plan에서 정확히 반영했다. 다만 코드에서 아직 살아 있으므로 구현 시 제거가 필요하다(위 Critical #2 참조).

3. **pending-switch.json을 "적용 기록"으로 정의**: handoff [9]의 사용자 정정("예약 메모가 아니다, 이미 바꿨다")을 정확히 반영했다. §5-8-a 생명주기 서술도 명확하다.

4. **기준 family 기본값 CLAUDE**: handoff [5]와 일치한다.

5. **wake-up 정의**: "5h usage cycle 미시작 계정의 타이머를 앞당기는 기능"이라는 handoff [W]의 핵심 맥락이 정확히 보존되었다.

6. **source priority 계약**: live LS → state.vscdb → cloud direct 순서는 handoff [4-(1)]과 일치한다.

7. **command × runtime path × allowed side-effects 표 (§5-12)**: handoff의 W(2-1)~(2-4) 타이밍을 표로 정리한 것이 매우 유용하다. 구현자가 각 경로별 허용 동작을 한눈에 볼 수 있다.

8. **NOT NOW 항목**: "정책엔진/YAML"만 확실한 NOT NOW로 잠근 것은 사용자 요구("성급히 NOT NOW로 잠그지 않는다")와 일치한다.

9. **성공조건 이중 구조**: 제품 동작(§6-1) + 구현 검증(§6-2)으로 분리한 것이 구현과 QA 모두에 유용하다.

10. **근거표 (§8)**: 각 정책의 출처를 명시한 것이 추적에 유용하다.
