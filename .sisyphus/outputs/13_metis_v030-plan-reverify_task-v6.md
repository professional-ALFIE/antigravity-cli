# 6th Gap Analysis: Plan v030-auth-rotate vs Mandate v030-spec-plan

**Date**: 2026-04-17
**Input**: 15-prometheus-v030-plan-reverify-task-v6.md
**Plan**: `.sisyphus/plans/01-plan-v030-auth-rotate.md`
**Mandate**: `.sisyphus/mandate_v030-spec-plan.md`

---

## 1. Issue Resolution Verification (5th Momus REJECT — 3 items)

### Issue 1: auth list "즉시 표시" vs "갱신 후 표시" 충돌 → ✅ RESOLVED

**Mandate requirement (L24)**: "`auth list`는 즉시 표시 + 필요한 계정만 소수 selective refresh"

**Plan fix verification**:
- **SC-2 (L122-131)**: Correctly describes 3-stage flow: (1) cache immediate render → (2) stale account parallel refresh → (3) re-render. Matches mandate exactly.
- **Task 4 What to do (L606-615)**: Explicitly lists 3 stages with "1단계 — 캐시 즉시 렌더링" at 0ms wait. Correct.
- **Acceptance Criteria (L639-644)**: Includes "1단계 캐시 즉시 렌더링이 네트워크 대기 전에 실행됨" test. Correct.
- **QA Scenario (L650-658)**: Includes "1단계 캐시 즉시 렌더링" scenario verifying first render happens before network call. Correct.

**Verdict**: ✅ Fully resolved. No residual conflict.

### Issue 2: switch/pending-switch 시점 충돌 → ✅ RESOLVED

**Mandate requirements**:
- L22: "`pending-switch.json`은 적용 기록으로 고정"
- L29: "post-prompt rotate는 같은 실행 안에서 즉시 적용"

**Plan fix verification**:
- **SC-7 (L170-182)**: Clearly defines 3-stage Switch flow:
  - Stage 1 (current session, post-response): pending-switch.json write + accounts.json change
  - Stage 2 (next execution startup): pending-switch.json consumed → account switch confirmed
  - Stage 3 (next execution startup): fingerprint load → apply to state.vscdb
- **Task 8 What to do (L988-1018)**: Includes Switch flow summary diagram + explicit statement "다음 실행부터 적용 = 계정 전환의 시점". Correct.
- **Task 8 Switch 흐름 요약 (L1004-1018)**: Shows clear pipeline from current session to next startup. No ambiguity.
- **Task 12 (L1331-1334)**: Explicitly states fingerprint apply is at Switch flow Stage 3 position in startup.

**Timing consistency check**:
- Rotate DECISION: current session, post-response (immediate) → ✅ matches mandate L29
- Switch RECORD: current session, post-response (immediate) → ✅ matches mandate L22 (pending-switch.json as record)
- Account EFFECTIVE: next execution startup → ✅ matches mandate L29 ("같은 실행 안에서 즉시 적용" refers to the decision+record, not LS restart)
- Fingerprint APPLY: next execution startup → ✅ correct position

**Verdict**: ✅ Fully resolved. The "즉시 적용" in mandate L29 refers to the switch decision/recording being immediate, while the actual LS restart is next execution. This is now unambiguous.

### Issue 3: Task 13 QA 반환 shape 불일치 → ✅ RESOLVED

**Plan fix verification**:
- **Task 13 Acceptance Criteria (L1497-1498)**: Now correctly specifies:
  - "familyQuotaSummaries 배열 포함" (not gemini_used/claude_used)
  - "각 항목이 familyName, remainingPercentage, exhausted, resetTime 포함"
- **Task 13 QA Scenario (L1514)**: Expected result correctly describes `UserStatusSummary` with `familyQuotaSummaries` containing `familyName, remainingPercentage, exhausted, resetTime`
- **Test count**: Updated to "6+ tests" (L1503)

