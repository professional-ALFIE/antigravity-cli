# Metis Plan Verification Report: v0.3.0 Auth Rotate & Wake-up

**Plan File**: `.sisyphus/plans/01-plan-v030-auth-rotate.md`
**Verification Date**: 2026-04-17
**Verifier**: Metis (Pre-Planning Consultant)

---

## 1. File Reference Accuracy (Line Number Verification)

### ✅ CONFIRMED References

| Plan Reference | Actual Location | Status |
|---|---|---|
| `accounts.ts:53-79` AccountDetail interface | L53-79 exactly | ✅ Exact match |
| `accounts.ts:146-177` writeAccountDetailSync (writeJsonAtomic0600) | L146-177 (`writeJsonAtomic0600_func` + helpers) | ✅ Close match — function is `writeJsonAtomic0600_func` at L170-177, helpers at L146-168 |
| `quotaClient.ts:18-46` QuotaCacheValue / ParseResult types | L18-69 (extended range: `QuotaFetchAccountInput` L18-31, `QuotaModelSnapshot` L33-37, `QuotaFamilySnapshot` L39-43, `QuotaFetchError` L45-48, `QuotaCacheValue` L50-59, `QuotaCacheReadResult` L61-64, `QuotaFetchSingleResult` L66-69) | ✅ Range slightly wider, but type definitions are correctly located |
| `quotaClient.ts:99-128` loadCodeAssist payload building | L99-128 (`buildCloudCodeMetadata_func` L99-115, `buildLoadCodeAssistPayload_func` L117-128) | ✅ Exact match |
| `quotaClient.ts:336-395` fetchAvailableModels response parsing | L336-434 (family parsing, model classification, remaining_pct calculation) | ✅ Range extends beyond plan's stated L395 — actual logic goes to ~L434 |
| `quotaClient.ts:437-467` fetchQuotaForAllAccountsBatched | L437-467 (`fetchQuotaForAccounts_func`) | ✅ Exact match — NOTE: function name is `fetchQuotaForAccounts_func` NOT `fetchQuotaForAllAccountsBatched_func` |
| `rotate.ts:107-109` 90% reset code | L107-109 exactly | ✅ Exact match |
| `rotate.ts:14-19` PendingSwitchIntent | L14-19 exactly | ✅ Exact match |
| `rotate.ts:30-158` decideAutoRotate_func | L30-158 (function spans this range) | ✅ Exact match |
| `rotate.ts:160-185` pending-switch save/load/clear | L160-185 (`savePendingSwitchIntent_func` L160-162, `loadPendingSwitchIntent_func` L164-181, `clearPendingSwitchIntent_func` L183-184) | ✅ Exact match |
| `main.ts:578-600` handleAuthCommand_func | L578-599 | ✅ Close match (function body ends at L599) |
| `main.ts:768-882` handleAuthList_func | L768-882 | ✅ Exact match |
| `main.ts:884-924` applyAuthListSelection_func | L884-919+ | ✅ Close match |
| `main.ts:1028-1110` decideAndPersistAutoRotate_func | L1028-1094+ | ✅ Close match (function starts at L1054, helper above) |
| `main.ts:1079-1083` effectiveFamily code | L1079-1083 exactly | ✅ Exact match |
| `main.ts:2354-2501` message-send path (main function) | L2354+ (main() starts at L2354) | ✅ Correct start |
| `authList.ts:39-60` buildParseResultFromQuotaCache_func | L39-60 exactly | ✅ Exact match |
| `authList.ts:156-208` buildAuthListRows_func | L156-208 exactly | ✅ Exact match |
| `authInject.ts:139-197` injectAuthToStateDb_func | L139-197 | ✅ Exact match |
| `wakeup.ts` filterWakeupCandidates_func | L32-56 (exported function) | ✅ Exists |
| `wakeup.ts` WakeupCandidateAccount interface | L1-10 | ✅ Exists |
| `accounts.ts:72-79` wakeup_history structure | L72-76 | ✅ Close match (3 fields, not the full L72-79) |

