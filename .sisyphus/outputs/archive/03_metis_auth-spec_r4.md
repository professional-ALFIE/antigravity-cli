# Metis 4차 검증: v0.2.1 Auth Overhaul Spec — r4 Review

> **검증 대상**: `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`
> **3차 결과**: ALL CLEAR (0 new findings, 17/17 PASS)
> **4차 트리거**: §7-3 전면 재작성 + QA 시나리오 대폭 추가로 인한 신규 모순 가능성
> **판정**: ⚠️ CONDITIONAL — 1 CRITICAL, 3 WARNING, 4 INFO

---

## Intent Classification
**Type**: Mid-sized Task (spec validation)
**Confidence**: High
**Rationale**: 3차 ALL CLEAR 이후 제한적 섹션(§7-3) 재작성으로 인한 회귀 검증

---

## Findings Summary

| # | Severity | Section | Finding | Status |
|---|----------|---------|---------|--------|
| F1 | 🔴 CRITICAL | §4-3 / L-8 | Local Import에 `refresh_token` 획득 경로 누락 | NEW |
| F2 | 🟡 WARNING | §7-3 / §8-4 | "Full Switch" 용어가 inject-primitive와 wake-up-flow에 과도 확장 | NEW |
| F3 | 🟡 WARNING | §7-3 / W-1 | W-1이 auth inject(5a) 단계를 직접 검증하지 않음 | NEW |
| F4 | 🟡 WARNING | §6-5 / S-4 | stale intent 삭제 타이밍이 모호 (초기 체크 vs rotate 후) | NEW |
| F5 | 🔵 INFO | §5-3 / A-5 | current_account_id 갱신 — 일치 | PASS |
| F6 | 🔵 INFO | §4 / E2E-1 | L-7과의 관계: 상위 통합 테스트로 정상 | PASS |
| F7 | 🔵 INFO | §5-3 / S-2 | inject 3-key 한정성 + trajectorySummaries 보존 — 일치 | PASS |
| F8 | 🔵 INFO | §7-3 / §7-1 §7-2 | null-quota 판정 + cooldown 흐름 — 논리 일치 | PASS |

---

## CRITICAL: F1 — Local Import `refresh_token` Gap

### Problem

§4-3 Local Import는 기존 `user-data-dir`의 `state.vscdb`에서 토큰을 추출한다:

```
3. uss-oauth topic bytes에서 access_token 추출
```

하지만 §9-2 Account Store 스키마는 `refresh_token`을 필수 필러로 요구한다:

```json
"token": {
  "access_token": "ya29.xxx",
  "refresh_token": "1//xxx",
  ...
}
```

L-8 테스트는 `refresh_token` 필드 존재를 기대한다:

> `cat ~/.antigravity-cli/accounts/{id}.json` → refresh_token 필드 존재 확인

**현재 state.vscdb의 `uss-oauth` topic bytes에는 `access_token`만 있지, `refresh_token`은 없을 가능성이 높다.** (Antigravity 앱이 내부적으로 Google OAuth를 수행하지만, refresh_token을 uss-oauth topic에 포함하는지는 미확인.)

### Gap Analysis

1. §4-3은 access_token 추출만 설명
2. refresh_token 출처가 불분명
3. 가능한 시나리오:
   - a) uss-oauth에 refresh_token도 포함되어 있음 (조사 필요)
   - b) refresh_token 없이 access_token만 저장 → 1시간 후 만료 → 계정 무용
   - c) Local Import는 access_token만 저장하고, 최초 사용 시 refresh 흐름 트리거

### Recommended Fix

§4-3에 다음 중 하나를 명시:
- **Option A**: "uss-oauth topic bytes에서 access_token과 refresh_token을 추출" (둘 다 있는 경우)
- **Option B**: "access_token만 추출 후, 최초 API 호출 시 refresh token 획득" (동적 refresh)
- **Option C**: L-8의 기대를 access_token 존재로 한정하고 refresh_token은 nullable로 스키마 변경

이것이 **v0.2.1 전체 마이그레이션 경로의 블로커**이므로 반드시 r4에서 해결 필요.

---

## WARNING: F2 — "Full Switch" Terminology Overextension

### Problem

§8-4는 Full Switch를 다음과 같이 정의한다:

> "`state.vscdb`에 auth 키만 쓴다. LS 재시작은 하지 않는다."

이 정의는 §5-3(auth list 선택)과 §6-5(auto-rotate)에서는 정확히 들어맞는다. 두 경우 모두 inject만 하고 LS를 건드리지 않는다.

하지만 §7-3 step 5a는:

```
5a. auth inject → state.vscdb (Full Switch 경로, §5-3과 동일 계약)
5b. offline LS spawn
```

"Full Switch 경로"라고 부르면서 바로 다음에 LS를 spawn한다. **inject substep 자체는 Full Switch와 일치하지만, 전체 wake-up flow는 Full Switch가 아니다.**

### Impact

독자/구현자가 §7-3을 읽을 때:
- "Full Switch = LS 재시작 없음"인데 wake-up은 LS를 띄움 → 혼란
- §8-4의 Full Switch 정의와 직접 충돌하는 것으로 보임

### Recommended Fix

1. **§7-3 step 5a**: "Full Switch 경로" → "§5-3과 동일한 auth inject payload"로 변경
2. **§8-4**: Full Switch 정의 뒤에 다음 예외 문구 추가:

> 이 정의는 auth inject primitive 자체에 적용된다. Wake-up(§7)은 동일한 inject payload를 재사용하지만, 1턴 실행을 위해 별도 LS를 spawn하는 독자적 실행 흐름을 가진다.