**Cross-reference with actual code**:
- `stateVscdb.ts` `extractUserStatusSummary_func` returns `UserStatusSummary | null`
- `UserStatusSummary.familyQuotaSummaries: ModelFamilyQuotaSummary[]` with `{familyName, remainingPercentage, exhausted, resetTime}` — matches plan fix exactly.

**Verdict**: ✅ Fully resolved. Shape now matches actual API.

---

## 2. New Contradictions Introduced by Fixes

### 2.1 SC-7 Stage 1 vs mandate L29 — Potential Interpretation Conflict

**Mandate L29**: "post-prompt rotate는 같은 실행 안에서 즉시 적용한다"

**Plan SC-7 (L172-176)**: Stage 1 writes pending-switch.json and changes accounts.json in current session.

**Potential issue**: The mandate says "즉시 적용" which could be interpreted as "immediately take effect" rather than "immediately record". The plan interprets it as "immediately record" (write files), with actual effect deferred to next execution.

**Assessment**: ⚠️ **LOW RISK** — The plan's interpretation is the only feasible one (mid-session LS restart is explicitly forbidden in Must NOT Have L99). The Switch flow diagram in Task 8 (L1004-1018) makes this clear enough. However, the mandate wording could be clarified to say "즉시 판단 및 기록" instead of "즉시 적용".

**Recommendation**: No plan change needed. If Momus raises this again, point to Must NOT Have L99 ("mid-session account switching 금지") as the constraint that forces "record now, apply next run" semantics.

### 2.2 No other new contradictions detected

The 3 fixes are localized to:
- SC-2 and Task 4 (auth list 3-stage flow) — self-contained, no cross-task impact
- SC-7, Task 8, Task 12 (switch 3-stage flow) — cross-referenced correctly between tasks
- Task 13 QA/Acceptance Criteria — purely test-facing, no implementation change

---

## 3. Full Mandate Compliance Check

### 3.1 Core Mandate Requirements vs Plan Coverage

| # | Mandate Requirement | Plan Location | Status |
|---|---|---|---|
| 1 | 90% bucket reset 폐기 | SC-12 (L218-224), Task 2 (L450-518) | ✅ |
| 2 | effectiveFamily 기본값 CLAUDE | SC-10 (L202-206), Task 2 (L465-468) | ✅ |
| 3 | pending-switch.json = 적용 기록 | SC-7 (L170-182), Task 8 (L986-1090), Task 9 (L1102-1107) | ✅ |
| 4 | wake-up 실행 방식 = 대상 계정 LS 1턴 | Task 5 (L695-810) | ✅ |
| 5 | auth list = 즉시 표시 + selective refresh | SC-2 (L122-131), Task 4 (L604-691) | ✅ |
| 6 | Offline-Gateway NOT NOW에서 제외 | Task 13 (L1433-1548), Must NOT Have L98 | ✅ |
| 7 | fingerprint NOT NOW에서 제외 | Task 12 (L1311-1429), Must NOT Have L103 | ✅ |
| 8 | 필요한 sleeping account만 wake-up | SC-4 (L145-150), Task 5, Must NOT Have L101 | ✅ |
| 9 | fingerprint = auth login 때 생성, switch 때 자동 적용 | SC-13 (L226-238), Task 12 (L1314-1334) | ✅ |
| 10 | serviceMachineId switch 시 함께 맞춤 | SC-13 (L235-237), Task 12 (L1322-1329) | ✅ |
| 11 | post-prompt rotate 즉시 판단/기록 | SC-7 Stage 1, Task 7 (L906-983), Task 8 (L990-1000) | ✅ |
| 12 | 정책엔진/YAML만 NOT NOW | Must NOT Have (no mention of policy engine) | ✅ |
| 13 | spec에 성공조건 포함 | SC-1 through SC-14 | ✅ |
| 14 | plan에 checklist 포함 | TODOs (L346+) with acceptance criteria | ✅ |
| 15 | 당장 구현 가능한 수준의 구체적 지시 | Each task has What to do, References, QA | ✅ |

