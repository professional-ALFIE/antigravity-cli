# Metis 5th Validation — v0.2.1 Auth Overhaul Spec

> **검증 대상**: `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`
> **검증 일시**: 2026-04-15 R5
> **이전 결과**: Metis 4차 ⚠️ CONDITIONAL (1 CRITICAL, 3 WARNING, 4 INFO)

---

## Executive Summary

**판정: ✅ PASS — 0 CRITICAL, 0 WARNING, 3 INFO**

F1~F4 모두 해결 확인. §4-3 재작성과 §7-3 용어 정리로 인한 새로운 모순은 발견되지 않음. 전체 spec 일관성 종합 재확인 결과, 섹션 간 교차 레퍼런스와 계약이 정합함.

---

## 1. F1 (refresh_token gap) — ✅ RESOLVED

### 4차 지적
§4-3 Local Import에서 `refresh_token` 획득 경로가 명시되지 않았고, L-8 기대치가 refresh_token 존재를 전제로 했음.

### 5차 확인

**§4-3 (L130~137)** 에 명시적으로 2개 경로 추가됨:
- 5a: `uss-oauth`에 `refresh_token` 포함 시 → 직접 추출
- 5b: 미포함 시 → `access_token`만 저장, 최초 Cloud Code API 호출 시 `token expired error` → Google OAuth refresh flow로 획득

**L140~141 (blockquote)**: `refresh_token nullable` 명시:
> "이 경우 token.refresh_token은 null이고, 최초 API 호출 시 획득한다."

**L-8 (L163)**: 기대치 수정:
> "refresh_token은 nullable (최초 API 호출 시 획득)"

**평가**: ✅ 완전 해결. nullable 경로가 구체적이고 테스트 기대치와 정합함.

---

## 2. F2 (Full Switch 용어 혼란) — ✅ RESOLVED

### 4차 지적
§7-3 step 5a에서 "Full Switch 경로"라고 했지만, Full Switch(§8-4)는 `state.vscdb` 쓰기만 하는 경로인 반면 wake-up은 별도 LS spawn이 필요한 독자적 흐름.

### 5차 확인

**§7-3 step 5a (L413)**:
> "auth inject → state.vscdb (§5-3과 동일한 inject payload: oauthToken, agentManagerInitState, onboarding)"

"Full Switch 경로"라는 용어가 제거되고 "§5-3과 동일한 inject payload"로 변경됨.

**§8-4 (L469)** wake-up 예외 문구 추가:
> "Wake-up(§7)은 동일한 inject payload를 재사용하지만, 1턴 실행을 위해 별도 LS를 spawn하는 독자적 실행 흐름을 가진다. 이것은 'Full Switch'가 아니라 'wake-up 전용 경로'다."

**평가**: ✅ 완전 해결. inject payload 재사용은 명확히 하되, 실행 흐름의 차이를 분리함.

---

## 3. F3 (W-1 authInject 검증 부족) — ✅ RESOLVED

### 4차 지적
W-1에서 authInject 호출을 spy로 검증하는 내용이 없었음.

### 5차 확인

**W-1 (L429)** 절차 3:
> "3) authInject spy 확인 → 호출 1회 + 인자에 올바른 access_token 포함 확인."

**기대 결과**:
> "auth inject → LS spawn → 1턴 → 종료 로그가 순서대로 출력됨"

**평가**: ✅ 완전 해결. 호출 횟수(1회) + 인자 검증(access_token 포함)이 구체적으로 명시됨.

---

## 4. F4 (stale timing 모호) — ✅ RESOLVED

### 4차 지적
§6-5에서 stale intent 삭제 타이밍이 "확인 시"로만 돼 있어 정확한 시점이 불명확.

### 5차 확인

**§6-5 (L344)**:
> "pending-switch.json의 stale 판정은 CLI 시작 시 첫 번째 확인 단계에서 즉시 수행된다. stale이면 rotate 판정에 들어가기 전에 파일을 삭제하고, rotate를 건너뛴다."

**평가**: ✅ 완전 해결. "CLI 시작 시 첫 번째 확인 단계에서 즉시"가 구체적이고, "rotate 판정 전 삭제 + rotate 스킵"이 실행 순서를 명확히 함.

---

## 5. §4-3 재작성 + §7-3 용어 정리로 인한 새로운 모순 분석

### 5-1. §4-3 refresh_token nullable ↔ §5-3 inject 시 access_token 갱신

§5-3 (L211):
> "대상 계정의 refresh_token → access_token 갱신 (access_token이 5분 이내 만료 시에만 refresh)"

