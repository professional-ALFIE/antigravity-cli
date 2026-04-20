# v0.3.0 Spec + Plan: Auth Rotate & Wake-up

## TL;DR

> **Quick Summary**: 멀티 계정 자동 rotate + wake-up 오케스트레이션 + auth 명령 분리 + fingerprint 자동화 + Offline-Gateway 최소 동작경로. 응답 후 현재 계정의 quota 변화를 감지해 threshold crossing 시 다음 실행부터 자동으로 계정을 전환하고, 5h usage cycle이 시작되지 않은 계정을 미리 깨워 대기 시간을 줄인다. 각 계정의 device fingerprint를 자동으로 생성/적용하여 auth 무결성을 보장하고, offline-only 환경에서도 state.vscdb fast-path로 quota를 즉시 조회할 수 있게 한다.
> 
> **Deliverables**:
> - `auth refresh` 신규 명령 (전체 계정 cloud quota 강제 갱신 + wake-up)
> - `auth list` 경량화 (캐시 기반 표시, 오래된 계정만 병렬 선택적 갱신)
> - Account Card 지속 저장 파이프라인 (quota, bucket, wake-up 상태)
> - Post-response rotate 파이프라인 (응답 후 quota 재조회 → crossing 판단 → switch 기록)
> - Wake-up 오케스트레이션 (auth refresh, auth list, 프롬프트 시작 전/후 타이밍)
> - effectiveFamily 기본값 CLAUDE 고정
> - 90% bucket reset 제거
> - **Fingerprint 자동화 파이프라인** (auth login 때 생성, switch 때 자동 적용 + serviceMachineId 맞춤)
> - **Offline-Gateway 최소 동작경로** (offline-only에서도 state.vscdb fast-path로 quota 즉시 조회)
> 
> **Estimated Effort**: XL
> **Parallel Execution**: YES - 8 waves (1a, 1b, 2, 3a, 3b, 3c, 3d, Final)
> **Critical Path**: Task 1 → Task 5 → Task 6 → Task 9 → Task 12 → Task 13 → Task 10 → Final Verification

---

## Context

### Original Request
주인님이 작성한 `handoff-plan-spec/v0.3.0-01-handoff.md`에 명시된 v0.3.0 기능 전체 구현.

### Interview Summary
**Key Discussions**:
- **90% bucket reset**: handoff가 제거, 코드에 존재 → handoff 우선으로 코드에서 삭제 확정
- **effectiveFamily 기본값**: handoff가 CLAUDE 기본, 코드는 null → handoff 우선으로 CLAUDE 고정 확정
- **auth list UX**: 캐시된 카드를 먼저 읽고, 오래된 계정은 병렬로 갱신 후 전체 표시
- **switch 시점**: "다음 실행부터 적용". 프롬프트 종료 후 백그라운드에서 switch 기록
- **wake-up 타이밍**: 주인님이 정확히 4개 시점을 명시 (2-1~2-4)

**Metis Review Findings (CRITICAL)**:
- handoff의 "code gaps" 섹션이 부정확 — 6/10 기능에 이미 상당한 코드가 존재
- `rotate.ts`는 이미 bucket crossing + pending-switch + 후보 선정을 구현함 (재작성 금지, 확장만)
- `wakeup.ts`는 이미 후보 필터링 로직이 있음 (실행 경로만 추가)
- `accounts.ts`의 `AccountDetail`에 rotation/wakeup_history 필드가 이미 있음 (채우는 로직만 추가)
- **진짜 공백**: auth refresh 명령, wake-up 실행 오케스트레이션, post-response quota 재조회 파이프라인

### Resolved Conflicts (사용자 결정)
1. **90% bucket reset → 제거** (rotate.ts L107-109 삭제, rotate.test.ts R-9 테스트 수정)
2. **effectiveFamily → CLAUDE 기본** (main.ts L1079-1083 수정)
3. **auth list UX → 갱신 후 표시, 병렬 갱신** (오래된 계정 병렬 갱신 후 전체 표시)
4. **switch → 다음 실행부터 적용** (현재 세션 유지, accounts.json + pending-switch.json만 갱신)

---

## Work Objectives

### Core Objective
멀티 계정 환경에서 quota 사용량에 따라 자동으로 계정을 전환하고, 사용하지 않은 계정의 5h quota cycle을 미리 시작시켜 대기 시간을 최소화하는 시스템을 구축한다.

### Concrete Deliverables
- `src/services/quotaClient.ts` 확장: account card 저장 로직
- `src/services/authList.ts` 확장: 카드 기반 경량 경로 + 선택적 병렬 갱신
- `src/services/authRefresh.ts` 신규 (또는 main.ts 내 함수): `auth refresh` 명령 전체 파이프라인
- `src/services/rotate.ts` 확장: 90% reset 제거, post-response 파이프라인 연결
- `src/services/wakeup.ts` 확장: 실행 오케스트레이션 (open Antigravity → poll state.vscdb)
- `src/main.ts` 확장: auth refresh 라우팅, pre-prompt background, post-response rotate 파이프라인
- `src/services/accounts.ts` 확장: AccountDetail 필드 채우는 로직

### Definition of Done
- [ ] `bun test` 기존 181+ 테스트 + 신규 테스트 전부 통과
- [ ] `agcl auth refresh` → 전체 계정 cloud quota 갱신 + 카드 저장 + wake-up 후보 표시
- [ ] `agcl auth list` → 캐시 기반 표시, 오래된 계정만 병렬 갱신 후 전체 표시 (5초 이내)
- [ ] 응답 후 rotate 판단 → crossing 시 pending-switch.json 기록 → 다음 실행 시 새 계정 적용
- [ ] pending-switch.json에 auth token 원문 없음
- [ ] Wake-up: auth refresh, auth list, 프롬프트 시작 전, 프롬프트 종료 후 4개 시점 모두 구현
- [ ] effectiveFamily 기본값 CLAUDE
- [ ] 90% bucket reset 코드 제거
- [ ] Fingerprint 자동화: auth login 때 fingerprint 생성 + 저장, switch 때 자동 적용(serviceMachineId 포함)
- [ ] Offline-Gateway 최소 동작경로: offline-only에서도 state.vscdb fast-path로 quota 즉시 조회 가능

### Must Have
- `auth refresh` 명령: 전체 계정 cloud quota 강제 갱신 → account card에 저장
- `auth list` 경량화: 캐시된 카드 기반 표시, 오래된 id만 선택적 병렬 갱신
- Account Card 지속 저장: tier, GEMINI/CLAUDE 잔량, reset 시각, 마지막 조회 시각, 상태, threshold bucket, wake-up 상태
- 5h usage cycle 추적: all-null quota → cycle 미시작으로 간주
- Wake-up 오케스트레이션: 4개 타이밍 (auth refresh, auth list, pre-prompt, post-response)
- Post-response rotate: 응답 후 현재 계정 fresh quota 재조회 → crossing 판단 → switch 기록
- Bucket 영속화: 처리한 bucket을 card에 저장, 같은 구간 반복 rotate 방지
- 즉시 switch 기록: rotate 필요 시 accounts.json + pending-switch.json 갱신 (다음 실행부터 적용)
- Family 기본값: CLAUDE, 명확히 Gemini 계열일 때만 GEMINI
- Pro ≤20% 절대 사용 금지, Ultra ≤10% 가장 후순위
- 90% bucket reset 제거
- Fingerprint 자동화: auth login 때 시스템 fingerprint 캡처+저장, switch 때 자동 적용(serviceMachineId 맞춤 포함). cockpit `fingerprint.rs` 로직을 copy-paste 수준으로 가져와서 구현
- Offline-Gateway 최소 동작경로: offline-only에서도 state.vscdb fast-path로 quota 읽기. antigravity-cli offline-only 방식 + cockpit ClientGateway 방식 장점 합치기
- reset 시각 경과 → 99% 표시 보정 (이미 구현됨, 변경 없음)

### Must NOT Have (Guardrails)
- **rotate.ts 재작성 금지**: bucket crossing 로직은 이미 정상 동작. EXTEND만.
- **wakeup.ts 재작성 금지**: filter 로직은 이미 정상. 실행 경로만 추가.
- **accounts.ts 스키마 재설계 금지**: AccountDetail에 필요한 필드는 이미 있음. 채우는 로직만 추가.
- **~~Offline-Gateway 구현 금지~~ → v0.3.0에 최소 동작경로 포함 (Task 13)**
- **mid-session account switching 금지**: "다음 실행부터 적용" 원칙
- **pending-switch.json에 auth token 저장 금지**: access_token, refresh_token 절대 포함 불가
- **auth list에서 전체 계정 네트워크 갱신 금지**: 오래된/불확실한 계정만 선택적 갱신
- **90% 회복 reset 규칙 금지**: handoff에서 명시적 제거
- **Plugin Sync, ~~Device Fingerprint~~, Default backup**: NOT NOW (단 fingerprint 자동화는 Task 12로 포함)
- **exponential backoff, per-account rate limiting**: 과도한 엔지니어링

---

## Spec: 성공조건 (Success Criteria)

### SC-1: auth refresh
```
GIVEN: 5개 계정이 존재하고 quota_cache가 5시간 이상 오래됨
WHEN:  agcl auth refresh
THEN:  전체 5개 계정의 quota_cache가 cloud에서 갱신됨
  AND: auth list와 동일한 테이블 형식으로 출력됨
  AND: Wake-up 후보(all-null quota 계정)가 식별되어 표시됨
  AND: 각 계정의 카드에 tier, families, reset_time, cached_at, status가 저장됨
  AND: Wake-up 후보에 대해 백그라운드 wake-up이 시작됨
  AND: exit code 0
```

### SC-2: auth list 경량화 (2단계: 캐시 즉시 표시 → 선택적 병렬 갱신 → 재렌더)
```
GIVEN: 5개 계정 중 3개는 최신 카드(< 1h), 2개는 오래된 카드(> 5h)
WHEN:  agcl auth list
THEN:  **1단계**: 모든 계정의 캐시된 카드를 즉시 테이블로 표시 (0ms 대기)
  AND: **2단계**: 오래된 2개 계정을 병렬로 갱신 (fast-path 우선 → cloud API fallback)
  AND: **3단계**: 갱신된 카드로 재렌더링 (stale → fresh 전환)
  AND: 총 소요 시간 < 5초 (병렬 갱신 기준)
  AND: 네트워크 불가 시에도 1단계 캐시 표시 유지 (stale 마크 포함)
```

### SC-3: Account Card 지속 저장
```
GIVEN: agcl auth refresh 완료 후
THEN:  각 AccountDetail에 다음 필드가 채워짐:
  - quota_cache.subscription_tier: string | null
  - quota_cache.families: Record<string, {remaining_pct, reset_time}>
  - quota_cache.fetch_error: string | null
  - quota_cache.cached_at: number (Unix timestamp)
  - rotation.family_buckets: Record<string, string | null>
  - wakeup_history.last_attempt_at, last_result, attempt_count
```