### 3.2 Mandate L40-42: Offline-Gateway 최소 동작경로

**Mandate**: "로컬 fast-path 활성화: live LS 상태 읽기 + state.vscdb fast-path를 offline-only에서도 사용 가능하게"

**Plan Task 13 (L1433-1548)**:
- `readQuotaFromStateDb_func`: reads state.vscdb directly → ✅
- `readQuotaFromLiveLs_func`: reads live LS state.vscdb → ✅
- `getQuotaFastPath_func`: unified entry with live → offline → null fallback → ✅

**Coverage**: Full. Matches mandate "antigravity-cli offline-only 방식 + cockpit ClientGateway 방식의 장점을 합친 것".

### 3.3 Mandate L37-39: fingerprint 자동화

**Mandate**: "auth login 때 fingerprint 미리 생성, switch 때 fingerprint 자동 적용, cockpit에서 로직을 그대로 가져와서 구현"

**Plan Task 12 (L1311-1429)**:
- generateSystemFingerprint_func: copies from cockpit fingerprint.rs → ✅
- auth login integration → ✅
- switch apply integration → ✅
- serviceMachineId sync → ✅

**Coverage**: Full.

---

## 4. Internal Consistency Check

### 4.1 Dependency Matrix Validation

| Task | Declared Depends | Actual Depends | Consistent? |
|------|-----------------|---------------|-------------|
| 1 | None | None (foundation types) | ✅ |
| 2 | None | None (cleanup) | ✅ |
| 3 | 1 | 1 (saveAccountCard_func) | ✅ |
| 4 | 1 | 1 (AccountDetail fields) | ✅ |
| 5 | 1 | 1 (AccountDetail, saveAccountCard) | ✅ |
| 6 | 3,4,5 | 3 (refresh), 4 (list), 5 (executeWakeup) | ✅ |
| 7 | 1,2 | 1 (saveAccountCard), 2 (no 90% reset) | ✅ |
| 8 | 7 | 7 (rotate pipeline) | ✅ |
| 9 | 3,4,6,8,13 | All needed | ✅ |
| 12 | 8 | 8 (switch structure for fingerprint injection) | ✅ |
| 13 | 1 | 1 (AccountDetail quota_cache) | ✅ |
| 10 | 9,12 | Both needed | ✅ |
| 11 | 10 | 10 (all features finalized) | ✅ |

**No circular dependencies detected.** ✅

### 4.2 Cross-Task Reference Consistency