**잠재적 충돌**: refresh_token이 null인 계정을 inject하려고 할 때 refresh 불가.

**평가**: 이것은 실제 버그가 아님. §4-3에서 이미 "최초 API 호출 시 refresh_token 획득" 경로를 정의했으므로, accounts.json에 저장된 계정은 이미 refresh_token이 채워져 있거나 access_token이 유효함. inject 시점에 refresh_token이 null + access_token 만료 상태라면 refresh 실패 → 명확한 에러 처리. **새로운 모순 아님.**

### 5-2. §7-3 "모든 계정 순회" ↔ §6-2 "메시지 전송 경로에서만"

§7-3 (L394): "accounts.json에 등록된 모든 계정을 순회"
§6-2 (L259): "메시지 전송 경로에서만"

**평가**: 충돌 아님. §6-2는 auto-rotate 트리거 조건이고, §7-3은 wake-up 대상 범위. 서로 다른 feature의 독립적 스코프. **새로운 모순 아님.**

### 5-3. §7-3 current_account_id side effect ↔ §5-3 inject 후 current_account_id 갱신

§7-3 blockquote (L401): "wake-up은 5a 단계에서 current_account_id를 wake-up 대상 계정으로 임시 변경. 완료 후 원래 active 계정으로 복원."
§5-3 (L213): "accounts.json에서 current_account_id 갱신"

**평가**: 이 경로는 의도적으로 다름. wake-up은 임시 변경 + 복원이고, auth list 선택은 영구 변경. 명시적으로 구분되어 있음. **새로운 모순 아님.**

### 5-4. §8-4 예외 문구 ↔ §5-3/§6-5 계약

§8-4 (L469): "Wake-up은 Full Switch가 아니라 wake-up 전용 경로"
§5-3 Full Switch Default blockquote (L223~226): 동일 계약 (state.vscdb 쓰기만, LS kill/respawn 없음)

**평가**: wake-up은 inject payload는 재사용하지만 LS spawn이 추가되는 독자적 경로. §5-3 계약은 "inject만"이고, §7은 "inject + LS spawn + 1턴". §8-4 예외 문구가 이 구분을 명시적으로 선언함. **정합. 새로운 모순 아님.**

---

## 6. 전체 Spec 일관성 종합 재확인

### 6-1. 섹션 간 교차 레퍼런스 정합성

| From | To | 참조 내용 | 정합 여부 |
|------|----|----------|----------|
| §4-3 L136 | §4-2 | "OAuth로 얻은 것과 동일한 형식" | ✅ 동일 스키마 (§9-2) |
| §5-3 L213 | §5-1 | "quota fetch §5-1과 동일한 5분 정책" | ✅ 동일 정책 |
| §5-3 L223 | §6-5, §8-4 | "공통 계약" blockquote | ✅ 세 곳 동일 |
| §6-5 L327 | §5-3 | "§5-3과 동일 계약" | ✅ 동일 |
| §7-3 L413 | §5-3 | "§5-3과 동일한 inject payload" | ✅ payload만 동일, 실행 흐름은 별도 |
| §8-4 L469 | §7 | "Wake-up(§7)은 독자적 실행 흐름" | ✅ 예외 명시 |
| §9 스키마 | §4~8 | 4-state enum, rotation family_buckets, wakeup_history | ✅ 모든 feature에서 동일 스키마 참조 |
| §12 구현순서 | §4~8 | Phase 2-A~2-F 매핑 | ✅ 순서 정합 |
| §13 참조맵 | §4~8 | Cockpit/IDE 코드 라인 매핑 | ✅ 구체적 |

### 6-2. 4-state enum 일관성

| Status | §5-3에서 사용 | §6-6에서 사용 | §7-1에서 사용 | §9-2 정의 | 정합 |
|--------|-------------|-------------|-------------|----------|------|
| `active` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `protected` | (§6-3에서 정의) | ✅ 제외 | ❌ 불필요 | ✅ | ✅ |
| `forbidden` | ✅ (§5-1 403) | ✅ 제외 | ✅ 제외 | ✅ | ✅ |
| `disabled` | — | ✅ 제외 | ✅ 제외 | ✅ | ✅ |

### 6-3. 파일 레퍼런스 일관성

| 신규 파일 | §4-4 | §5-4 | §12 | §13 | 정합 |
|-----------|------|------|-----|-----|------|
| `oauthClient.ts` | ✅ | — | Phase 2-A | ✅ | ✅ |
| `quotaClient.ts` | — | ✅ | Phase 2-B | ✅ | ✅ |
| `authInject.ts` | — | ✅ | Phase 2-B | ✅ | ✅ |
| `wakeup.ts` | — | — | Phase 2-D | ✅ | ✅ |

