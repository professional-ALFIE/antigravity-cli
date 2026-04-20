# Metis 2nd Verification Report: v0.3.0 Auth Rotate & Wake-up

**Plan File**: `.sisyphus/plans/01-plan-v030-auth-rotate.md`
**Verification Date**: 2026-04-17
**Verifier**: Metis (Pre-Planning Consultant)
**Verification Type**: 2nd pass — confirm 1st-verify fixes + find new issues

---

## 0. 1st-Verify Issues Checklist (6 items)

| # | 1st-Verify Issue | Fix Applied? | Current Status |
|---|---|---|---|
| 1 | `fetchQuotaForAllAccountsBatched_func` → actual name `fetchQuotaForAccounts_func` | ✅ YES — Plan Task 1 References now says: "plan에서 이전 명칭 `fetchQuotaForAllAccountsBatched_func`로 표기했으나 실제 함수명은 `fetchQuotaForAccounts_func`" | **RESOLVED** — executor will use correct name |
| 2 | Wave 1 → split into Wave 1a (T1,T2) + Wave 1b (T3,T4) | ✅ YES — Plan now shows Wave 1a and Wave 1b as separate groups | **RESOLVED** — correct scheduling |
| 3 | Task 5 authLogin.ts inaccurate reference → provide AGENTS.md-based guide | ✅ YES — Task 5 References now says "AGENTS.md 'auth login 플로우' 섹션" and includes a "Wake-up 실행 구현 가이드 (AGENTS.md 기반)" block | **RESOLVED** — executor has implementation steps |
| 4 | Tasks 3-11 missing QA Scenarios | ✅ YES — All Tasks (1-11) now have QA Scenarios blocks with Tool/Steps/Expected Result/Evidence | **RESOLVED** |
| 5 | E6 missing (edge case gap) | ✅ YES — E6 "Live LS 실행 중 — wake-up이 이미 실행 중인 계정을 건너뜀" is now present in Task 10 | **RESOLVED** |
| 6 | Task 3 AC missing forceRefreshAllQuotas cache TTL bypass | ✅ YES — Task 3 AC now includes: "Test: `forceRefreshAllQuotas_func`이 60s cache TTL을 무시하고 강제 갱신" | **RESOLVED** |

**1st-Verify Fix Assessment**: ✅ **ALL 6 ISSUES RESOLVED**

---

## 1. Function Name Accuracy (Full Re-check)

### Verified Against Actual Code

| Plan Reference | Actual Code | Match? |
|---|---|---|
| `fetchQuotaForAccounts_func` (Task 1, 3) | `export async function fetchQuotaForAccounts_func(...)` at quotaClient.ts:437 | ✅ CORRECT |
| `AccountDetail` interface at accounts.ts:53-79 | `AccountDetail` at accounts.ts:53-79 | ✅ EXACT |
| `writeAccountDetailSync_func` (plan references this name) | Actual: `writeAccountDetail_func` at accounts.ts:296-298 | ⚠️ NAME MISMATCH |
| `readAccountDetailSync_func` (plan references this name) | `readAccountDetailSync_func` at accounts.ts:229-240 | ✅ CORRECT |
| `discoverAccounts_func` at accounts.ts | `discoverAccounts_func` at accounts.ts:468-533 | ✅ EXISTS |
| `buildAuthListRows_func` at authList.ts:156-208 | `buildAuthListRows_func` at authList.ts:156-208 | ✅ EXACT |
| `buildParseResultFromQuotaCache_func` at authList.ts:39-60 | `buildParseResultFromQuotaCache_func` at authList.ts:39-60 | ✅ EXACT |
| `renderAuthListText_func` at authList.ts:216-269 | `renderAuthListText_func` at authList.ts:216-269 | ✅ EXACT |
| `filterWakeupCandidates_func` at wakeup.ts:32-56 | `filterWakeupCandidates_func` at wakeup.ts:32-60 | ✅ CLOSE (extends to 60) |
| `updateWakeupHistory_func` at wakeup.ts | `updateWakeupHistory_func` at wakeup.ts:62-89 | ✅ EXISTS |
| `decideAutoRotate_func` at rotate.ts:30-158 | `decideAutoRotate_func` at rotate.ts:72-158 | ⚠️ START OFFSET — function starts at 72, not 30 |
| `savePendingSwitchIntent_func` at rotate.ts:160-162 | `savePendingSwitchIntent_func` at rotate.ts:160-162 | ✅ EXACT |
| `loadPendingSwitchIntent_func` at rotate.ts:164-181 | `loadPendingSwitchIntent_func` at rotate.ts:164-181 | ✅ EXACT |
| `clearPendingSwitchIntent_func` at rotate.ts:183-185 | `clearPendingSwitchIntent_func` at rotate.ts:183-185 | ✅ EXACT |
| `handleAuthCommand_func` at main.ts:578-600 | `handleAuthCommand_func` at main.ts:578-599 | ✅ CLOSE |
| `handleAuthList_func` at main.ts:768-882 | `handleAuthList_func` at main.ts:768-882 | ✅ EXACT |
| `decideAndPersistAutoRotate_func` at main.ts:1028-1110 | Function at main.ts:1054-1110, helper logic above | ✅ CLOSE |
| `effectiveFamily` at main.ts:1079-1083 | Logic at main.ts:1079-1083 | ✅ EXACT |
| `PendingSwitchIntent` at rotate.ts:14-19 | `PendingSwitchIntent` at rotate.ts:14-19 | ✅ EXACT |
| 90% reset at rotate.ts:107-109 | `>= 90` null reset at rotate.ts:107-109 | ✅ EXACT |
| `waitForCompletionWithTimeout_func` at authLogin.ts:313-341 | `waitForCompletionWithTimeout_func` at authLogin.ts:313-341 | ✅ EXACT |
| `authLogin_func` at authLogin.ts:343-399 | `authLogin_func` at authLogin.ts:343-492 | ⚠️ RANGE SHORT — function extends to 492 |
| `injectAuthToStateDb_func` at authInject.ts:139-197 | `injectAuthToStateDb_func` at authInject.ts:139-197 | ✅ EXACT |