### SC-4: 5h usage cycle 식별
```
GIVEN: Account A는 모든 family quota가 null, Account B는 일부 quota가 있음
WHEN:  filterWakeupCandidates_func 호출
THEN:  Account A는 wake-up 후보, Account B는 아님
```

### SC-5: Post-response rotate
```
GIVEN: 현재 계정이 턴 시작 시 73% (bucket=null)
  AND: 턴 종료 후 fresh read에서 64% (bucket='70')
WHEN:  decideAndPersistAutoRotate_func 실행
THEN:  pendingSwitch가 최적 후보로 생성됨
  AND: Account card의 family_buckets가 '70'으로 업데이트됨
  AND: 67%→64% (이미 '70' bucket에 있음)는 재rotate하지 않음
```

### SC-6: Bucket 영속화로 반복 방지
```
GIVEN: Account card에 family_buckets.GEMINI = '70' 저장됨
  AND: 현재 읽기에서 64% (여전히 '70' bucket)
WHEN:  decideAutoRotate_func 실행
THEN:  pendingSwitch = null (같은 bucket, 반복 없음)
```

### SC-7: Switch 흐름 (2단계: post-response에서 즉시 전환+기록 → 다음 실행 시 fingerprint 적용)
```
GIVEN: Rotate가 acc-1 → acc-2로 전환 결정
WHEN:  post-response rotate 판단 완료 (현재 세션 내에서 즉시 판단)
THEN:  **1단계 (현재 세션 — post-response에서 즉시 완료)**:
    a) accounts.json의 current_account_id를 acc-2로 즉시 변경
    b) pending-switch.json에 적용 기록 작성 (target/source/reason/decided_at/pre_turn_pct/post_turn_pct/bucket_crossed)
    c) 파일에 access_token, refresh_token 절대 미포함
  AND: 이 시점에서 계정 전환은 완료됨 — 다음 agcl 실행 시 acc-2로 동작
WHEN:  다음 agcl 실행 시 (새 세션 시작)
THEN:  **2단계 (startup — fingerprint 적용만)**:
    a) pending-switch.json을 읽어 "적용 기록"으로 인식 (삭제하지 않음, log로 유지)
    b) 대상 계정의 fingerprint를 load → state.vscdb에 적용
    c) fingerprint가 없으면 신규 생성 후 적용
  AND: pending-switch.json은 "이미 적용 완료된 기록"이므로 startup consumer는 읽고 skip
```

### SC-8: 후보 선정 규칙
```
GIVEN: 후보 풀에 Pro 18%, Ultra 8%, Pro 60%
WHEN:  후보 랭킹 실행
THEN:  Pro 18%는 제외 (≤20% 절대 금지)
  AND: Pro 60%가 1순위
  AND: Ultra 8%가 최후순위 (≤10%)
```

### SC-9: Reset 시각 경과 → 99%
```
GIVEN: Account card의 reset_time이 과거
WHEN:  agcl auth list 렌더링
THEN:  Progress bar에 "██████████ 99%" 표시
```
(이미 구현됨: authList.ts:110-111)

### SC-10: effectiveFamily 기본값
```
GIVEN: --model 플래그 없음, model이 null/undefined
WHEN:  rotation이 effectiveFamily를 평가
THEN:  effectiveFamily = 'CLAUDE' (null 아님, _min 아님)
```

### SC-11: Wake-up 4개 타이밍
```
GIVEN: 미시작 계정(all-null quota)이 존재함
WHEN:  (2-1) auth refresh 실행 → 미시작 계정 wake-up 시작됨
  AND: (2-2) auth list 실행 → 미시작 계정 wake-up 시작됨
  AND: (2-3) 프롬프트 시작 전 → 백그라운드로 미시작 계정 wake-up 시작됨
  AND: (2-4) 프롬프트 종료 후 → 백그라운드로 현재 계정 cloud 조회 → 카드 기록 → rotate 판단 → switch
THEN:  각 타이밍에서 wake-up이 올바르게 트리거됨
```

### SC-12: 90% bucket reset 제거
```
GIVEN: Account가 bucket='40'에서 95%로 회복됨
WHEN:  decideAutoRotate_func 실행
THEN:  family_buckets이 여전히 '40' (null로 초기화되지 않음)
  AND: 다시 40% 이하로 떨어져도 재rotate하지 않음
```

### SC-13: Fingerprint 자동화
```
GIVEN: 신규 managed 계정을 auth login으로 추가함
WHEN:  auth login 완료
THEN:  ~/.antigravity-cli/fingerprints/{accountName}.json에 시스템 fingerprint가 생성됨
  AND: fingerprint에 machineId, serviceMachineId, platformInfo가 포함됨

GIVEN: fingerprint가 생성된 계정으로 switch를 실행함
WHEN:  switch 실행 (pending-switch.json 소비)
THEN:  대상 계정의 fingerprint가 state.vscdb에 자동 적용됨
  AND: serviceMachineId가 fingerprint에 맞게 교체됨
  AND: 기존 auth inject(oauthToken, agentManagerInitState, antigravityOnboarding)과 함께 원자적으로 적용됨
```

### SC-14: Offline-Gateway 최소 동작경로
```
GIVEN: IDE가 실행 중이지 않은 상태 (offline-only path)
WHEN:  agcl auth list 실행
THEN:  state.vscdb에서 직접 quota를 읽어 표시 (LS spawn 없이)
  AND: all-null quota 계정은 "sleeping"으로 표시
  AND: wake-up이 필요한 계정은 LS 1턴 실행으로 5h cycle 시작

GIVEN: IDE가 실행 중인 상태 (live LS 존재)
WHEN:  agcl auth list 실행
THEN:  live LS의 state.vscdb에서 quota fast-path로 즉시 읽기
  AND: offline-only path와 동일한 형식으로 출력
```

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD (RED → GREEN → REFACTOR)
- **Framework**: bun test

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1a (Foundation — types, cleanup):
├── Task 1: AccountDetail 필드 활성화 + quota → card 저장 파이프라인 [unspecified-high]
└── Task 2: 90% bucket reset 제거 + effectiveFamily CLAUDE 고정 [quick]

Wave 1b (Depends on Task 1 — new command scaffold + fast-path):
├── Task 3: auth refresh 명령 scaffold [unspecified-high]
├── Task 4: auth list 경량화 (카드 기반 + 선택적 병렬 갱신) [unspecified-high]
└── Task 13: Offline-Gateway 최소 동작경로 (state.vscdb fast-path quota) [deep]

Wave 2 (Orchestration — wake-up + rotate 파이프라인):
├── Task 5: Wake-up 실행 오케스트레이션 [deep]
├── Task 6: Wake-up 4개 타이밍 통합 [unspecified-high]
├── Task 7: Post-response rotate 파이프라인 [deep]
└── Task 8: Switch 실행 (다음 실행 적용) + pending-switch.json 확장 [unspecified-high]

Wave 3a (Integration — main.ts 통합 + fingerprint):
├── Task 9: main.ts 통합: auth 라우팅 + pre-prompt + post-response [deep]
└── Task 12: Fingerprint 자동화 파이프라인 (생성+적용+serviceMachineId) [deep]

Wave 3b (Depends on Task 9, 12 — edge cases):
└── Task 10: 통합 테스트 + 엣지 케이스 [unspecified-high]