### 6-4. 성공 조건 ID 교차 검증

| ID | Feature 섹션 | §10 E2E에서 참조 | 정합 |
|----|-------------|-----------------|------|
| L-1~8 | §4-5 | E2E-1에서 L 계열 | ✅ |
| A-1~7 | §5-5 | E2E-2에서 A 계열 | ✅ |
| R-1~6 | §6-7 | E2E-3, E2E-5에서 R 계열 | ✅ |
| W-1~5 | §7-4 | E2E-4에서 W 계열 | ✅ |
| SS-1~3 | §8-5 | — (experimental) | ✅ |
| NF-1~5 | §10-2 | — | ✅ |
| S-1~4 | §10-3 | — | ✅ |

---

## 7. INFO 발견 사항 (3건)

### INFO-1: §7-3 current_account_id 임시 변경의 복원 보장

**위치**: §7-3 L401

wake-up이 current_account_id를 임시 변경 후 복원한다고 했지만, LS spawn 실패 시 복원 경로가 명시되지 않음.

**심각도**: INFO (구현 시 try/finally로 자연스럽게 해결 가능)

**권장**: 구현 시 try/finally로 current_account_id 복원을 보장하는 것을 주석으로 명시.

### INFO-2: §9 단일 인스턴스 가정의 실제 보장

**위치**: §9 L500

> "pending-switch.json은 CLI 단일 인스턴스를 가정한다."

파일 잠금(flock)이나 PID 파일이 명시되지 않음. 동시 실행 시 pending-switch.json 경쟁 조건 가능.

**심각도**: INFO (v0.2.1 scope에서 명시적 제외. §11 NOT NOW에 "multi-workspace"가 있고 §9에도 명시됨)

**권장**: 현상태 유지. v0.2.2에서 파일 잠금 도입 시 고려.

### INFO-3: §5-1 quota fetch의 "5분 이내 만료" 임계값 출처

**위치**: §5-1 L185, §5-3 L211

access_token 만료 임박 판정을 "5분 이내"로 했지만, Google OAuth 기본 만료 시간(1시간)과의 관계가 명시되지 않음.

**심각도**: INFO (합리적 임계값이며 구현에 영향 없음)

**권장**: Cockpit Tools의 기준값이 있는지 확인. 없다면 5분 그대로 사용.

---

## 8. 종합 판정

| 항목 | 상태 |
|------|------|
| F1 (refresh_token gap) | ✅ RESOLVED |
| F2 (Full Switch 용어) | ✅ RESOLVED |
| F3 (W-1 inject 검증) | ✅ RESOLVED |
| F4 (stale timing) | ✅ RESOLVED |
| §4-3 + §7-3 재작성 모순 | ✅ NO NEW CONTRADICTIONS |
| 섹션 간 교차 레퍼런스 | ✅ CONSISTENT |
| 4-state enum 일관성 | ✅ CONSISTENT |
| 파일 레퍼런스 일관성 | ✅ CONSISTENT |
| 성공 조건 ID 교차 | ✅ CONSISTENT |
| **최종 판정** | **✅ PASS** |

---

## 9. Directives for Prometheus

### Core Directives
- MUST: §4-3 refresh_token nullable 경로를 그대로 구현 (5a/5b 분기)
- MUST: §7-3 wake-up을 "Full Switch"가 아닌 "inject + LS spawn" 독자 경로로 구현
- MUST: W-1 테스트에서 authInject spy 호출 1회 + 인자 검증 포함
- MUST: §6-5 stale check를 "CLI 시작 시 첫 번째 단계에서 즉시" 구현
- MUST: §7-3 current_account_id 임시 변경에 try/finally 복원 보장
- MUST NOT: wake-up을 Full Switch 계약에 포함시키려 함
- MUST NOT: §4-3에서 refresh_token 미획득을 에러로 처리 (nullable 정상 경로)

### PATTERN
- inject payload: §5-3, §6-5, §7-3 모두 동일 (oauthToken + agentManagerInitState + onboarding)
- quota fetch: §5-1 (auth list), §6-5 (auto-rotate), §7-2 (wake-up) 모두 동일한 quotaClient 사용

### QA/Acceptance
- 모든 L-1~8, A-1~7, R-1~6, W-1~5 테스트에 구체적 mock/fixture/어서션이 명시됨
- E2E-3에 QUOTA_MOCK_DIR 환경변수 + fixture 파일 메커니즘 명시
- E2E-4에 wake-up 자동 트리거가 메시지 전송 경로에서 발생함이 명시