### NEW Issue Found: `writeAccountDetailSync_func` Name

| Item | Detail |
|---|---|
| **Plan says**: | `writeAccountDetailSync_func` (referenced in Task 1 description and AC) |
| **Actual name**: | `writeAccountDetail_func` (accounts.ts:296-298) |
| **Severity**: | **LOW** — Task 1 creates `saveAccountCard_func` as a NEW function that CALLS the write helper. The executor will create the new function, not rename the existing one. But if they search for `writeAccountDetailSync_func`, they won't find it. |
| **Fix**: Plan should say `writeAccountDetail_func` instead of `writeAccountDetailSync_func` |

### NEW Issue Found: `decideAutoRotate_func` Line Range

| Item | Detail |
|---|---|
| **Plan says**: | `rotate.ts:30-158` |
| **Actual**: | Function definition starts at line 72, not 30. Lines 30-71 contain other helper logic. |
| **Severity**: | **LOW** — The function exists and the end line (158) is correct |
| **Fix**: Update reference to `rotate.ts:72-158` |

---

## 2. AccountDetail Field Verification (Task 1 Core Assumption)

Plan Task 1 assumes `AccountDetail` already has `quota_cache`, `rotation`, `wakeup_history` fields. Verified:

| Field | Exists? | Type (from accounts.ts:53-79) |
|---|---|---|
| `quota_cache` | ✅ YES | `{ subscription_tier: string \| null; families: Record<string, AccountQuotaFamilyCache>; fetch_error: string \| null; cached_at: number \| null; }` |
| `rotation` | ✅ YES | `{ family_buckets: Record<string, string \| null>; last_rotated_at: number \| null; }` |
| `wakeup_history` | ✅ YES | `{ last_attempt_at: number \| null; last_result: string \| null; attempt_count: number; }` |

**Assessment**: ✅ Task 1's core assumption is **CORRECT** — fields exist, plan only needs to fill them.

---

## 3. Wave Scheduling Re-check

Current plan structure:
```
Wave 1a (T1, T2)    — no dependencies
Wave 1b (T3, T4)    — depend on T1
Wave 2  (T5-T8)     — depend on T1/T2/T3/T4/T5/T7
Wave 3  (T9-T11)    — depend on T3/T4/T6/T8/T9
Final   (F1-F4)     — after all
```

