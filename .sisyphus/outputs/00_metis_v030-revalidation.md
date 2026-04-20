# v0.3.0 Spec+Plan Revalidation — Metis Analysis

## Intent Classification
**Type**: Mid-sized Task — Spec/Plan quality gate review
**Confidence**: High
**Rationale**: This is a document revalidation review against 5 specific criteria requested by the user.

---

## Critical Issues

### C1. `rotate.ts` 90% reset code EXISTS — Task 5 directive is accurate but should specify exact lines to delete

The spec says to remove the 90% reset rule. Current code confirms it exists in `rotate.ts`:

- **Line 57**: `if (remainingPct_var >= 90) return null;` — inside `thresholdBucket_func`, causes `>= 90` to return `null` bucket (i.e., "no threshold crossed = no rotate trigger").
- **Line 103**: `currentRemainingPct_var !== null && currentRemainingPct_var >= 90 ? null : ...` — inside `decideAutoRotate_func`, resets stored bucket to `null` when `>= 90`.
- **Lines 107-109**: Redundant block that also sets `familyBuckets` to `null` when `>= 90`.

**Verdict**: The spec's Task 5 directive is **correct and sufficiently specific**. It correctly identifies `thresholdBucket_func`'s `remainingPct >= 90` branch and `decideAutoRotate_func`'s 90% reset block.

**Gap**: The spec should also note line 103's inline ternary, which is the third location that needs removal. Currently Task 5 says "90% reset 블록을 제거" but doesn't mention this ternary expression.

### C2. `PendingSwitchIntent` schema needs 4 new fields — Task 5 lists them but doesn't specify the exact current interface to extend

Current `PendingSwitchIntent` (lines 14-19):
```ts
interface PendingSwitchIntent {
  target_account_id: string;
  source_account_id: string;
  reason: string;
  decided_at: number;
}
```

The spec says to add: pre/post quota snapshot, fingerprint/serviceMachineId meta fields.

**Verdict**: Task 5 correctly identifies the need. But the directive should specify exact field names and types, e.g.:
- `pre_quota_pct: number | null`
- `post_quota_pct: number | null`
- `fingerprint_id: string | null`
- `service_machine_id: string | null`

Without this, the implementer must guess the field names.

### C3. `needs_reauth` is already in candidate filter exclusion — but via `protected` not direct

Current `rotate.ts` line 123:
```ts
.filter((account_var) => !['forbidden', 'disabled', 'protected'].includes(account_var.accountStatus));
```

The spec says `needs_reauth` should be excluded. Currently `needs_reauth` is **NOT** in the exclusion list. Only `forbidden`, `disabled`, `protected` are excluded.

**Verdict**: Task 5's directive to add `needs_reauth` to the exclusion list is **correct and necessary**. This is a real code change, not just documentation.

### C4. QA scenarios for Tasks 4-10 are too abstract for executable verification

Agent analysis confirmed:
- Tasks 1-3: Concrete commands, fixture states, assertions ✅
- Tasks 4-10: Describe intent but lack executable commands ❌
- Tasks 11-12: Partially concrete ⚠️

**Specific gaps**:
- Task 4: "legacy import 후" — no command to create legacy state or run import
- Task 5: "73→64 fixture" — no command to set up the fixture or verify applied record contents
- Task 6: No command to verify pre-send absence of rotate or post-prompt presence
- Task 7: No command to test seamless fallback path
- Task 8: No command to verify fingerprint source value in account detail
- Task 9: No command to verify wake-up history fields after LS 1-turn execution
- Task 10: No command to test source priority selection logic

**Verdict**: The QA scenarios exist structurally but are not agent-executable for 7 of 12 tasks. This violates the "ZERO USER INTERVENTION PRINCIPLE" in the Metis directives.

---

## Minor Issues

### M1. `auth refresh` command entry point doesn't exist yet — confirmed

Grep in `main.ts` for `authRefresh|handleAuthRefresh|auth refresh` returns zero matches. The current auth routing only handles `list` and `login`. Task 1 correctly identifies this as a new entry point.