### ❌ INACCURATE References

| Plan Reference | Issue | Severity |
|---|---|---|
| Task 3: `fetchQuotaForAllAccountsBatched_func` | **Function name is wrong.** Actual name: `fetchQuotaForAccounts_func` (L437). Plan uses `fetchQuotaForAllAccountsBatched_func` throughout Task 3. | **MEDIUM** — Executor will search for non-existent function name |
| Task 1 Ref: `quotaClient.ts:437-467` labeled as `fetchQuotaForAllAccountsBatched_func` | Same naming error as above | **MEDIUM** |
| Task 5: `authLogin.ts:82-141, 343-392` as Antigravity open + OAuth poll pattern | **Misleading reference.** `authLogin.ts` does NOT contain `open -n -a Antigravity --args --user-data-dir=...` pattern. It uses OAuth browser callback flow instead. The `open -n -a Antigravity` pattern is described in AGENTS.md but doesn't exist in the current codebase as a reusable function. | **HIGH** — Task 5 references a non-existent pattern for wake-up orchestration |
| Task 5: `authLogin.ts:313-341` waitForCompletionWithTimeout_func | L313-341 exists (`waitForCompletionWithTimeout_func`) — this is a generic timeout wrapper, not specifically an Antigravity-app-launching pattern | **LOW** — Generic utility, usable but not direct pattern match |
| Task 3: "auth list와 동일한 테이블 형식" references `renderAuthListText_func` at `authList.ts:216-269` | Need to verify exact line range — `renderAuthListText_func` is at ~L216+ | **LOW** — Minor range offset possible |

---

## 2. Success Criteria Coverage (SC-1 through SC-12 vs Must Have)

| Must Have Item | Covered by SC | Status |
|---|---|---|
| `auth refresh` command | SC-1 | ✅ |
| `auth list` lightweight (cache-based + selective refresh) | SC-2 | ✅ |
| Account Card persistence (tier, families, reset_time, cached_at, status, bucket, wakeup) | SC-3 | ✅ |
| 5h usage cycle tracking (all-null = not started) | SC-4 | ✅ |
| Post-response rotate pipeline | SC-5 | ✅ |
| Bucket persistence (prevent repeat rotate) | SC-6 | ✅ |
| Switch recording (next invocation) | SC-7 | ✅ |
| Candidate ranking rules (Pro ≤20% forbidden, Ultra ≤10% lowest) | SC-8 | ✅ |
| Reset time elapsed → 99% | SC-9 | ✅ |
| effectiveFamily default CLAUDE | SC-10 | ✅ |
| Wake-up 4 timings | SC-11 | ✅ |
| 90% bucket reset removal | SC-12 | ✅ |
| Pro ≤20% absolute prohibition, Ultra ≤10% lowest priority | SC-8 | ✅ |
| Token not in pending-switch.json | SC-7 | ✅ |

**Coverage Assessment**: ✅ **COMPLETE** — All 12 Must Have items map to a specific SC.

---

## 3. Dependency Matrix — Cycle Detection

```
Wave 1: T1, T2, T3(dep:T1), T4(dep:T1)
Wave 2: T5(dep:T1), T6(dep:T3,T4,T5), T7(dep:T1,T2), T8(dep:T7)
Wave 3: T9(dep:T3,T4,T6,T8), T10(dep:T9), T11(dep:T10)
```

**Cycle Analysis**:
- T1 → T3 → T6 → T9: linear chain ✅
- T1 → T4 → T6: joins chain ✅
- T1 → T5 → T6: joins chain ✅
- T1 → T7 → T8 → T9: linear chain ✅
- T2 → T7: joins T7 chain ✅
- No back-edges detected ✅
- No circular dependencies ✅

**Dependency Correctness Issues**:

| Issue | Detail | Severity |
|---|---|---|
| Task 3 blocked by Task 1, but both in Wave 1 | Plan says Task 3 "Parallel Group: Wave 1" but also "Blocked By: Task 1". If Task 1 must complete first, Task 3 cannot start in Wave 1. | **MEDIUM** — Contradictory scheduling. Task 3 should be in a sub-wave (Wave 1b) after Task 1 |
| Task 4 same issue as Task 3 | Blocked by Task 1, but listed in Wave 1 | **MEDIUM** — Same contradiction |

**Recommendation**: Wave 1 should be split into:
- **Wave 1a**: Tasks 1, 2 (no dependencies)
- **Wave 1b**: Tasks 3, 4 (depend on Task 1)

---

## 4. Acceptance Criteria Quality

### ✅ Well-Defined Tasks (Specific + Verifiable)

| Task | AC Quality | Notes |
|---|---|---|
| Task 1 | ✅ GOOD | 4 concrete test assertions + regression check |
| Task 2 | ✅ GOOD | 4 concrete test assertions + specific code change targets |
| Task 4 | ✅ GOOD | 5 test scenarios covering all paths |
| Task 5 | ✅ GOOD | 4 test scenarios including concurrency |
| Task 7 | ✅ GOOD | 5 test scenarios with specific percentage values |
| Task 8 | ✅ GOOD | 4 test scenarios including security (no token in file) |

### ⚠️ Needs Improvement

| Task | AC Quality | Issue |
|---|---|---|
| Task 3 | ⚠️ PARTIAL | "wake-up 후보 식별" listed but wake-up execution is explicitly deferred. The AC for wake-up candidate identification is fine, but `handleAuthRefresh_func` references `saveAccountCard_func` which is implemented in Task 1 — this dependency is correct but the AC should explicitly test that saveAccountCard is called |
| Task 6 | ⚠️ VAGUE | AC says "Test: (2-1) auth refresh 후 미시작 계정 wake-up 트리거" but doesn't specify HOW to verify background trigger (spy? mock? log output?) |
| Task 9 | ⚠️ OVERLOADED | 5 AC items, each testing multiple integration points. Should be more granular |
| Task 10 | ⚠️ EDGE CASES UNCLEAR | E1-E7 listed but missing E6 (gap in numbering). Only 6 edge cases listed for 7 IDs (E1-E5, E7). Missing E6 |

### ❌ Missing Acceptance Criteria

| Task | Missing AC |
|---|---|
| Task 3 | No AC for `forceRefreshAllQuotas_func` bypassing 60s cache TTL |
| Task 6 | No AC verifying "fire-and-forget" behavior (Promise errors logged, not thrown) |
| Task 11 | Only 2 AC items (README + CHANGELOG presence) — should verify content accuracy |

---

## 5. Guardrails (Must NOT Have) vs Codebase Reality

| Guardrail | Codebase Compatibility | Status |
|---|---|---|
| "rotate.ts 재작성 금지" | `decideAutoRotate_func` (L30-158) is intact and functional. Plan only extends around it. | ✅ Compatible |
| "wakeup.ts 재작성 금지" | `filterWakeupCandidates_func` (L32-56) is intact. Plan adds `executeWakeup_func` separately. | ✅ Compatible |
| "accounts.ts 스키마 재설계 금지" | `AccountDetail` (L53-79) already has `quota_cache`, `rotation`, `wakeup_history` fields. | ✅ Compatible |
| "90% 회복 reset 규칙 금지" | Code at L107-109 is the target for removal. Guardrail prevents re-adding. | ✅ Compatible |
| "pending-switch.json에 auth token 저장 금지" | Current `PendingSwitchIntent` (rotate.ts L14-19) only has target/source/reason/decided_at. | ✅ Compatible |
| "auth list에서 전체 계정 네트워크 갱신 금지" | Current `handleAuthList_func` (main.ts L768+) does full network refresh — this is what Task 4 changes. Guardrail is correctly scoped. | ✅ Compatible |
| "mid-session account switching 금지" | `applyPendingSwitchIntentIfNeeded_func` (L1028-1052) applies BEFORE message send. Guardrail is consistent. | ✅ Compatible |