| Check | Result |
|---|---|
| No circular deps? | ✅ PASS |
| T1 before T3,T4? | ✅ Wave 1a → 1b |
| T1 before T5,T7? | ✅ Wave 1a → Wave 2 |
| T2 before T7? | ✅ Wave 1a → Wave 2 |
| T3,T4,T5 before T6? | ✅ Wave 1b + early Wave 2 → T6 |
| T7 before T8? | ✅ Both in Wave 2, T8 depends on T7 |
| T3,T4,T6,T8 before T9? | ✅ Wave 1b + Wave 2 → Wave 3 |
| T9 before T10? | ✅ Both Wave 3, sequential |
| T10 before T11? | ✅ Both Wave 3, sequential |

**Assessment**: ✅ **Scheduling is now correct**. Wave split resolves the 1st-verify contradiction.

**Minor concern**: Wave 2 has 4 tasks (T5-T8) where T5 and T6 are sequential (T6 depends on T5), and T7 and T8 are sequential (T8 depends on T7). Both chains can run in parallel with each other, but T5→T6 and T7→T8 are serial within the wave. The plan's "Max Concurrent: 4" claim for Wave 2 is slightly misleading — actual concurrency is 2 chains of 2 tasks each. **Not a blocker.**

---

## 4. QA Scenarios Completeness (Tasks 1-11)

| Task | Has QA Scenarios? | Count | Specificity (Tool/Steps/Expected/Evidence) | Quality |
|---|---|---|---|---|
| 1 | ✅ | 2 | Bash + specific test files | ✅ GOOD |
| 2 | ✅ | 2 | Bash + specific assertions | ✅ GOOD |
| 3 | ✅ | 3 | Bash + JSON output + regression | ✅ GOOD |
| 4 | ✅ | 3 | Network 0 + selective + regression | ✅ GOOD |
| 5 | ✅ | 3 | Success + timeout + regression | ✅ GOOD |
| 6 | ✅ | 4 | Timing 2-1, 2-3, 2-4 + regression | ✅ GOOD |
| 7 | ✅ | 3 | Crossing + no-crossing + regression | ✅ GOOD |
| 8 | ✅ | 4 | Success + no-token + expired + regression | ✅ GOOD |
| 9 | ✅ | 4 | E2E refresh + E2E prompt + error isolation + regression | ✅ GOOD |
| 10 | ✅ | 4 | E1 + E5 + E6 + regression | ✅ GOOD |
| 11 | ✅ | 2 | README grep + CHANGELOG grep | ✅ GOOD (simple docs task) |

**Assessment**: ✅ **All 11 tasks have concrete QA scenarios**. Every scenario specifies tool, steps, expected result, and evidence path.

---

## 5. Success Criteria (SC-1 to SC-12) Re-check

All 12 SCs remain intact. No modifications needed from 1st verify. Spot-check:

| SC | Plan Consistency | Code Feasibility |
|---|---|---|
| SC-1 (auth refresh) | ✅ Matches Task 3 | ✅ `fetchQuotaForAccounts_func` + `saveAccountCard_func` chain feasible |
| SC-5 (post-response rotate) | ✅ Matches Task 7 | ✅ `decideAutoRotate_func` at rotate.ts:72-158 handles bucket crossing |
| SC-11 (4 wake-up timings) | ✅ Matches Task 6 | ✅ `filterWakeupCandidates_func` + `executeWakeup_func` chain feasible |
| SC-12 (90% reset removal) | ✅ Matches Task 2 | ✅ rotate.ts:107-109 is the exact code to remove |

---

## 6. Edge Cases Completeness (Task 10)

| Edge Case | Present? | Description |
|---|---|---|
| E1 | ✅ | Single account — rotate no-op |
| E2 | ✅ | All accounts forbidden — refresh ok, no wake-up |
| E3 | ✅ | Concurrent CLI — last-writer-wins for pending-switch |
| E4 | ✅ | Corrupted account card — null → "no card" → refresh |
| E5 | ✅ | Partial refresh success (8/10) — exit code 0 |
| E6 | ✅ | Live LS running — skip wake-up for already-running account |
| E7 | ✅ | Target account missing token — graceful switch failure |

**Assessment**: ✅ **All 7 edge cases present** (E1-E7, no gaps).

---

## 7. New Issues Found in 2nd Pass

### Issue 7: `writeAccountDetailSync_func` Name Mismatch (LOW)
- **Plan Task 1** references `writeAccountDetailSync_func` in AC ("저장된 카드를 `readAccountDetailSync_func`로 읽었을 때")
- **Actual write function**: `writeAccountDetail_func` (accounts.ts:296-298)
- **Note**: `readAccountDetailSync_func` IS correct. Only the write side is misnamed.
- **Impact**: LOW — executor will search for write function, not find exact name, but can discover it via LSP.
- **Recommendation**: Change Task 1 AC to reference `writeAccountDetail_func` instead of `writeAccountDetailSync_func`.

