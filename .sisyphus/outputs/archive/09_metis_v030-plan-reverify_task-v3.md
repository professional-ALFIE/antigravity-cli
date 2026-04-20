# Metis 3rd Re-verification: v0.3.0 Plan (`01-plan-v030-auth-rotate.md`)

**Verdict**: ✅ APPROVE (4.7/5) — All 3 minor issues from 2nd review confirmed fixed. No new issues found.

---

## 1. Minor Issue Resolution (3/3 FIXED)

### Issue #1: `writeAccountDetailSync_func` → `writeAccountDetail_func`
- **Status**: ✅ FIXED
- **Evidence**: 
  - Plan line 336: `writeAccountDetail_func (0600 권한 저장 패턴)` — correct function name
  - Plan line 352: `readAccountDetailSync_func` or `writeAccountDetail_func` — correct
  - Source `accounts.ts:296`: `function writeAccountDetail_func(...)` — matches
  - Source `accounts.ts:229`: `function readAccountDetailSync_func(...)` — matches
  - No remaining occurrences of the erroneous `writeAccountDetailSync_func` in the plan

### Issue #2: `decideAutoRotate_func` start line L72 (plan previously said L30)
- **Status**: ✅ FIXED
- **Evidence**:
  - Plan line 854: `src/services/rotate.ts:72-158` — correct range
  - Source `rotate.ts:72`: `export function decideAutoRotate_func(...)` — confirmed
  - No remaining occurrences of `30-158` in the plan

### Issue #3: `authLogin_func` scope L343-492 (plan previously said L343-399)
- **Status**: ✅ FIXED
- **Evidence**:
  - Plan line 647: `src/services/authLogin.ts:343-492` — correct range
  - Source `authLogin.ts:343`: `export async function authLogin_func(...)` — confirmed
  - Source file is exactly 492 lines — confirmed
  - No remaining occurrences of `343-399` in the plan

---

## 2. Full Plan Integrity Re-check

### 2.1 Wave Structure
- **7 waves**: 1a, 1b, 2, 3a, 3b, 3c, Final — correct (plan line 17)
- **Wave 3 properly split**: 3a (T9) → 3b (T10) → 3c (T11) — correct (plan lines 247-254)
- **Agent Dispatch Summary**: Updated to match 7-wave structure (plan lines 286-292) — correct

### 2.2 Dependency Matrix
- T1→blocks 3,4,5,7 | T2→blocks 7,9 | T3→blocked by 1, blocks 6,9 | T4→blocked by 1, blocks 6,9
- T5→blocked by 1, blocks 6 | T6→blocked by 3,4,5, blocks 9 | T7→blocked by 1,2, blocks 8,9
- T8→blocked by 7, blocks 9 | T9→blocked by 3,4,6,8, blocks 10 | T10→blocked by 9, blocks 11
- T11→blocked by 10, blocks F1-F4
- **All dependencies acyclic** ✅
- **Critical path**: T1→T5→T6→T9→T10→Final — matches plan line 263

### 2.3 Function Name Accuracy
| Plan Reference | Actual Source | Match |
|---|---|---|
| `writeAccountDetail_func` (L336) | `accounts.ts:296` | ✅ |
| `readAccountDetailSync_func` (L352) | `accounts.ts:229` | ✅ |
| `decideAutoRotate_func` (L854) | `rotate.ts:72` | ✅ |
| `authLogin_func` (L647) | `authLogin.ts:343` | ✅ |
| `fetchQuotaForAccounts_func` (L339,L487) | `quotaClient.ts` | ✅ (with correction note) |
| `buildParseResultFromQuotaCache_func` (L564) | `authList.ts:39-60` | ✅ |
| `buildAuthListRows_func` (L565) | `authList.ts:156-208` | ✅ |

### 2.4 Spec Completeness
- **12 Success Criteria** (SC-1 through SC-12) — all present and well-structured
- **Must Have**: 12 items — comprehensive
- **Must NOT Have**: 10 guardrails — specific and actionable
- **Definition of Done**: 8 checkboxes — all verifiable

### 2.5 Task Structure
- 11 tasks + 4 final verification tasks = 15 total
- Each task has: What to do, Must NOT do, Agent Profile, Parallelization, References, Acceptance Criteria, QA Scenarios, Commit message
- **F1-F4 all have detailed QA Scenarios** (added in v3) — verified

### 2.6 Commit Strategy
- 11 atomic commits mapped to waves — consistent with task boundaries
- File lists match task scopes — no cross-contamination in commit plans

---

## 3. Issues Found (0 new)

No new issues discovered in this verification round.

---

## 4. Assessment

| Dimension | Score | Notes |
|---|---|---|
| Function name accuracy | 5/5 | All 3 previous issues fixed, all names verified against source |
| Line reference accuracy | 5/5 | All ranges match actual source positions |
| Wave structure | 5/5 | 7 waves properly split, dependency matrix correct |
| Spec completeness | 4.5/5 | SC-1 through SC-12 comprehensive; F1-F4 QA scenarios now present |
| Guardrails | 5/5 | Must NOT Have specific and verifiable |
| Task structure | 4.5/5 | All tasks have full sections; minor: T10 edge cases could be more specific on mock setup |
| Dependency graph | 5/5 | Acyclic, critical path correct, parallel groups valid |
| Overall | **4.7/5** | Ready for execution |

---

## 5. Recommendation

**APPROVE** — Plan is execution-ready. All 3 previously identified minor issues are confirmed fixed. Wave structure properly updated to reflect T9→T10→T11 serial dependencies. F1-F4 QA scenarios are now concrete and agent-executable.