### M2. `seamlessSwitch.ts` is minimal — only 31 lines, feasibility check only

The file exists but is a pure evaluation function with no actual switch implementation. The spec's Task 7 correctly references `evaluateSeamlessSwitchFeasibility_func` as the feasibility gate and `full-switch` as the fallback.

### M3. `wakeup.ts` has no actual orchestration — only filtering + history

The file has `filterWakeupCandidates_func` and `updateWakeupHistory_func` but no LS 1-turn execution logic. The spec's Task 9 correctly identifies this gap.

### M4. Task 12 should duplicate test file list inside QA scenario block

Current Task 12 lists test files under "해야 할 일" but the QA scenario just says `bun test`. The QA block should also enumerate which specific test files to check for the new scenarios.

### M5. Rotate timing is consistent across the entire document

Agent analysis confirmed zero inconsistencies:
- Section 3-3: pre-prompt rotate forbidden ✅
- Section 5-6: post-prompt crossing only ✅
- Section 5-12 table: `prompt 시작 전` = NO for post-turn rotate ✅
- Task 6: move from pre-response to post-prompt ✅
- Success conditions: both 6-1 and 6-2 say post-prompt only ✅

### M6. `quotaClient.ts` cache includes `refreshedToken` — secret boundary concern confirmed

The `QuotaCacheValue` type includes a `refreshedToken` field. Task 11's secret boundary review is correctly scoped — this field should not persist to cache files, only flow through to account store updates.

### M7. Post-prompt rotate timing — `decideAndPersistAutoRotate_func` is at line 2463 in main.ts

Current code calls rotate at line 2463. Task 6's directive to move this to after `observeAndAppendSteps_func` in the four handler functions is architecturally correct.

---

## Approved Decisions

### A1. Rotate timing = post-prompt only
The document is internally consistent. No pre-prompt rotate anywhere in spec or plan.

### A2. 90% reset removal is justified
User explicitly rejected the 90% recovery rule. Current code has it at 3 locations in `rotate.ts`. Removal is clean.

### A3. `pending-switch.json` = applied record (not replay intent)
Document consistently describes this as an already-applied record. The lifecycle section (5-8-a) explicitly forbids replay usage.

### A4. `auth refresh` / `auth list` role separation
Clear separation: `auth refresh` = full cloud sync, `auth list` = card-based fast display with selective refresh. Consistent across all sections.

### A5. Wake-up target definition
Consistent: only 5h usage cycle not-yet-started accounts. Not "all sleeping" or "every time."

### A6. Source priority = live LS → state.vscdb → cloud direct
Consistent across sections 5-11, 5-13, and checklist tasks.

### A7. `seamlessSwitch.ts` existence confirmed
31-line file, evaluation-only. Spec's characterization as "기초 로직" is accurate.

### A8. Canonical policy tables match current code
The 5-state `AccountStatus` type in `accounts.ts` matches the spec's state transition table. `needs_reauth` exists as a type but is missing from rotate's candidate filter exclusion — which is exactly what Task 5 fixes.

---

## Summary Table

| Revalidation Item | Status | Notes |
|---|---|---|
| 1. Rotate timing consistency | ✅ PASS | Zero inconsistencies found |
| 2. QA scenarios per task | ⚠️ PARTIAL | Tasks 1-3 concrete, Tasks 4-10 abstract |
| 3. `seamlessSwitch.ts` omission resolved | ✅ PASS | File exists, correctly referenced in spec |
| 4. `rotate.ts` 90%/needs_reauth/PendingSwitchIntent | ⚠️ MINOR GAP | Accurate but missing one ternary location + exact field names |
| 5. Implementation-ready detail level | ✅ MOSTLY PASS | Tasks 1-3, 11-12 are actionable; Tasks 4-10 need QA tightening |

**Overall verdict**: Document is **ready for implementation with minor fixes**. Critical path items (rotate timing, 90% removal, needs_reauth exclusion) are correctly specified. The main gap is QA scenario executability for Tasks 4-10.