### Issue 8: `decideAutoRotate_func` Start Line Offset (LOW)
- **Plan Task 7 References**: `rotate.ts:30-158`
- **Actual**: Function definition starts at line 72, not 30
- **Impact**: LOW — function exists and is findable
- **Recommendation**: Update to `rotate.ts:72-158`

### Issue 9: `authLogin_func` Range Too Short (INFO)
- **Plan Task 5 References**: `authLogin.ts:343-399`
- **Actual**: `authLogin_func` spans L343-492 (not L399)
- **Impact**: INFO — executor already has the AGENTS.md-based implementation guide, so this reference is secondary
- **Recommendation**: Update to `authLogin.ts:343-492` for accuracy

---

## 8. Guardrail Re-verification

| Guardrail | Still Valid? | Notes |
|---|---|---|
| rotate.ts 재작성 금지 | ✅ | Task 7 extends around `decideAutoRotate_func`, does not rewrite |
| wakeup.ts 재작성 금지 | ✅ | Task 5 adds `executeWakeup_func` as new export, does not touch `filterWakeupCandidates_func` |
| accounts.ts 스키마 재설계 금지 | ✅ | Task 1 only fills existing fields |
| pending-switch.json에 token 저장 금지 | ✅ | Task 8 AC explicitly tests for no-token |
| auth list 전체 네트워크 갱신 금지 | ✅ | Task 4 implements selective refresh |
| mid-session switching 금지 | ✅ | All tasks use "next invocation" pattern |
| 90% 회복 reset 금지 | ✅ | Task 2 removes it, guardrail prevents re-addition |

---

## 9. Commit Strategy Re-check

| Wave | Commits | Atomic? | File Scope Appropriate? |
|---|---|---|---|
| 1a | 2 commits (T1, T2) | ✅ | ✅ |
| 1b | 2 commits (T3, T4) | ✅ | ✅ |
| 2 | 4 commits (T5, T6, T7, T8) | ✅ | ✅ |
| 3 | 3 commits (T9, T10, T11) | ✅ | ✅ |

**Total**: 11 atomic commits. Each has clear message and file list. ✅

**One concern**: Task 6 commit touches only `main.ts, main.test.ts` but integrates wake-up at 4 timings. This is a large change to main.ts. However, it's logically one feature (4 timing integrations) so atomic by feature, not by line count. Acceptable.

---

## 10. Final Risk Assessment

| Risk | Probability | Impact | Status |
|---|---|---|---|
| Executor confused by wrong function name | ~~High~~ → **LOW** | Medium | **FIXED** — correct name documented |
| Wave 1 tasks fail due to ordering | ~~Medium~~ → **NONE** | ~~High~~ | **FIXED** — split into 1a/1b |
| Task 5 wake-up implementation stalls | ~~High~~ → **LOW** | ~~High~~ | **FIXED** — AGENTS.md guide provided |
| `writeAccountDetailSync_func` name mismatch | LOW | LOW | **NEW** — minor, discoverable |
| `decideAutoRotate_func` line offset | LOW | NONE | **NEW** — cosmetic |
| authLogin_func range too short | INFO | NONE | **NEW** — cosmetic |

---

## 11. Verdict

**Plan Quality**: ⭐⭐⭐⭐½ (4.5/5) — improved from 4/5 in 1st verify

**All 6 first-verification issues have been resolved.** Three new minor issues were found:

| # | Issue | Severity | Action Required |
|---|---|---|---|
| 7 | `writeAccountDetailSync_func` → `writeAccountDetail_func` | LOW | Fix name in Task 1 AC |
| 8 | `decideAutoRotate_func` line range 30→72 | LOW | Update reference |
| 9 | `authLogin_func` range 399→492 | INFO | Update reference |

**Recommendation**: ✅ **APPROVE** — The 3 remaining issues are LOW/INFO severity and will not block execution. Executors can discover correct names/lines via LSP. The plan is well-structured, all dependencies are correct, all QA scenarios are concrete, and all guardrails are compatible with the codebase.

**Safe to dispatch to ultrawork execution.**