- Task 4 references `saveAccountCard_func` from Task 1 → ✅ (Task 1 defines it)
- Task 6 references `executeWakeup_func` from Task 5 → ✅ (Task 5 defines it)
- Task 7 references `decideAutoRotate_func` (existing) → ✅ (no task creates it, it already exists)
- Task 8 references `applyPendingSwitchIntentIfNeeded_func` → ✅ (existing code + Task 9 modifies it)
- Task 9 references pending-switch.json semantics → ✅ (consistent with Task 8's 3-stage flow)
- Task 12 references Switch flow Stage 3 → ✅ (consistent with Task 8's diagram)

### 4.3 Success Criteria Coverage

All 14 SCs have corresponding tasks:
- SC-1 → Task 3 | SC-2 → Task 4 | SC-3 → Task 1 | SC-4 → Task 5
- SC-5 → Task 7 | SC-6 → Task 7 | SC-7 → Task 8 | SC-8 → Task 7/8
- SC-9 → (existing) | SC-10 → Task 2 | SC-11 → Task 6 | SC-12 → Task 2
- SC-13 → Task 12 | SC-14 → Task 13

✅ All SCs covered.

---

## 5. Identified Gaps (Post-Fix)

### GAP-1: Task 9 pending-switch.json consumer modification scope ambiguity

**Location**: Task 9 (L1102-1107)

**Issue**: Task 9 says "제거하거나, 파일이 이미 적용된 것으로 인식하고 skip하도록 수정" but doesn't definitively choose. It says "명확한 선택: 파일을 기록(log)으로 유지하되 startup에서는 이미 적용된 것으로 간주" but the "제거" option is still mentioned as an alternative.

**Risk**: LOW — the "명확한 선택" paragraph resolves it, but the preceding "제거하거나" is confusing.

**Recommendation**: Remove "제거하거나" phrasing. Keep only the "파일을 기록(log)으로 유지" path.

### GAP-2: Wave 3a parallel execution — Task 9 and Task 12 both modify main.ts

**Location**: Task 9 (L1094-1184) and Task 12 (L1311-1429)

**Issue**: Both tasks modify `src/main.ts` and are in the same wave (Wave 3a). Task 12 modifies the startup path in main.ts, and Task 9 also modifies the startup path (pending-switch consumer).

**Risk**: MEDIUM — concurrent edits to main.ts from two agents could cause merge conflicts.

**Recommendation**: Either (a) move Task 12 to Wave 3b (depends on Task 9 completion to avoid main.ts conflicts), or (b) scope Task 12's main.ts changes to only the `applyPendingSwitchIntentIfNeeded_func` area and ensure Task 9 doesn't touch that area. The current plan already partially addresses this — Task 9 L1102-1107 says it will "modify or remove" the startup consumer, while Task 12 L1331-1334 says it adds fingerprint apply there. They're touching the same code region.

**Concrete fix**: Task 12 should explicitly state "Task 9에 의해 수정된 startup consumer 이후에 fingerprint apply를 추가" to clarify ordering within the same wave.

### GAP-3: No explicit test for "다음 실행 시 새 계정으로 동작" end-to-end

**Location**: Definition of Done (L70), Task 8 QA scenarios

**Issue**: DoD says "다음 실행 시 새 계정 적용" but no single test scenario validates the full cycle: post-response write → next-run read → account switch → fingerprint apply. Task 8 tests the write, Task 9 tests the pipeline, but the startup consumer (2-stage + fingerprint) integration is only implicitly tested.

**Risk**: LOW — Task 9 E2E test (L1153-1161) covers post-response through rotate, and Task 12 tests fingerprint apply. But the "next run startup" path is tested in isolation, not as a continuation of a post-response scenario.

**Recommendation**: Add a note to Task 10 (integration tests) to include a 2-run E2E scenario: Run 1 (post-response → write switch) → Run 2 (startup → consume switch + apply fingerprint).

---

## 6. Summary

### Issue Resolution Status

| Issue | Momus Blocker | Resolution | New Contradiction? |
|-------|--------------|------------|-------------------|
| 1: auth list timing | "즉시 표시" vs "갱신 후 표시" | 3-stage flow in SC-2 + Task 4 | None |
| 2: switch timing | "즉시 적용" vs "다음 실행" | 3-stage Switch flow in SC-7 + Task 8/12 | None (LOW risk interpretation note) |
| 3: Task 13 QA shape | gemini_used/claude_used (wrong) | Correct shape with familyQuotaSummaries | None |

### Gaps Found

| ID | Severity | Description | Recommendation |
|----|----------|-------------|----------------|
| GAP-1 | LOW | Task 9 pending-switch consumer "제거하거나" ambiguity | Remove alternative phrasing |
| GAP-2 | MEDIUM | Task 9 + Task 12 concurrent main.ts edits in Wave 3a | Add ordering note or serialize |
| GAP-3 | LOW | No full 2-run E2E test for switch lifecycle | Add to Task 10 edge cases |

### Overall Verdict

**APPROVE with minor recommendations.**

All 3 Momus REJECT issues are fully resolved without introducing new contradictions. The plan is internally consistent, fully covers all mandate requirements, and has correct dependency ordering. The 3 identified gaps are LOW/MEDIUM severity and can be addressed during implementation without plan restructuring.

The plan is ready for Momus re-review. Recommended to note GAP-2 (Wave 3a main.ts conflict) for the execution phase.