Wave 3c (Depends on Task 10 — docs):
└── Task 11: README/CHANGELOG 업데이트 [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (deep)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 5 → Task 6 → Task 9 → Task 12 → Task 10 → Final Verification
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 3, 4, 5, 7, 13 | 1a |
| 2 | — | 7, 9 | 1a |
| 3 | 1 | 6, 9 | 1b |
| 4 | 1 | 6, 9 | 1b |
| 5 | 1 | 6 | 2 |
| 6 | 3, 4, 5 | 9 | 2 |
| 7 | 1, 2 | 8, 9 | 2 |
| 8 | 7 | 9, 12 | 2 |
| 9 | 3, 4, 6, 8, 13 | 10 | 3a |
| 12 | 8 | 10 | 3a |
| 13 | 1 | 9 | 1b |
| 10 | 9, 12 | 11 | 3b |
| 11 | 10 | F1-F4 | 3c |

### Agent Dispatch Summary

- **Wave 1a**: 2 — T1 → `unspecified-high`, T2 → `quick`
- **Wave 1b**: 3 — T3 → `unspecified-high`, T4 → `unspecified-high`, T13 → `deep`
- **Wave 2**: 4 — T5 → `deep`, T6 → `unspecified-high`, T7 → `deep`, T8 → `unspecified-high`
- **Wave 3a**: 2 — T9 → `deep`, T12 → `deep`
- **Wave 3b**: 1 — T10 → `unspecified-high`
- **Wave 3c**: 1 — T11 → `quick`
- **FINAL**: 4 — F1 → `deep`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.

---

- [ ] 1. AccountDetail 필드 활성화 + quota → card 저장 파이프라인

  **What to do**:
  - `accounts.ts`의 `AccountDetail` 필드(`quota_cache`, `rotation`, `wakeup_history`)가 이미 정의되어 있음을 확인
  - `quotaClient.ts`의 fetch 결과를 `AccountDetail.quota_cache`에 저장하는 `saveAccountCard_func` 신규 작성
  - 매핑 규칙:
    - `loadCodeAssist` 결과의 `subscriptionTier` → `quota_cache.subscription_tier`
    - `fetchAvailableModels` 결과의 family별 `remaining_pct`, `reset_time` → `quota_cache.families`
    - 에러 → `quota_cache.fetch_error`
    - `Date.now()/1000` → `quota_cache.cached_at`
  - 기존 60s cache TTL 로직은 그대로 유지
  - `fetchQuotaForAccounts_func`가 각 계정 결과를 `saveAccountCard_func`에 전달하도록 확장
  - **`discoverAccounts_func` index-backed path 버그 수정** (accounts.ts:468-477):
    - 현재: accounts.json이 있으면 모든 계정의 `userDataDirPath`를 `defaultDataDir`로 반환
    - 수정: managed 계정(`user-*`)은 `path.join(cliDir, 'user-data', account.id)` 반환
    ```ts
    // accounts.ts L473-476 수정:
    return accounts_var.map((account_var) => ({
      name: account_var.id,
      userDataDirPath: account_var.id.startsWith('user-')
        ? path.join(options_var.cliDir, 'user-data', account_var.id)
        : options_var.defaultDataDir,
    }));
    ```
  - TDD: `accounts.test.ts`에 card 저장/읽기 테스트 추가
  - TDD: `accounts.test.ts`에 discoverAccounts index-backed path가 managed 계정에 올바른 경로를 반환하는지 테스트 추가

  **Must NOT do**:
  - `AccountDetail` 인터페이스 재설계
  - 기존 cache TTL 로직 변경
  - 60초 이내 재조회 방지 로직 제거

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3, 4, 5, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/services/accounts.ts:53-79` — AccountDetail 인터페이스 (quota_cache, rotation, wakeup_history 필드)
  - `src/services/accounts.ts:146-177` — writeAccountDetail_func (0600 권한 저장 패턴)
  - `src/services/quotaClient.ts:99-128` — loadCodeAssist 호출 패턴
  - `src/services/quotaClient.ts:336-395` — fetchAvailableModels 응답 파싱 (family 분류, remaining_pct 계산)
  - `src/services/quotaClient.ts:437-467` — fetchQuotaForAccounts_func (4-at-a-time 배치, plan에서 이전 명칭 `fetchQuotaForAllAccountsBatched_func`로 표기했으나 실제 함수명은 `fetchQuotaForAccounts_func`)

  **API/Type References**:
  - `src/services/quotaClient.ts:18-46` — QuotaCacheValue / ParseResult 타입
  - `src/services/accounts.ts:19-79` — AccountStatus, AccountDetail 타입 전체

  **Test References**:
  - `src/services/quotaClient.test.ts:41-278` — cache, refresh, batch 테스트 패턴
  - `src/services/accounts.test.ts:86-295` — upsert, persistence 테스트 패턴

  **Acceptance Criteria**:
  - [ ] Test: `saveAccountCard_func`이 loadCodeAssist + fetchAvailableModels 결과를 올바르게 매핑
  - [ ] Test: `saveAccountCard_func`이 에러 시 fetch_error를 저장
  - [ ] Test: 저장된 카드를 `readAccountDetailSync_func` 또는 `writeAccountDetail_func`로 읽었을 때 모든 필드 일치
  - [ ] Test: `discoverAccounts_func` index-backed path에서 managed 계정(`user-*`)이 올바른 개별 `userDataDirPath`를 반환
  - [ ] `bun test src/services/accounts.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Card 저장 후 읽기 일치
    Tool: Bash (bun test)
    Steps:
      1. `bun test src/services/accounts.test.ts` 실행
      2. saveAccountCard 관련 테스트가 PASS하는지 확인
    Expected Result: 모든 card 저장/읽기 테스트 통과
    Failure Indicators: 필드 누락, 타입 불일치
    Evidence: .sisyphus/evidence/task-1-card-save-read.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-1-regression.txt

  Scenario: discoverAccounts index-backed path 버그 수정 확인
    Tool: Bash (bun test)
    Steps:
      1. mock: accounts.json에 default + user-01 계정 존재
      2. `bun test src/services/accounts.test.ts` 실행
      3. user-01 계정의 userDataDirPath가 `~/.antigravity-cli/user-data/user-01`인지 확인
      4. default 계정의 userDataDirPath가 기본 경로인지 확인
    Expected Result: managed 계정은 개별 경로, default는 기본 경로
    Failure Indicators: 모든 계정이 동일한 defaultDataDir 반환
    Evidence: .sisyphus/evidence/task-1-userdatadir-fix.txt
  ```

  **Commit**: YES
  - Message: `feat(accounts): add saveAccountCard pipeline + fix discoverAccounts userDataDirPath for managed accounts`
  - Files: `src/services/accounts.ts`, `src/services/accounts.test.ts`, `src/services/quotaClient.ts`

---

- [ ] 2. 90% bucket reset 제거 + effectiveFamily CLAUDE 고정

  **What to do**:
  - `rotate.ts` L107-109의 90% reset 코드 제거:
    ```ts
    // 제거할 코드:
    if (currentRemainingPct_var !== null && currentRemainingPct_var >= 90) {
      updatedCurrentAccount_var.familyBuckets[bucketKey_var] = null;
    }
    ```
  - `rotate.test.ts` R-9 테스트 수정: 이제 bucket이 유지되어야 함
  - `main.ts` effectiveFamily 기본값 수정:
    ```ts
    // 변경 전: null → _min
    // 변경 후: 명시적 'CLAUDE'
    const effective_family_var = options_var.cli.model?.toLowerCase().includes('gemini')
      ? 'GEMINI'
      : 'CLAUDE';  // 기본값 CLAUDE
    ```
  - TDD: rotate.test.ts에 90%에서 bucket 유지 테스트 추가, main.test.ts에 effectiveFamily CLAUDE 기본 테스트 추가

  **Must NOT do**:
  - bucket crossing 판단 로직 자체 수정
  - effectiveFamily가 null이 되는 경로 유지

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 7, 9
  - **Blocked By**: None

  **References**:
  - `src/services/rotate.ts:107-109` — 제거할 90% reset 코드
  - `src/main.ts:1079-1083` — 수정할 effectiveFamily 코드
  - `src/services/rotate.test.ts` — R-9 (90% reset 테스트)
  - `src/main.test.ts` — effectiveFamily 관련 테스트

  **Acceptance Criteria**:
  - [ ] Test: 95%에서도 bucket이 null로 초기화되지 않음
  - [ ] Test: effectiveFamily가 모델 미지정 시 'CLAUDE' 반환
  - [ ] Test: effectiveFamily가 'gemini-3-flash' 지정 시 'GEMINI' 반환
  - [ ] `bun test` → 전체 PASS

  **QA Scenarios:**
  ```
  Scenario: 90% reset 제거 확인
    Tool: Bash (bun test)
    Steps:
      1. `bun test src/services/rotate.test.ts` 실행
      2. 95% bucket 유지 테스트 PASS 확인
    Expected Result: bucket이 null로 초기화되지 않음
    Evidence: .sisyphus/evidence/task-2-no-90-reset.txt

  Scenario: effectiveFamily CLAUDE 기본
    Tool: Bash (bun test)
    Steps:
      1. `bun test src/main.test.ts` 실행
      2. effectiveFamily 기본값 테스트 PASS 확인
    Expected Result: model 미지정 시 'CLAUDE'
    Evidence: .sisyphus/evidence/task-2-family-default.txt
  ```

  **Commit**: YES
  - Message: `fix(rotate): remove 90% bucket reset + default effectiveFamily to CLAUDE`
  - Files: `src/services/rotate.ts`, `src/services/rotate.test.ts`, `src/main.ts`, `src/main.test.ts`

---

- [ ] 3. auth refresh 명령 scaffold

  **What to do**:
  - `AuthSubcommand` 타입에 `'refresh'` 추가
  - `handleAuthCommand_func`에 `refresh` 분기 추가
  - `handleAuthRefresh_func` 신규 작성:
    1. `discoverAccounts_func`로 전체 계정 발견
    2. 전체 계정 cloud quota 강제 갱신 (60s cache 무시)
    3. 각 결과를 `saveAccountCard_func`에 전달
    4. `filterWakeupCandidates_func`로 wake-up 후보 식별
    5. wake-up 후보에 대해 백그라운드 wake-up 트리거 (Task 5에서 구현, 여기서는 TODO)
    6. `buildAuthListRows_func`로 표시용 행 생성 (auth list와 동일 테이블)
    7. JSON 모드 지원
  - `quotaClient.ts`에 `forceRefreshAllQuotas_func` 추가: 60s cache TTL 무시
  - TDD: main.test.ts에 auth refresh 라우팅 + handleAuthRefresh 테스트

  **Must NOT do**:
  - auth list의 기존 네트워크 갱신 경로 제거
  - wake-up 실행 구현 (Task 5에서 담당)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1b
  - **Blocks**: Tasks 6, 9
  - **Blocked By**: Task 1

  **References**:
  - `src/main.ts:768-882` — handleAuthList_func (동일 패턴)
  - `src/main.ts:578-600` — handleAuthCommand_func
  - `src/services/quotaClient.ts:437-467` — fetchQuotaForAccounts_func (실제 함수명)
  - `src/services/wakeup.ts` — filterWakeupCandidates_func
  - `src/services/authList.ts:216-269` — renderAuthListText_func

  **Acceptance Criteria**:
  - [ ] Test: `detectRootCommand_func(['auth', 'refresh'])` → auth 분기
  - [ ] Test: `handleAuthRefresh_func`이 전체 계정 quota를 갱신
  - [ ] Test: `forceRefreshAllQuotas_func`이 60s cache TTL을 무시하고 강제 갱신
  - [ ] Test: wake-up 후보 식별
  - [ ] Test: `--json` 시 JSON 배열 출력
  - [ ] `bun test src/main.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: auth refresh 전체 계정 갱신
    Tool: Bash (bun test)
    Steps:
      1. `bun test src/main.test.ts` 실행
      2. handleAuthRefresh_func 테스트 그룹 확인
      3. 전체 계정 quota 갱신 호출 횟수 assertion 확인
    Expected Result: 모든 계정에 대해 forceRefreshAllQuotas 호출, 60s cache 무시
    Failure Indicators: 일부 계정 누락, cache TTL 무시 안 됨
    Evidence: .sisyphus/evidence/task-3-auth-refresh.txt

  Scenario: auth refresh --json 출력
    Tool: Bash (bun test)
    Steps:
      1. `bun test src/main.test.ts` 실행
      2. --json 플래그 시 JSON 배열 출력 테스트 확인
    Expected Result: JSON 형식 배열에 계정별 quota 정보 포함
    Failure Indicators: JSON parse 실패, 필드 누락
    Evidence: .sisyphus/evidence/task-3-auth-refresh-json.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-3-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(auth): add auth refresh command for forced full quota refresh`
  - Files: `src/main.ts`, `src/main.test.ts`, `src/services/quotaClient.ts`, `src/services/quotaClient.test.ts`

---

- [ ] 4. auth list 경량화 (카드 기반 + 선택적 병렬 갱신)

  **What to do**:
  - `handleAuthList_func`를 **3단계 흐름**으로 재구성:
    1. **1단계 — 캐시 즉시 렌더링**: 모든 계정의 `AccountDetail.quota_cache`를 읽어 즉시 테이블 표시 (네트워크 대기 없이 0ms)
    2. **2단계 — 선택적 병렬 갱신**: 오래된/불확실한 id만 판별 → 병렬 갱신 (fast-path 우선 → cloud API fallback)
       - **오래된 id**: `cached_at`이 5시간 초과
       - **불확실한 id**: fetch_error, families 비어있음, reset_time 경과, offline-only 미검증 current
    3. **3단계 — 재렌더링**: 갱신된 카드로 테이블 재구성 (stale → fresh 전환)
  - 갱신 대상 0개면 1단계 즉시 표시로 종료 (네트워크 0회)
  - 갱신 대상 있으면 1단계 즉시 표시 → 2단계 병렬 갱신 → 3단계 재렌더
  - TDD: authList.test.ts에 3단계 흐름 테스트

  **Must NOT do**:
  - 전체 계정 무조건 네트워크 갱신
  - 갱신 대상 없어도 네트워크 호출

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1b
  - **Blocks**: Tasks 6, 9
  - **Blocked By**: Task 1

  **References**:
  - `src/main.ts:768-882` — handleAuthList_func
  - `src/services/authList.ts:39-60` — buildParseResultFromQuotaCache_func
  - `src/services/authList.ts:156-208` — buildAuthListRows_func
  - `src/services/quotaClient.ts:18-46` — QuotaCacheValue
  - `src/services/accounts.ts:53-79` — AccountDetail.quota_cache

  **Acceptance Criteria**:
  - [ ] Test: 모든 카드 최신이면 1단계 즉시 표시 후 네트워크 0회
  - [ ] Test: 오래된 카드만 선택적 갱신 (1단계 캐시 즉시 표시 → 2단계 병렬 갱신 → 3단계 재렌더)
  - [ ] Test: 불확실한 카드 갱신
  - [ ] Test: 최신 카드는 갱신 안 함
  - [ ] Test: 병렬 처리
  - [ ] Test: 1단계 캐시 즉시 렌더링이 네트워크 대기 전에 실행됨
  - [ ] `bun test src/services/authList.test.ts src/main.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: 1단계 캐시 즉시 렌더링 (네트워크 대기 없이)
    Tool: Bash (bun test)
    Steps:
      1. 5개 계정 중 3개 최신, 2개 오래된 카드 mock 설정
      2. handleAuthList_func 호출
      3. 첫 번째 렌더링이 네트워크 호출 전에 실행됨을 확인
    Expected Result: 5개 계정 모두 캐시 기반으로 즉시 표시 (오래된 항목은 stale 마크)
    Failure Indicators: 네트워크 갱신 대기 후 첫 표시
    Evidence: .sisyphus/evidence/task-4-immediate-render.txt

  Scenario: 모든 카드 최신이면 네트워크 0회
    Tool: Bash (bun test)
    Steps:
      1. 모든 계정의 cached_at < 1h인 mock 설정
      2. `bun test src/services/authList.test.ts` 실행
      3. 네트워크 호출 0회 assertion 확인
    Expected Result: fetchQuotaForAccounts 호출 없이 캐시만으로 표시
    Failure Indicators: 불필요한 네트워크 호출 발생
    Evidence: .sisyphus/evidence/task-4-no-network.txt

  Scenario: 오래된 카드 선택적 병렬 갱신
    Tool: Bash (bun test)
    Steps:
      1. 3개 계정 최신, 2개 계정 cached_at > 5h mock 설정
      2. `bun test src/services/authList.test.ts` 실행
      3. 오래된 2개만 갱신, 최신 3개는 미갱신 assertion 확인
    Expected Result: 2개만 cloud 조회, 3개는 캐시 재사용
    Failure Indicators: 전체 계정 네트워크 호출
    Evidence: .sisyphus/evidence/task-4-selective-refresh.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-4-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(auth-list): lightweight card-based display with selective parallel refresh`
  - Files: `src/main.ts`, `src/main.test.ts`, `src/services/authList.ts`, `src/services/authList.test.ts`

---

- [ ] 5. Wake-up 실행 오케스트레이션

  **What to do**:
  - `wakeup.ts`에 `executeWakeup_func` 신규 작성:
    1. 대상 계정의 `userDataDirPath` 확인
    2. `open -n -a Antigravity --args --user-data-dir=<abs>` 실행
    3. 해당 계정의 `state.vscdb` poll (`uss-oauth` + `uss-enterprisePreferences` 도착 대기)
    4. 성공 시 token 읽어 AccountDetail에 저장
    5. `wakeup_history` 업데이트
    6. 실패/timeout 시 `last_result = 'timeout' | 'failed'`
  - timeout: 120초
  - 동시 실행: 최대 2개 계정 병렬
  - TDD: wakeup.test.ts에 실행 오케스트레이션 테스트

  **Must NOT do**:
  - `filterWakeupCandidates_func` 재작성
  - exponential backoff
  - 전체 계정 한 번에 wake-up

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:
  - **AGENTS.md "auth login 플로우" 섹션** — `open -n -a Antigravity --args --user-data-dir=<abs>` 패턴 설명 (authLogin.ts에 이 패턴이 직접 구현되어 있지 않으므로, AGENTS.md의 설명을 참고하여 신규 구현해야 함)
  - `src/services/authLogin.ts:313-341` — waitForCompletionWithTimeout_func (generic timeout wrapper, 재사용 가능)
  - `src/services/authLogin.ts:343-492` — authLogin_func (전체 플로우 구조 참고, OAuth callback 방식이므로 wake-up과는 다름)
  - `src/services/stateVscdb.ts` — uss-oauth + uss-enterprisePreferences 읽기
  - `src/services/wakeup.ts` — filterWakeupCandidates_func, updateWakeupHistory_func
  - `src/services/accounts.ts:72-79` — wakeup_history 구조

  **Wake-up 실행 구현 가이드** (AGENTS.md 기반):

  > **⚠️ 중요: `discoverAccounts_func`의 index-backed path 버그**
  > `discoverAccounts_func`(accounts.ts:468-477)에서 accounts.json(index)이 존재하면
  > 모든 계정의 `userDataDirPath`를 `defaultDataDir`로 반환합니다.
  > 하지만 managed 계정(`user-*`)은 각각 다른 `~/.antigravity-cli/user-data/user-NN/` 경로를 가져야 합니다.
  > **해결**: `discoverAccounts_func`의 index-backed 경로(L470-477)에서
  > 계정 이름이 `user-*` 패턴이면 `path.join(cliDir, 'user-data', account.id)`로
  > 실제 경로를 계산하도록 수정해야 합니다. 이 수정은 Task 1에 포함합니다.
  >
  > ```
  > // accounts.ts L473-476 수정:
  > return accounts_var.map((account_var) => ({
  >   name: account_var.id,
  >   userDataDirPath: account_var.id.startsWith('user-')
  >     ? path.join(options_var.cliDir, 'user-data', account_var.id)
  >     : options_var.defaultDataDir,
  > }));
  > ```

  ```
  1. 대상 계정의 userDataDirPath 확보
     → accounts.ts의 discoverAccounts_func 결과에서 userDataDirPath 사용
     → 위 수정으로 managed 계정(user-*)은 올바른 개별 경로 반환
  2. Antigravity app 실행:
     → execFile('open', ['-n', '-a', 'Antigravity', '--args', `--user-data-dir=${userDataDirPath}`])
     ※ -n 플래그: 새 인스턴스 열기 (기존 실행 중인 앱과 충돌 방지)
  3. state.vscdb poll:
     → 대상 계정의 globalStorageDirPath 아래 state.vscdb 경로 계산
     → 5초 간격으로 uss-oauth + uss-enterprisePreferences topic bytes 도착 확인
     → timeout: 120초
  4. 성공 시:
     → AccountDetail에 wakeup_history 업데이트 (last_result='success', last_attempt_at=now)
  5. 실패/timeout 시:
     → wakeup_history.last_result = 'timeout' | 'failed'
  ```

  **Acceptance Criteria**:
  - [ ] Test: `executeWakeup_func`이 Antigravity app 열고 state.vscdb poll
  - [ ] Test: 성공 시 AccountDetail에 token 저장 + wakeup_history 업데이트
  - [ ] Test: timeout 시 wakeup_history.last_result = 'timeout'
  - [ ] Test: 최대 2개 병렬
  - [ ] `bun test src/services/wakeup.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Wake-up 성공 (Antigravity 실행 → state.vscdb poll)
    Tool: Bash (bun test)
    Steps:
      1. mock: execFile('open', ...) 성공, state.vscdb에 uss-oauth 도착
      2. `bun test src/services/wakeup.test.ts` 실행
      3. executeWakeup_func 성공 테스트 확인
    Expected Result: AccountDetail에 wakeup_history.last_result='success', token 저장
    Failure Indicators: timeout, token 미저장
    Evidence: .sisyphus/evidence/task-5-wakeup-success.txt

  Scenario: Wake-up timeout (120초 초과)
    Tool: Bash (bun test)
    Steps:
      1. mock: execFile 성공, state.vscdb poll 120초 내 uss-oauth 미도착
      2. `bun test src/services/wakeup.test.ts` 실행
      3. timeout 테스트 확인
    Expected Result: wakeup_history.last_result='timeout', graceful 종료
    Failure Indicators: 예외 발생, process hang
    Evidence: .sisyphus/evidence/task-5-wakeup-timeout.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-5-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(wakeup): add executeWakeup orchestration for dormant accounts`
  - Files: `src/services/wakeup.ts`, `src/services/wakeup.test.ts`

---

- [ ] 6. Wake-up 4개 타이밍 통합

  **What to do**:
  - **(2-1) auth refresh 시**: handleAuthRefresh_func에서 후보 식별 → executeWakeup_func 백그라운드 트리거
  - **(2-2) auth list 시**: handleAuthList_func에서 후보 식별 → executeWakeup_func 백그라운드 트리거
  - **(2-3) 프롬프트 시작 전**: main() 메시지 전송 시작 부분에서:
    - 현재 계정 카드 quick check
    - 백그라운드로 미시작 계정 wake-up (fire-and-forget, 첫 응답 blocking 금지)
  - **(2-4) 프롬프트 종료 후**: 응답 완료 후:
    - 백그라운드로 현재 계정 cloud quota 조회
    - 카드 기록
    - rotate 판단 (Task 7)
    - rotate 필요 시 switch (Task 8)
  - 모든 wake-up은 fire-and-forget: Promise 에러는 로깅만
  - TDD: main.test.ts에 각 타이밍 테스트

  **Must NOT do**:
  - wake-up이 메인 흐름 blocking
  - pre-prompt wake-up이 첫 응답 지연
  - 전체 계정 한 번에 wake-up

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 3, 4, 5)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 3, 4, 5

  **References**:
  - `src/main.ts:768-882` — handleAuthList_func (2-2 통합 위치)
  - `src/main.ts:1028-1110` — decideAndPersistAutoRotate_func (2-4 통합 위치)
  - `src/main.ts:2354-2501` — message-send path (2-3, 2-4 통합 위치)

  **Acceptance Criteria**:
  - [ ] Test: (2-1) auth refresh 후 미시작 계정 wake-up 트리거
  - [ ] Test: (2-2) auth list 후 미시작 계정 wake-up 트리거
  - [ ] Test: (2-3) 프롬프트 시작 전 백그라운드 wake-up
  - [ ] Test: (2-3) pre-prompt wake-up이 첫 응답 blocking하지 않음
  - [ ] Test: (2-4) 프롬프트 종료 후 cloud 조회 + rotate + switch
  - [ ] `bun test src/main.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: auth refresh 후 미시작 계정 wake-up 트리거 (2-1)
    Tool: Bash (bun test)
    Steps:
      1. mock: 5개 계정 중 2개 all-null quota
      2. handleAuthRefresh_func 실행
      3. executeWakeup_func이 2개 계정에 대해 호출되었는지 spy 확인
    Expected Result: wake-up이 fire-and-forget으로 백그라운드 트리거됨
    Failure Indicators: wake-up 호출 없음, 메인 흐름 blocking
    Evidence: .sisyphus/evidence/task-6-timing-2-1.txt

  Scenario: 프롬프트 시작 전 백그라운드 wake-up (2-3)
    Tool: Bash (bun test)
    Steps:
      1. mock: 미시작 계정 존재, pre-prompt 진입
      2. pre-prompt 파이프라인에서 executeWakeup_func 호출 확인
      3. 첫 응답 도착 시간이 wake-up 완료 대기하지 않는지 확인
    Expected Result: wake-up이 백그라운드로 시작, 메시지 전송은 즉시 진행
    Failure Indicators: pre-prompt wake-up이 첫 응답 blocking
    Evidence: .sisyphus/evidence/task-6-timing-2-3.txt

  Scenario: 프롬프트 종료 후 rotate + switch (2-4)
    Tool: Bash (bun test)
    Steps:
      1. mock: 응답 완료 후 quota 재조회 결과 crossing 감지
      2. post-response 파이프라인 실행 확인
      3. pendingSwitch 생성 + accounts.json 갱신 확인
    Expected Result: crossing 감지 → switch 기록 (다음 실행 적용)
    Failure Indicators: post-response 미실행, switch 미기록
    Evidence: .sisyphus/evidence/task-6-timing-2-4.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-6-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(wakeup): integrate wake-up at all 4 timings`
  - Files: `src/main.ts`, `src/main.test.ts`

---

- [ ] 7. Post-response rotate 파이프라인

  **What to do**:
  - main.ts 응답 완료 지점에 post-response 파이프라인 추가:
    1. 현재 계정 fresh quota cloud 조회 (live attach면 로컬 fast-path, offline이면 cloud)
    2. 조회 결과를 `saveAccountCard_func`로 저장
    3. `decideAutoRotate_func` 호출 (pre-turn vs post-turn bucket crossing)
    4. crossing 감지 시 switch 트리거 (Task 8)
  - **pre-turn snapshot**: 프롬프트 시작 시 quota_cache에서 pct 보관
  - **로컬 fast-path 우선순위**: live LS → state.vscdb → cloud
  - TDD: main.test.ts에 post-response 테스트

  **Must NOT do**:
  - `decideAutoRotate_func` 재작성
  - mid-session switching
  - 다른 후보 계정 cloud 조회

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 1, 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 8, 9
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `src/services/rotate.ts:72-158` — decideAutoRotate_func
  - `src/main.ts:1028-1110` — decideAndPersistAutoRotate_func
  - `src/services/liveAttach.ts` — live LS 탐지
  - `src/services/quotaClient.ts:99-128` — loadCodeAssist
  - `src/services/stateVscdb.ts` — extractUserStatusSummary_func

  **Acceptance Criteria**:
  - [ ] Test: 응답 후 cloud quota 조회 실행
  - [ ] Test: 73%→64% → crossing → switch 트리거
  - [ ] Test: 67%→64% → crossing 아님
  - [ ] Test: live attach 시 로컬 fast-path
  - [ ] Test: 결과가 card에 저장됨
  - [ ] `bun test src/main.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: 응답 후 73%→64% → crossing → switch 트리거
    Tool: Bash (bun test)
    Steps:
      1. mock: pre-turn snapshot 73% (bucket=null), post-turn fresh read 64% (bucket='70')
      2. post-response 파이프라인 실행
      3. decideAutoRotate_func이 crossing 감지하는지 확인
    Expected Result: pendingSwitch 생성, family_buckets='70' 업데이트
    Failure Indicators: crossing 미감지, switch 미생성
    Evidence: .sisyphus/evidence/task-7-crossing.txt

  Scenario: 응답 후 67%→64% → crossing 아님
    Tool: Bash (bun test)
    Steps:
      1. mock: pre-turn 67%, post-turn 64% (동일 '70' bucket)
      2. post-response 파이프라인 실행
      3. decideAutoRotate_func이 crossing 아님 판정 확인
    Expected Result: pendingSwitch = null, no-op
    Failure Indicators: 동일 bucket에서 불필요한 rotate
    Evidence: .sisyphus/evidence/task-7-no-crossing.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-7-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(rotate): add post-response rotate pipeline with pre/post-turn comparison`
  - Files: `src/main.ts`, `src/main.test.ts`

---

- [ ] 8. Switch 실행 (post-response에서 즉시 전환+기록) + pending-switch.json 확장

  **What to do**:
  - `applySwitchForNextInvocation_func` 신규:
    - **호출 시점**: post-response rotate 판단 직후, 현재 세션 내에서 즉시 실행
    - **이 함수의 역할 (Switch 흐름 1단계 — 즉시 완료)**:
      1. target account token 유효성 확인 (expiry check)
      2. `accounts.json`의 `current_account_id` 변경 (즉시 acc-2로 전환)
      3. `pending-switch.json`에 적용 기록 (log):
         - 기존: target_account_id, source_account_id, reason, decided_at
         - 신규: pre_turn_pct, post_turn_pct, bucket_crossed, fingerprint_id (nullable), serviceMachineId (nullable)
      4. auth token 원문 절대 포함 불가
    - **이 시점에서 계정 전환은 완료**. accounts.json이 변경되었으므로 다음 agcl 실행은 acc-2로 동작.
    - **다음 실행 startup (2단계)**: fingerprint 적용만 수행 (Task 12에서 구현)
      - pending-switch.json을 읽어 적용 기록으로 인식 → 대상 계정 fingerprint load → state.vscdb 적용
      - pending-switch.json은 삭제하지 않고 log로 유지
  - token 만료 시 switch 실패 → 로깅 후 skip
  - TDD: rotate.test.ts에 switch 실행 테스트

  **Switch 흐름 요약 (plan 전체에서 일관되게 참조)**:
  ```
  [현재 세션 — post-response] ← 1단계: 즉시 전환+기록
    decideAutoRotate_func → "acc-1 → acc-2 전환 필요"
    → applySwitchForNextInvocation_func
      → accounts.json.current_account_id = "acc-2" ← 즉시 전환 완료
      → pending-switch.json 작성 (적용 로그, 삭제하지 않음)
  
  [다음 실행 — startup] ← 2단계: fingerprint 적용만
    startup consumer가 pending-switch.json 읽기
      → "적용 기록"으로 인식 (삭제하지 않음)
      → loadFingerprint_func("acc-2") → applyFingerprintToStateDb
  ```
  - **계정 전환은 1단계에서 즉시 완료** (accounts.json 변경)
  - **fingerprint 적용은 2단계에서 수행** (다음 실행 startup)
  - pending-switch.json은 "이미 적용 완료된 기록" — startup에서 읽고 fingerprint만 적용 후 log로 유지

  **Must NOT do**:
  - auth token을 pending-switch.json에 저장
  - mid-session LS restart

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 7)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 12 (fingerprint inject), Task 9
  - **Blocked By**: Task 7

  **References**:
  - `src/services/rotate.ts:160-185` — 기존 pending-switch 저장
  - `src/services/authInject.ts:139-197` — injectAuthToStateDb_func
  - `src/main.ts:884-924` — applyAuthListSelection_func
  - `src/services/rotate.ts:14-19` — PendingSwitchIntent

  **Acceptance Criteria**:
  - [ ] Test: accounts.json current_account_id 변경
  - [ ] Test: pending-switch.json에 신규 필드 포함
  - [ ] Test: access_token 미포함
  - [ ] Test: token 만료 시 graceful 실패
  - [ ] `bun test src/services/rotate.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: Switch 성공 — accounts.json + pending-switch.json 갱신
    Tool: Bash (bun test)
    Steps:
      1. mock: target account token 유효 (expiry > now)
      2. applySwitchForNextInvocation_func 실행
      3. accounts.json의 current_account_id 변경 확인
      4. pending-switch.json에 신규 필드 포함 확인
    Expected Result: current_account_id=acc-2, pending-switch에 pre_turn_pct/post_turn_pct 포함
    Failure Indicators: current_account_id 미변경, 필드 누락
    Evidence: .sisyphus/evidence/task-8-switch-success.txt

  Scenario: pending-switch.json에 access_token 미포함
    Tool: Bash (bun test)
    Steps:
      1. switch 실행 후 pending-switch.json 내용 확인
      2. "access_token", "refresh_token" 문자열 검색
    Expected Result: token 관련 필드 0건
    Failure Indicators: token 문자열 발견
    Evidence: .sisyphus/evidence/task-8-no-token.txt

  Scenario: token 만료 시 graceful 실패
    Tool: Bash (bun test)
    Steps:
      1. mock: target account token 만료 (expiry < now)
      2. applySwitchForNextInvocation_func 실행
    Expected Result: 로깅 후 skip, 예외 미발생
    Failure Indicators: 예외 발생, process crash
    Evidence: .sisyphus/evidence/task-8-token-expired.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-8-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(rotate): implement switch-for-next-invocation + extend pending-switch schema`
  - Files: `src/services/rotate.ts`, `src/services/rotate.test.ts`

---

- [ ] 9. main.ts 통합: auth 라우팅 + pre-prompt + post-response

  **What to do**:
  - Wave 1-2 컴포넌트를 main.ts에 통합:
    - handleAuthCommand_func: refresh 분기 완성
    - 프롬프트 시작: pre-turn snapshot + 백그라운드 wake-up
    - 프롬프트 종료: post-response cloud 조회 + card 저장 + rotate + switch
    - 기존 `decideAndPersistAutoRotate_func`을 새 파이프라인으로 교체
  - **pending-switch.json 의미 전환 처리**:
    - 기존 코드(main.ts:1028-1052, 2383-2394)는 `pending-switch.json`을 "시작 시 소비 후 삭제"하는 intent로 취급
    - v0.3.0에서는 계정 전환이 이미 post-response에서 즉시 완료되므로 (Task 8, Switch 1단계),
      이 파일은 **"이미 적용 완료된 switch의 기록(log)"**임
    - 따라서 `applyPendingSwitchIntentIfNeeded_func`의 기존 "소비 후 삭제" 로직을
      **"읽고 fingerprint 적용만 수행, 파일은 log로 유지"**로 변경
    - 구체 수정:
      1. pending-switch.json이 존재하면 읽기 (삭제하지 않음)
      2. 대상 계정의 fingerprint를 load → state.vscdb에 적용 (Task 12의 `applyFingerprintToStateDb_func` 호출)
      3. fingerprint 적용 완료 후 파일은 그대로 log로 유지
      4. fingerprint가 없으면 신규 생성 후 적용
    - **이게 Switch 흐름 2단계(fingerprint 적용)임** — Task 12에서 세부 구현, Task 9에서 main.ts 파이프라인 연결
  - 에러 처리: post-response 실패 시 로깅만, exit code에 영향 없음
  - TDD: main.test.ts에 전체 흐름 통합 테스트

  **Must NOT do**:
  - post-response 실패가 메인 응답에 영향
  - 기존 live/offline 분기 로직 변경

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 3, 4, 6, 8)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 3, 4, 6, 8

  **References**:
  - `src/main.ts:578-600` — handleAuthCommand_func
  - `src/main.ts:1028-1052` — applyPendingSwitchIntentIfNeeded_func (startup consumer, "소비 후 삭제" → "읽고 fingerprint 적용, log 유지"로 변경)
  - `src/main.ts:2383-2394` — pending-switch.json 소비 로직 (시작 시 읽고 삭제 → 읽고 fingerprint 적용 후 유지)
  - `src/main.ts:2354-2501` — message-send path
  - `src/main.ts:3207-3350` — observeAndAppendSteps_func

  **Acceptance Criteria**:
  - [ ] Test: auth refresh → 전체 갱신 → wake-up → 표시
  - [ ] Test: auth list → 카드 기반 → 선택적 갱신 → wake-up → 표시
  - [ ] Test: 프롬프트 시작 → pre-turn snapshot + 백그라운드 wake-up
  - [ ] Test: 프롬프트 종료 → post-response → rotate → switch 기록
  - [ ] Test: post-response 실패해도 메인 응답 정상
  - [ ] Test: pending-switch.json이 "기록 파일"로 동작 — 시작 시 소비/삭제하지 않고 이미 적용된 것으로 간주
  - [ ] `bun test` → 전체 PASS

  **QA Scenarios:**

  ```
  Scenario: 전체 파이프라인 E2E — auth refresh → wake-up → 표시
    Tool: Bash (bun test)
    Steps:
      1. `bun test src/main.test.ts` 실행
      2. auth refresh 통합 테스트 확인 (전체 갱신 → 카드 저장 → wake-up 후보 식별)
    Expected Result: 전체 계정 갱신 + wake-up 후보에 대해 executeWakeup 호출
    Failure Indicators: 일부 계정 갱신 누락, wake-up 미트리거
    Evidence: .sisyphus/evidence/task-9-e2e-refresh.txt

  Scenario: 전체 파이프라인 E2E — 프롬프트 시작 → 종료 → rotate
    Tool: Bash (bun test)
    Steps:
      1. mock: pre-prompt (백그라운드 wake-up), message send, response complete
      2. post-response: cloud 조회 → card 저장 → rotate 판단 → switch
      3. 전체 흐름이 에러 없이 완료되는지 확인
    Expected Result: pre-turn snapshot 저장, post-response rotate 판단 완료
    Failure Indicators: 중간 단계 예외, 메인 응답 실패
    Evidence: .sisyphus/evidence/task-9-e2e-prompt.txt

  Scenario: post-response 실패해도 메인 응답 정상
    Tool: Bash (bun test)
    Steps:
      1. mock: cloud 조회 실패 (네트워크 에러)
      2. 메인 응답은 정상 완료
      3. post-response 에러가 로깅만 되고 exit code에 영향 없는지 확인
    Expected Result: 메인 응답 exit code 0, post-response 에러 로깅
    Failure Indicators: exit code != 0, 예외 전파
    Evidence: .sisyphus/evidence/task-9-error-isolation.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 + 신규 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-9-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(main): integrate auth refresh, lightweight list, pre/post-prompt pipelines`
  - Files: `src/main.ts`, `src/main.test.ts`

---

- [ ] 10. 통합 테스트 + 엣지 케이스

  **What to do**:
  - 엣지 케이스 테스트:
    - **E1**: 단일 계정 — rotate no-op
    - **E2**: 모든 계정 forbidden — auth refresh 완료 but wake-up 안 함
    - **E3**: 동시 CLI — pending-switch 마지막 writer 승리
    - **E4**: Account card 손상 — null → "카드 없음" → refresh
    - **E5**: auth refresh 부분 성공 (8/10) — exit code 0
    - **E6**: Live LS 실행 중 — wake-up이 이미 실행 중인 계정을 건너뜀
    - **E7**: target account token 없음 → switch graceful 실패

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`instruct--testing`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 9)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 11
  - **Blocked By**: Task 9

  **Acceptance Criteria**:
  - [ ] E1-E7 모든 엣지 케이스 PASS
  - [ ] `bun test` → 전체 PASS

  **QA Scenarios:**

  ```
  Scenario: E1 단일 계정 — rotate no-op
    Tool: Bash (bun test)
    Steps:
      1. mock: 계정 1개, quota 45%
      2. post-response rotate 실행
      3. rotate no-op (후보 없음) 확인
    Expected Result: pendingSwitch = null, 정상 종료
    Failure Indicators: 에러 발생, no-op가 에러로 처리됨
    Evidence: .sisyphus/evidence/task-10-e1-single.txt

  Scenario: E5 auth refresh 부분 성공 (8/10)
    Tool: Bash (bun test)
    Steps:
      1. mock: 10개 계정 중 2개 네트워크 실패
      2. handleAuthRefresh_func 실행
      3. exit code 0, 8개 성공 결과 확인
    Expected Result: exit code 0, 실패 2개 fetch_error 저장
    Failure Indicators: exit code != 0, 성공한 결과도 롤백
    Evidence: .sisyphus/evidence/task-10-e5-partial.txt

  Scenario: E6 Live LS 실행 중 — wake-up skip
    Tool: Bash (bun test)
    Steps:
      1. mock: 계정이 이미 live LS에서 실행 중
      2. executeWakeup_func이 해당 계정을 skip하는지 확인
    Expected Result: 이미 실행 중인 계정은 wake-up 시도하지 않음
    Failure Indicators: 중복 실행 시도, port 충돌
    Evidence: .sisyphus/evidence/task-10-e6-live-skip.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 전체 PASS (기존 + 신규 엣지 케이스)
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-10-regression.txt
  ```

  **Commit**: YES
  - Message: `test: add edge case coverage for v0.3.0 auth/rotate/wakeup`
  - Files: 각 모듈 test 파일

---

- [ ] 11. README/CHANGELOG 업데이트

  **What to do**:
  - README.md에 `auth refresh` 명령 추가
  - README.ko.md에도 반영
  - CHANGELOG.md에 v0.3.0 항목 추가
  - AGENTS.md Where To Edit 테이블 업데이트

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 10)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Task 10

  **Acceptance Criteria**:
  - [ ] README.md에 auth refresh 설명 있음
  - [ ] CHANGELOG.md에 v0.3.0 항목 있음

  **QA Scenarios:**

  ```
  Scenario: README.md auth refresh 설명 존재
    Tool: Bash (grep)
    Steps:
      1. `grep -c "auth refresh" README.md` 실행
      2. 결과가 0보다 큰지 확인
    Expected Result: count >= 1
    Failure Indicators: count == 0
    Evidence: .sisyphus/evidence/task-11-readme-refresh.txt

  Scenario: CHANGELOG.md v0.3.0 항목 존재
    Tool: Bash (grep)
    Steps:
      1. `grep -c "v0.3.0" CHANGELOG.md` 실행
      2. 결과가 0보다 큰지 확인
    Expected Result: count >= 1
    Failure Indicators: count == 0
    Evidence: .sisyphus/evidence/task-11-changelog.txt
  ```

  **Commit**: YES
  - Message: `docs: update README/CHANGELOG for v0.3.0`
  - Files: `README.md`, `README.ko.md`, `CHANGELOG.md`, `AGENTS.md`

---

- [ ] 12. Fingerprint 자동화 파이프라인 (생성+적용+serviceMachineId)

  **What to do**:
  - `src/services/fingerprint.ts` 신규 모듈:
    1. `generateSystemFingerprint_func()`: 시스템 fingerprint 생성
       - cockpit `fingerprint.rs:10-260` 로직을 TypeScript로 이식 (copy-paste 수준)
       - 생성: machineId (UUID v4), platformInfo (os.arch + os.platform + os.release), hostname, username
       - 결과를 `~/.antigravity-cli/fingerprints/{accountName}.json`에 저장
    2. `loadFingerprint_func(accountName)`: 저장된 fingerprint 읽기
    3. `applyFingerprintToStateDb_func(stateDbPath, fingerprint)`: switch 시 state.vscdb에 적용
       - `storage.serviceMachineId`를 fingerprint.machineId로 교체
       - 기존 `authInject.ts:139-197`의 `injectAuthToStateDb_func`에 serviceMachineId 파라미터 전달 (파라미터 자체는 L144에 이미 존재, L188-191에 이미 구현됨)
    4. `bindFingerprintToAccount_func(accountName, fingerprintId)`: accounts.ts에 fingerprint_id 업데이트
  - `src/services/authLogin.ts` 수정:
    - 로그인 완료 후 `generateSystemFingerprint_func()` 호출
    - 생성된 fingerprint를 account에 바인딩
  - `src/services/authInject.ts` 수정:
    - 기존 `injectAuthToStateDb_func`의 `serviceMachineId?: string` 파라미터에 fingerprint.machineId 값을 전달하도록 호출부 수정 (파라미터 자체는 이미 L144에 존재)
    - 전달 시 `storage.serviceMachineId` upsert (이미 L188-191에 구현됨)
  - `src/main.ts` startup 경로 수정:
    - **Switch 흐름 2단계 위치**: `applyPendingSwitchIntentIfNeeded_func` (startup consumer)
    - 계정 전환은 이미 1단계(Task 8)에서 완료되었으므로, startup에서는 **fingerprint 적용만** 수행
    - pending-switch.json을 읽어 대상 계정 확인 → loadFingerprint → applyFingerprintToStateDb 실행
    - fingerprint가 없으면 신규 생성 후 적용
    - pending-switch.json은 삭제하지 않고 log로 유지
    - **참고**: Switch 흐름 1단계(post-response 즉시 전환+기록)는 Task 8에서 구현. **2단계(fingerprint 적용)만 Task 12에서 추가**
  - TDD: fingerprint.test.ts에 생성/저장/적용/바인딩 테스트

  **Must NOT do**:
  - fingerprint에 민감 정보(비밀번호, IP 등) 포함
  - 외부 네트워크 호출 (fingerprint 생성은 로컬만)
  - 기존 fingerprint.rs를 Rust 그대로 컴파일하지 않음 (TypeScript로 이식)
  - accounts.ts 스키마 재설계 (기존 fingerprint_id 필드 활용)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: cockpit Rust 코드를 TypeScript로 이식하는 복잡도 + auth inject 연동 + state.vscdb 쓰기
  - **Skills**: [`instruct--testing`]
    - `instruct--testing`: TDD 필수. 생성/저장/적용/바인딩 각 단계별 테스트

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 9 in Wave 3a)
  - **Parallel Group**: Wave 3a
  - **Blocks**: Task 10
  - **Blocked By**: Task 8 (switch 실행 구조 확정 후 fingerprint 적용 연동)

  **References**:

  **Pattern References** (existing code to follow):
  - `ref/cockpit-tools/src-tauri/src/modules/fingerprint.rs:10-260` — fingerprint 생성/저장/적용 로직 (copy-paste 원본)
  - `ref/cockpit-tools/src-tauri/src/modules/account.rs:132-191` — account-fingerprint binding
  - `ref/cockpit-tools/src-tauri/src/modules/account.rs:2247-2289` — switch 시 fingerprint 적용

  **API/Type References** (contracts to implement against):
  - `src/services/accounts.ts:53-79` — AccountDetail 인터페이스 (fingerprint_id 필드)
  - `src/services/authInject.ts:139-197` — injectAuthToStateDb_func (serviceMachineId 파라미터 추가)
  - `src/services/stateVscdb.ts` — StateDbReader.upsertTopicRowValuesAtomic (serviceMachineId 쓰기)

  **External References**:
  - `handoff-plan-spec/cockpit조사-01-auth.md` — auth login, fingerprint binding, auth inject 설계
  - `handoff-plan-spec/v0.2.1-01-investigation-cockpit-tools.md` — Device Fingerprints 섹션

  **WHY Each Reference Matters**:
  - `fingerprint.rs`: 생성 로직의 ground truth. machineId 생성, platformInfo 수집, JSON 저장 패턴을 그대로 이식
  - `account.rs:2247-2289`: switch 시 fingerprint를 state.vscdb에 어떻게 적용하는지 (storage.json + serviceMachineId 교체)
  - `authInject.ts`: 기존 auth inject에 serviceMachineId를 추가하는 확장 포인트

  **Acceptance Criteria**:
  - [ ] Test: generateSystemFingerprint_func이 UUID + platformInfo 포함 fingerprint 반환
  - [ ] Test: fingerprint가 ~/.antigravity-cli/fingerprints/{accountName}.json에 저장됨
  - [ ] Test: loadFingerprint_func이 저장된 fingerprint를 정상 읽기
  - [ ] Test: applyFingerprintToStateDb_func이 state.vscdb의 serviceMachineId를 교체
  - [ ] Test: auth login 완료 후 fingerprint 자동 생성 + 바인딩
  - [ ] Test: switch 실행 시 대상 계정 fingerprint 자동 적용
  - [ ] `bun test src/services/fingerprint.test.ts` → PASS (6+ tests)

  **QA Scenarios:**

  ```
  Scenario: Fingerprint 생성 + 저장
    Tool: Bash (bun test)
    Steps:
      1. generateSystemFingerprint_func("test-account") 호출
      2. ~/.antigravity-cli/fingerprints/test-account.json 파일 존재 확인
      3. JSON 내용에 machineId, platformInfo, hostname 포함 확인
    Expected Result: 파일 존재, 모든 필드 포함, machineId가 UUID v4 형식
    Failure Indicators: 파일 미생성, 필드 누락, machineId 형식 불일치
    Evidence: .sisyphus/evidence/task-12-fingerprint-generate.txt

  Scenario: Switch 시 fingerprint 자동 적용
    Tool: Bash (bun test)
    Steps:
      1. mock: 대상 계정에 fingerprint 이미 존재
      2. applyFingerprintToStateDb_func 실행
      3. state.vscdb의 storage.serviceMachineId 값 확인
    Expected Result: serviceMachineId === fingerprint.machineId
    Failure Indicators: serviceMachineId 미변경, 또는 기존 값 유지
    Evidence: .sisyphus/evidence/task-12-fingerprint-apply.txt

  Scenario: Auth login 시 자동 fingerprint 생성
    Tool: Bash (bun test)
    Steps:
      1. mock: authLogin_func 완료
      2. fingerprint 파일 생성 확인
      3. accounts.ts의 fingerprint_id 업데이트 확인
    Expected Result: fingerprint 파일 생성 + fingerprint_id !== 'original'
    Failure Indicators: fingerprint 미생성, fingerprint_id 여전히 'original'
    Evidence: .sisyphus/evidence/task-12-authlogin-fingerprint.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-12-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(fingerprint): add auto fingerprint generation on login and apply on switch`
  - Files: `src/services/fingerprint.ts`, `src/services/fingerprint.test.ts`, `src/services/authLogin.ts`, `src/services/authInject.ts`, `src/main.ts`

---

- [ ] 13. Offline-Gateway 최소 동작경로 (state.vscdb fast-path quota)

  **What to do**:
  - `src/services/quotaFastPath.ts` 신규 모듈:
    1. `readQuotaFromStateDb_func(stateDbPath)`: state.vscdb에서 직접 quota 읽기
       - `stateVscdb.ts:extractUserStatusSummary_func`를 활용
       - offline-only 환경에서도 LS spawn 없이 quota 즉시 조회
    2. `readQuotaFromLiveLs_func(config)`: live LS의 state.vscdb에서 quota 읽기
       - live attach 성공 시 해당 LS의 state.vscdb 경로로 직접 접근
    3. `getQuotaFastPath_func(accountName, config)`: 통합 진입점
       - live LS 존재 → live state.vscdb 읽기
       - live LS 없음 → account의 state.vscdb 읽기
       - 둘 다 실패 → null 반환 (기존 cloud API fallback)
  - `src/services/authList.ts` 수정:
    - `buildAuthListRows_func`에 fast-path 우선 적용
    - fast-path에서 읽은 quota를 card에 캐시
    - fast-path 실패 시에만 cloud API (기존 경로)로 fallback
  - `src/services/quotaClient.ts` 수정:
    - `fetchQuotaForAccounts_func`에서 fast-path를 먼저 시도
    - fast-path 성공 시 cloud API 호출 생략 (네트워크 절약)
  - TDD: quotaFastPath.test.ts에 fast-path/fallback 테스트

  **Must NOT do**:
  - fakeExtensionServer.ts 재작성 (재사용만)
  - liveAttach.ts 재작성 (재사용만)
  - 기존 offline session(LS spawn) 흐름 변경
  - Cloud Code API 직행 경로 제거 (fallback으로 유지)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: state.vscdb 구조 이해 + live/offline 양쪽 경로 통합 + 기존 코드와의 연동
  - **Skills**: [`instruct--testing`]
    - `instruct--testing`: TDD 필수. fast-path/fallback/live/offline 각 경로별 테스트

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 3, 4 in Wave 1b)
  - **Parallel Group**: Wave 1b
  - **Blocks**: Task 9
  - **Blocked By**: Task 1 (AccountDetail 필드 구조 확정 후 fast-path 활용)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/services/stateVscdb.ts:1456+` — extractUserStatusSummary_func (quota 파싱 ground truth)
  - `src/services/stateVscdb.ts:1381+` — extractOAuthAccessToken_func
  - `src/services/fakeExtensionServer.ts` — offline reverse RPC shim (재사용, 수정 없음)
  - `src/services/liveAttach.ts` — live LS fast-path (재사용, 수정 없음)

  **API/Type References** (contracts to implement against):
  - `src/services/quotaClient.ts` — fetchQuotaForAccounts_func (fast-path 우선 시도 후 fallback)
  - `src/services/authList.ts` — buildAuthListRows_func (fast-path 결과를 card에 캐시)
  - `src/services/accounts.ts:53-79` — AccountDetail (quota_cache 구조)

  **External References**:
  - `handoff-plan-spec/cockpit조사-03-quota.md` — Cloud Code API 직행 vs LS 1턴 wake-up 분리 설계
  - `handoff-plan-spec/v0.2.1-01-investigation-cockpit-tools.md` — quota.rs의 loadCodeAssist/fetchAvailableModels
  - `AGENTS.md` — live path/offline path 차이, state.vscdb 읽기 원칙

  **WHY Each Reference Matters**:
  - `stateVscdb.ts:extractUserStatusSummary_func`: quota 파싱의 ground truth. fast-path에서 이 함수를 직접 호출
  - `cockpit조사-03-quota.md`: quota 조회와 wake-up을 분리한 설계. fast-path는 조회만, wake-up은 기존 경로 유지
  - `AGENTS.md`: live path에서는 state.vscdb를 건드리지 않는 원칙 → 읽기 전용 접근으로 안전

  **Acceptance Criteria**:
  - [ ] Test: readQuotaFromStateDb_func이 offline state.vscdb에서 UserStatusSummary를 정상 읽기 (familyQuotaSummaries 배열 포함)
  - [ ] Test: 반환값의 각 항목이 familyName, remainingPercentage, exhausted, resetTime 포함
  - [ ] Test: readQuotaFromLiveLs_func이 live LS state.vscdb에서 UserStatusSummary를 정상 읽기
  - [ ] Test: getQuotaFastPath_func이 live → offline → null 순서로 fallback
  - [ ] Test: auth list에서 fast-path 성공 시 cloud API 미호출
  - [ ] Test: fast-path 실패 시 cloud API 정상 fallback
  - [ ] `bun test src/services/quotaFastPath.test.ts` → PASS (6+ tests)

  **QA Scenarios:**

  ```
  Scenario: Offline fast-path로 quota 즉시 읽기
    Tool: Bash (bun test)
    Steps:
      1. mock: state.vscdb에 uss-userStatus 데이터 존재
      2. readQuotaFromStateDb_func(stateDbPath) 호출
      3. 반환값에 familyQuotaSummaries 배열 포함 확인
    Expected Result: UserStatusSummary 객체 반환, familyQuotaSummaries에 각 familyName(GEMINI/CLAUDE/OTHER)별 remainingPercentage, exhausted, resetTime 포함
    Failure Indicators: null 반환, familyQuotaSummaries 누락, 필드 누락
    Evidence: .sisyphus/evidence/task-13-offline-fastpath.txt

  Scenario: Live LS fast-path로 quota 읽기
    Tool: Bash (bun test)
    Steps:
      1. mock: live LS 발견, 해당 state.vscdb에 quota 데이터 존재
      2. readQuotaFromLiveLs_func(config) 호출
    Expected Result: live LS의 quota 데이터 반환
    Failure Indicators: null 반환, 잘못된 데이터
    Evidence: .sisyphus/evidence/task-13-live-fastpath.txt

  Scenario: Fast-path 실패 → cloud API fallback
    Tool: Bash (bun test)
    Steps:
      1. mock: state.vscdb에 quota 데이터 없음
      2. getQuotaFastPath_func 호출
      3. cloud API가 대신 호출되는지 확인
    Expected Result: cloud API 호출 후 quota 데이터 반환
    Failure Indicators: null 반환, cloud API 미호출
    Evidence: .sisyphus/evidence/task-13-fallback.txt

  Scenario: 기존 테스트 회귀
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
    Expected Result: 기존 181+ 테스트 전부 PASS
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-13-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(quota): add state.vscdb fast-path for instant quota reading`
  - Files: `src/services/quotaFastPath.ts`, `src/services/quotaFastPath.test.ts`, `src/services/quotaClient.ts`, `src/services/authList.ts`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `deep`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

  **QA Scenarios:**
  ```
  Scenario: Must Have 전체 항목 존재 확인
    Tool: Bash (grep + bun test)
    Steps:
      1. plan에서 "Must Have" 항목 N개 추출
      2. 각 항목에 대해 구현 파일 존재 + bun test 통과 확인
      3. saveAccountCard_func → accounts.ts에 존재 확인
      4. auth refresh → main.ts에 handleAuthRefresh_func 존재 확인
      5. 90% reset 제거 → rotate.ts에 ">= 90" 패턴 미존재 확인
      6. effectiveFamily CLAUDE → main.ts에 'CLAUDE' 기본값 확인
    Expected Result: Must Have [N/N] 모두 구현 확인
    Failure Indicators: 항목 누락, 파일 미존재, 테스트 실패
    Evidence: .sisyphus/evidence/f1-must-have-audit.txt

  Scenario: Must NOT Have 금지 패턴 부재 확인
    Tool: Bash (grep)
    Steps:
      1. `grep -rn "access_token" pending-switch.json` → 0 matches
      2. `grep -rn "exponential" src/services/` → 0 matches
      3. `grep -rn "OfflineGateway" src/` → 0 matches
      4. rotate.ts에 bucket crossing 재작성 없음 (diff 확인)
      5. wakeup.ts에 filterWakeupCandidates 재작성 없음 (diff 확인)
    Expected Result: Must NOT Have [N/N] 모두 부재 확인
    Failure Indicators: 금지 패턴 발견
    Evidence: .sisyphus/evidence/f1-must-not-have-audit.txt

  Scenario: Evidence 파일 존재 확인
    Tool: Bash (ls)
    Steps:
      1. `.sisyphus/evidence/` 디렉토리에서 task-1-* ~ task-11-* 파일 존재 확인
      2. 각 task당 최소 2개 evidence 파일 (happy + regression) 확인
    Expected Result: 전체 task evidence 파일 존재
    Failure Indicators: evidence 파일 누락
    Evidence: .sisyphus/evidence/f1-evidence-check.txt
  ```

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test` + linter. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

  **QA Scenarios:**
  ```
  Scenario: 전체 테스트 통과
    Tool: Bash (bun test)
    Steps:
      1. `bun test` 전체 실행
      2. 181+ 기존 테스트 + 신규 테스트 모두 PASS 확인
    Expected Result: 0 failures, exit code 0
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/f2-test-results.txt

  Scenario: 코드 품질 검사 (AI slop + anti-patterns)
    Tool: Bash (grep)
    Steps:
      1. `grep -rn "as any" src/services/accounts.ts src/services/rotate.ts src/services/wakeup.ts src/main.ts` → 0 matches
      2. `grep -rn "@ts-ignore" src/` → 0 matches
      3. `grep -rn "console\\.log" src/services/accounts.ts src/services/rotate.ts src/services/wakeup.ts` → 0 matches (prod)
      4. `grep -rn "// TODO" src/services/accounts.ts src/services/rotate.ts src/services/wakeup.ts` → 0 matches (신규 코드)
    Expected Result: AI slop 0건, anti-pattern 0건
    Failure Indicators: as any, @ts-ignore, console.log 발견
    Evidence: .sisyphus/evidence/f2-code-quality.txt

  Scenario: TypeScript 컴파일 확인
    Tool: Bash (bunx tsc --noEmit)
    Steps:
      1. `bunx tsc --noEmit` 실행
      2. 에러 0건 확인
    Expected Result: 컴파일 성공, exit code 0
    Failure Indicators: type errors
    Evidence: .sisyphus/evidence/f2-tsc.txt
  ```

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

  **QA Scenarios:**
  ```
  Scenario: auth refresh → auth list 통합 (크로스태스크)
    Tool: Bash (agcl)
    Steps:
      1. `agcl auth refresh` 실행 → 전체 계정 quota 갱신 확인
      2. `agcl auth list` 실행 → 방금 갱신한 카드 기반 표시 확인 (네트워크 0회)
      3. 출력에 각 계정 tier, family 잔량, reset 시각 포함 확인
    Expected Result: auth refresh 후 auth list가 즉시 카드 표시 (< 1초)
    Failure Indicators: auth list가 다시 네트워크 호출, 필드 누락
    Evidence: .sisyphus/evidence/f3-cross-refresh-list.txt

  Scenario: 프롬프트 → post-response → rotate 통합
    Tool: Bash (agcl)
    Steps:
      1. `agcl "hello"` 실행 → pre-turn snapshot 저장 확인
      2. 응답 완료 후 post-response 파이프라인 실행 확인
      3. crossing 감지 시 pending-switch.json 생성 확인
      4. 다음 `agcl` 실행 시 새 계정으로 동작 확인 (switch 적용)
    Expected Result: end-to-end 파이프라인 정상 완료
    Failure Indicators: 중간 단계 실패, switch 미적용
    Evidence: .sisyphus/evidence/f3-cross-prompt-rotate.txt

  Scenario: 엣지 케이스 — 빈 상태 (계정 0개)
    Tool: Bash (agcl)
    Steps:
      1. accounts.json 빈 상태에서 `agcl auth list` 실행
      2. graceful 빈 출력 또는 안내 메시지 확인
    Expected Result: 에러 없이 빈 상태 처리
    Failure Indicators: unhandled exception, crash
    Evidence: .sisyphus/evidence/f3-edge-empty.txt

  Scenario: 엣지 케이스 — 네트워크 불가
    Tool: Bash (agcl)
    Steps:
      1. 네트워크 차단 상태에서 `agcl auth refresh` 실행
      2. graceful 에러 처리 + 캐시된 카드로 표시 확인
      3. exit code 0 (부분 성공)
    Expected Result: fetch_error 저장, 캐시로 대체 표시
    Failure Indicators: crash, exit code != 0
    Evidence: .sisyphus/evidence/f3-edge-offline.txt
  ```

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

  **QA Scenarios:**
  ```
  Scenario: Task별 spec 대비 구현 1:1 매칭
    Tool: Bash (git diff)
    Steps:
      1. 각 task의 "What to do" 항목을 추출
      2. 해당 commit의 diff를 읽어 구현 내역 확인
      3. 명세에 있는 항목이 모두 구현되었는지 확인
      4. 명세에 없는 항목이 추가되었는지 확인 (scope creep)
    Expected Result: Tasks [11/11 compliant], 범위 외 변경 0건
    Failure Indicators: 명세 항목 누락, scope creep 감지
    Evidence: .sisyphus/evidence/f4-scope-fidelity.txt

  Scenario: Must NOT do 준수 확인
    Tool: Bash (grep + git diff)
    Steps:
      1. 각 task의 "Must NOT do" 항목 추출
      2. git diff에서 해당 위반 패턴 검색
      3. rotate.ts 재작성 여부 (diff 크기가 전체 교체 수준인지)
      4. wakeup.ts filterWakeupCandidates_func 변경 여부
      5. accounts.ts AccountDetail 인터페이스 변경 여부
    Expected Result: Must NOT do [N/N] 위반 0건
    Failure Indicators: 재작성 감지, 인터페이스 변경
    Evidence: .sisyphus/evidence/f4-must-not-do.txt

  Scenario: Cross-task contamination 확인
    Tool: Bash (git log --stat)
    Steps:
      1. 각 task commit의 변경 파일 목록 추출
      2. Task N이 Task M의 파일을 건드렸는지 확인
      3. 단, Task 9 (main.ts 통합)은 예외 (여러 task 결과 통합이 목적)
    Expected Result: Contamination [CLEAN] (Task 9 제외)
    Failure Indicators: Task가 자기 범위 밖 파일 수정
    Evidence: .sisyphus/evidence/f4-contamination.txt

  Scenario: Unaccounted changes 확인
    Tool: Bash (git diff --stat)
    Steps:
      1. 전체 diff에서 변경된 파일 목록 추출
      2. 각 파일이 어느 task에 속하는지 매핑
      3. 매핑되지 않은 파일이 있는지 확인
    Expected Result: Unaccounted [CLEAN] — 모든 변경이 task에 매핑됨
    Failure Indicators: 매핑 안 된 변경 파일 존재
    Evidence: .sisyphus/evidence/f4-unaccounted.txt
  ```

---

## Commit Strategy

| Wave | Commit | Files |
|------|--------|-------|
| 1a | `feat(accounts): add saveAccountCard pipeline + fix discoverAccounts userDataDirPath for managed accounts` | accounts.ts, accounts.test.ts, quotaClient.ts |
| 1a | `fix(rotate): remove 90% bucket reset + default effectiveFamily to CLAUDE` | rotate.ts, rotate.test.ts, main.ts, main.test.ts |
| 1b | `feat(auth): add auth refresh command for forced full quota refresh` | main.ts, main.test.ts, quotaClient.ts, quotaClient.test.ts |
| 1b | `feat(auth-list): lightweight card-based display with selective parallel refresh` | main.ts, main.test.ts, authList.ts, authList.test.ts |
| 1b | `feat(quota): add state.vscdb fast-path for instant quota reading` | quotaFastPath.ts, quotaFastPath.test.ts, quotaClient.ts, authList.ts |
| 2 | `feat(wakeup): add executeWakeup orchestration for dormant accounts` | wakeup.ts, wakeup.test.ts |
| 2 | `feat(wakeup): integrate wake-up at all 4 timings` | main.ts, main.test.ts |
| 2 | `feat(rotate): add post-response rotate pipeline with pre/post-turn comparison` | main.ts, main.test.ts |
| 2 | `feat(rotate): implement switch-for-next-invocation + extend pending-switch schema` | rotate.ts, rotate.test.ts |
| 3 | `feat(main): integrate auth refresh, lightweight list, pre/post-prompt pipelines` | main.ts, main.test.ts |
| 3 | `feat(fingerprint): auto fingerprint generation on login and apply on switch` | fingerprint.ts, fingerprint.test.ts, authLogin.ts, main.ts (authInject.ts는 기존 파라미터 활용) |
| 3 | `test: add edge case coverage for v0.3.0 auth/rotate/wakeup` | 각 모듈 test 파일 |
| 3 | `docs: update README/CHANGELOG for v0.3.0` | README.md, README.ko.md, CHANGELOG.md, AGENTS.md |

---

## Success Criteria

### Verification Commands
```bash
bun test                                    # Expected: 전체 PASS (181+ 기존 + 신규)
agcl auth refresh                           # Expected: 전체 계정 quota 갱신 + wake-up 후보 표시
agcl auth list                              # Expected: 카드 기반 표시, < 5초 (fast-path 우선)
agcl "hello"                                # Expected: pre-turn snapshot + 백그라운드 wake-up
                                            # Post-response: rotate 판단 → switch 기록 (필요 시)
grep -r "access_token" pending-switch.json  # Expected: no matches (token 없음)
grep -r ">= 90" src/services/rotate.ts      # Expected: no matches (90% reset 제거됨)
ls ~/.antigravity-cli/fingerprints/*.json   # Expected: auth login 후 fingerprint 파일 존재
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (기존 181+ + 신규)
- [ ] auth refresh → 전체 갱신 + wake-up
- [ ] auth list → 카드 기반 + 선택적 갱신 + fast-path 우선
- [ ] Post-response rotate → crossing 감지 → switch 기록
- [ ] Wake-up 4개 타이밍 모두 동작
- [ ] effectiveFamily = CLAUDE 기본
- [ ] 90% bucket reset 제거됨
- [ ] pending-switch.json에 token 없음
- [ ] Fingerprint: auth login 시 자동 생성 + switch 시 자동 적용 + serviceMachineId 동기화
- [ ] Offline-Gateway: state.vscdb fast-path로 offline에서도 quota 즉시 조회