---

## WARNING: F3 — W-1 Auth Inject Coverage Gap

### Problem

§7-3의 실행 흐름:

```
5a. auth inject → state.vscdb  ← 검증 안 됨
5b. offline LS spawn           ← W-1 검증
5c. StartCascade               ← W-1 검증
5d. 응답 대기                  ← W-1 검증
5e. LS 종료                    ← W-1 검증
5f. 결과 기록                  ← W-1 검증
```

W-1은 5b~5f를 검증하지만, **5a auth inject 자체는 직접 검증하지 않는다.** inject가 빠져도 테스트가 통과할 수 있다.

### Recommended Fix

W-1 절차에 추가:

> 1.5) `sqlite3 <state.vscdb> "SELECT length(value) FROM ItemTable WHERE key='antigravityUnifiedStateSync.oauthToken'"` → inject 전후로 값 변경 확인

또는:

> 1.5) mock authInject 호출 spy → 호출 횟수 및 인자 확인

---

## WARNING: F4 — Stale Intent Deletion Timing Ambiguity

### Problem

§6-5는:

```
[CLI 시작 — 메시지 전송 경로만]
  → pending-switch.json 확인:
     - 메시지 전송 경로 → pending intent 적용 (auth inject) → 파일 삭제
```

그리고:

> Stale intent 폐기: decided_at이 24시간 이상 경과한 intent는 무시하고 삭제.

S-4는 24h+1s 경과 후 `agcl "hello"` 실행 시 파일이 삭제되는지 확인한다.

하지만 **삭제가 언제 일어나는지**가 모호하다:
- CLI 시작 직후 pending-switch 체크에서 즉시?
- 아니면 rotate 판정 이후?

S-4의 절차는 "agcl 'hello' 실행 → pending-switch.json이 무시됨 확인 → 파일 삭제됨 확인"이지만, 삭제 타이밍이 rotate 후인지 initial check인지 불분명.

### Recommended Fix

§6-5에 명시:

> **Stale check timing**: pending-switch.json의 stale 판정은 CLI 시작 시 첫 번째 확인 단계에서 즉시 수행된다. stale이면 rotate 판정에 들어가기 전에 파일을 삭제하고, rotate를 건너뛴다.

---

## Additional Observations (not blocking)

### §7-3: `current_account_id` Side Effect Ambiguity

Wake-up이 공유 `state.vscdb`에 inject할 때:
- §5-3의 inject는 `current_account_id` 갱신을 포함한다
- Wake-up도 "§5-3과 동일 계약"을 참조하므로, wake-up 시 current_account_id가 wake-up 대상 계정으로 바뀜
- Wake-up 후 원래 계정으로 복원해야 하는지? 아니면 그대로 두는지?

**Severity**: INFO (구현 시 결정 필요, spec에 명시하면 더 명확)

**Recommendation**: §7-3에 다음을 명시:

> wake-up은 current_account_id를 wake-up 대상 계정으로 임시 변경한다. wake-up 완료 후 원래 active 계정으로 복원한다.
> 또는: wake-up은 current_account_id를 변경하지 않는다 (별도 state.vscdb 경로 사용).

### §7-3 Step 1 Prose: Cooldown 암시적 제외

§7-3 prose: "forbidden/disabled가 아닌 모든 계정을 순회"

하지만 step 1 코드 블록: "제외: cooldown 중 (30분 이내 실패)"

Prose에 "cooldown"이 빠져 있어서, 독자가 step 1을 읽기 전에는 cooldown 제외를 놓칠 수 있음.

**Severity**: INFO (prose 보강으로 해결)

---

## Directives for Prometheus

### Core Directives

- **MUST**: F1 해결 — §4-3에 refresh_token 획득 경로를 명시적으로 추가 (또는 L-8 기대치를 access_token으로 한정)
- **MUST**: F2 해결 — §7-3 step 5a에서 "Full Switch 경로"를 "§5-3과 동일한 auth inject payload"로 변경, §8-4에 wake-up 예외 문구 추가
- **MUST**: F3 해결 — W-1에 auth inject 단계 검증 추가
- **MUST**: F4 해결 — §6-5에 stale intent 삭제 타이밍 명시 ("CLI 시작 시 첫 번째 확인 단계에서 즉시")
- **SHOULD**: §7-3에 current_account_id side effect 명시
- **SHOULD**: §7-3 prose에 "cooldown" 제외 조건 추가
- **PATTERN**: Follow `§5-3 inject 3-key contract` as the canonical auth overlay primitive
- **PATTERN**: "Full Switch" 용어는 inject primitive에만 사용, 전체 flow에는 사용하지 않음

### QA/Acceptance Criteria Directives

- **MUST**: L-8의 refresh_token 기대가 §4-3의 추출 능력과 일치하도록 둘 중 하나를 수정
- **MUST**: W-1이 §7-3 step 5a(inject)를 직접 검증하도록 보강
- **MUST NOT**: S-4의 "파일 삭제" 기대가 타이밍 모호성을 가지도록 둘 것
- **MUST NOT**: "Full Switch"를 wake-up 전체 flow에 적용할 것

---

## Recommended Approach

F1(refresh_token gap)만 spec 차원에서 반드시 해결해야 한다. 나머지 F2~F4는 문구 수정만으로 해결되며, 구현에 영향을 주지 않는다. §7-3의 기술적 설계(6단계 흐름, null-quota 판정, cooldown) 자체는 §7-1/§7-2와 논리적으로 일치하므로, 용어 정리만으로 충분하다.