**Guardrail Assessment**: ✅ **All guardrails are compatible with the codebase.**

---

## 6. Critical Issues Found

### Issue 1: Function Name Error (MEDIUM)
**Plan says**: `fetchQuotaForAllAccountsBatched_func`
**Actual name**: `fetchQuotaForAccounts_func` (quotaClient.ts L437)
**Impact**: Task 3 executor will search for non-existent function
**Fix**: Replace all instances of `fetchQuotaForAllAccountsBatched_func` with `fetchQuotaForAccounts_func` in Task 3 and Task 1 references

### Issue 2: Wave 1 Scheduling Contradiction (MEDIUM)
**Plan says**: Tasks 3, 4 are "Wave 1" but "Blocked By: Task 1"
**Impact**: If dispatched as parallel Wave 1, Tasks 3, 4 will fail because Task 1's `saveAccountCard_func` doesn't exist yet
**Fix**: Split Wave 1 into Wave 1a (T1, T2) and Wave 1b (T3, T4)

### Issue 3: Wake-up Pattern Reference (HIGH)
**Plan Task 5 says**: `authLogin.ts:82-141, 343-392` contains "Antigravity app 열기 + OAuth poll 패턴"
**Reality**: `authLogin.ts` uses OAuth browser callback flow, NOT `open -n -a Antigravity --args --user-data-dir=<abs>`. The `open -n -a Antigravity` pattern described in AGENTS.md doesn't exist as a reusable function in the current codebase.
**Impact**: Task 5 executor will look for a non-existent pattern
**Fix**: Either (a) provide explicit implementation guidance for the `open -n -a Antigravity` + `state.vscdb` poll pattern, or (b) confirm this pattern exists in a different file or should be written from scratch

### Issue 4: Missing Edge Case E6 (LOW)
**Plan lists**: E1, E2, E3, E4, E5, E7 (E6 is missing)
**Fix**: Either add E6 or renumber to E1-E6

---

## 7. Structural Assessment

### Strengths
1. **Excellent SC coverage**: All 12 Must Have items have concrete success criteria
2. **Clean dependency graph**: No cycles, clear critical path
3. **Strong guardrails**: All compatible with codebase reality
4. **Good TDD approach**: Every task has test-first specifications
5. **Detailed commit strategy**: 11 atomic commits with clear file lists
6. **Reference precision**: ~90% of line references are exact or very close

### Weaknesses
1. **Function name error** in Tasks 1, 3
2. **Wave 1 scheduling contradiction** (T3, T4 depend on T1 but in same wave)
3. **Missing wake-up implementation pattern** — Task 5 references a pattern that doesn't exist in the cited file
4. **Vague AC for background operations** — Tasks 6, 9 don't specify how to verify fire-and-forget behavior
5. **Missing edge case** (E6 gap)

---

## 8. Risk Summary

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Executor confused by wrong function name | High | Medium | Fix function name in plan |
| Wave 1 tasks fail due to ordering | Medium | High | Split into sub-waves |
| Task 5 wake-up implementation stalls | High | High | Provide explicit implementation steps |
| Edge case gap allows regression | Low | Low | Add E6 or renumber |

---

## 9. Verdict

**Plan Quality**: ⭐⭐⭐⭐ (4/5)

The plan is **well-structured with strong coverage** but has **3 correctable issues** that should be fixed before dispatching to executors:
1. Fix `fetchQuotaForAllAccountsBatched_func` → `fetchQuotaForAccounts_func`
2. Split Wave 1 into 1a (T1, T2) and 1b (T3, T4)
3. Fix Task 5's wake-up pattern reference — provide explicit `open -n -a Antigravity` implementation guidance

**Recommendation**: **APPROVE with amendments** — Fix the 3 issues above, then dispatch.
