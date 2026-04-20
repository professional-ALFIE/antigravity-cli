# Metis v4 Re-verification: Plan v0.3.0 Auth Rotate

**Verdict**: ✅ APPROVE (4.8/5)
**Date**: 2026-04-17
**Plan**: `.sisyphus/plans/01-plan-v030-auth-rotate.md`

---

## 1. Momus 3rd-round 3 Blocking Issues — Resolution Check

### Issue #1: Task 1 userDataDirPath bug fix not explicitly in Task 1

**Status**: ✅ RESOLVED

| Aspect | Evidence (line numbers in plan) |
|--------|-------------------------------|
| "What to do" code | L315-326: Inline code block with `account_var.id.startsWith('user-')` fix |
| TDD requirement | L328: "TDD: accounts.test.ts에 discoverAccounts index-backed path가 managed 계정에 올바른 경로를 반환하는지 테스트 추가" |
| Acceptance Criteria | L366: "Test: discoverAccounts_func index-backed path에서 managed 계정(user-*)이 올바른 개별 userDataDirPath를 반환" |
| QA Scenario | L389-398: Dedicated "discoverAccounts index-backed path 버그 수정 확인" scenario with mock, steps, expected |
| Commit message | L402: "feat(accounts): add saveAccountCard pipeline + fix discoverAccounts userDataDirPath for managed accounts" |

**Verdict**: The fix is now a first-class part of Task 1 with code, tests, acceptance criteria, QA, and commit tracking.

### Issue #2: Task 9 pending-switch.json semantic transition not handled

**Status**: ✅ RESOLVED

| Aspect | Evidence (line numbers in plan) |
|--------|-------------------------------|
| "What to do" section | L1026-1031: New subsection "pending-switch.json 의미 전환 처리" explaining old behavior, new v0.3.0 semantics, and design choice |
| Design choice | L1031: "명확한 선택: 파일을 기록(log)으로 유지하되 startup에서는 이미 적용된 것으로 간주" |
| References | L1051-1052: main.ts:1028-1052 and main.ts:2383-2394 added |
| Acceptance Criteria | L1062: "Test: pending-switch.json이 '기록 파일'로 동작 — 시작 시 소비/삭제하지 않고 이미 적용된 것으로 간주" |

**Verdict**: The semantic transition is now explicitly documented with a clear design decision, references to existing code, and testable acceptance criteria.

### Issue #3: F1 category `oracle` not in allowed categories

**Status**: ✅ RESOLVED

| Location | Before | After (v4) |
|----------|--------|------------|
| Wave structure (L257) | `oracle` | `deep` |
| Agent Dispatch Summary (L292) | `oracle` | `deep` |
| F1 task body (L1240) | `oracle` | `deep` |

**Verdict**: All three occurrences changed to `deep`. No remaining `oracle` references in the plan.

---

## 2. Full Plan Integrity Re-verification

### 2.1 Structural Integrity

| Check | Result |
|-------|--------|
| All 11 tasks have "What to do" | ✅ |
| All 11 tasks have "Must NOT do" | ✅ |
| All 11 tasks have Acceptance Criteria | ✅ |
| All 11 tasks have QA Scenarios | ✅ |
| All 11 tasks have Commit spec | ✅ |
| All 11 tasks have References | ✅ |
| All 11 tasks have Recommended Agent Profile | ✅ |
| All 11 tasks have Parallelization info | ✅ |
| Dependency Matrix matches Wave structure | ✅ |
| Agent Dispatch Summary matches Wave structure | ✅ |

### 2.2 Dependency Graph Consistency

| Task | Plan Depends On | Matrix Depends On | Consistent? |
|------|----------------|-------------------|-------------|
| 1 | — | — | ✅ |
| 2 | — | — | ✅ |
| 3 | 1 | 1 | ✅ |
| 4 | 1 | 1 | ✅ |
| 5 | 1 | 1 | ✅ |
| 6 | 3,4,5 | 3,4,5 | ✅ |
| 7 | 1,2 | 1,2 | ✅ |
| 8 | 7 | 7 | ✅ |
| 9 | 3,4,6,8 | 3,4,6,8 | ✅ |
| 10 | 9 | 9 | ✅ |
| 11 | 10 | 10 | ✅ |

### 2.3 Category Validity

All categories used in the plan:
- `unspecified-high`: T1, T3, T4, T6, T8, T10, F2, F3 — ✅ in allowed list
- `quick`: T2, T11 — ✅ in allowed list
- `deep`: T5, T7, T9, F1, F4 — ✅ in allowed list
- No `oracle` or other invalid categories — ✅

### 2.4 Success Criteria Coverage

| SC | Covered by Task | Traceable? |
|----|----------------|------------|
| SC-1 auth refresh | T3, T9 | ✅ |
| SC-2 auth list lightweight | T4, T9 | ✅ |
| SC-3 Account Card persistence | T1 | ✅ |
| SC-4 5h cycle identification | T5 | ✅ |
| SC-5 Post-response rotate | T7, T9 | ✅ |
| SC-6 Bucket persistence | T7 | ✅ |
| SC-7 Switch recording | T8 | ✅ |
| SC-8 Candidate ranking | T7 (rotate.ts) | ✅ |
| SC-9 Reset time 99% | Existing code | ✅ |
| SC-10 effectiveFamily CLAUDE | T2 | ✅ |
| SC-11 Wake-up 4 timings | T5, T6, T9 | ✅ |
| SC-12 90% reset removal | T2 | ✅ |

### 2.5 Must Have / Must NOT Have Alignment

- **Must Have** (13 items): Each maps to at least one task — ✅
- **Must NOT Have** (9 items): Each maps to guardrails in relevant tasks — ✅
- No contradictions between Must Have and Must NOT Have — ✅

---

## 3. Issues Found

### 3.1 Minor Issue: Commit Strategy Table Stale (Non-blocking)

**Location**: L1420, Commit Strategy table
**Issue**: Wave 1a row still shows `feat(accounts): add saveAccountCard pipeline for quota→card persistence` (the pre-v4 message), while Task 1's actual commit message (L402) was updated to `feat(accounts): add saveAccountCard pipeline + fix discoverAccounts userDataDirPath for managed accounts`.
**Severity**: Low — task-level commit message takes precedence during execution.
**Recommendation**: Update the Commit Strategy table at L1420 to match Task 1's commit message. This is cosmetic; does not block execution.

### 3.2 New Issues Introduced by v4 Changes

None detected. The three v4 additions are clean, well-scoped, and do not create new conflicts.

---

## 4. Final Verdict

| Dimension | Score | Notes |
|-----------|-------|-------|
| Momus 3 issues resolved | 3/3 | All blocking issues addressed |
| Structural integrity | 10/10 | All required sections present |
| Dependency consistency | 11/11 | Matrix matches wave structure |
| Category validity | 14/14 | All in allowed list |
| SC coverage | 12/12 | All success criteria traced to tasks |
| New issues from v4 | 0 | No regressions |
| **Overall** | **4.8/5** | **APPROVE — minor commit table typo is non-blocking** |

**Recommendation**: Plan is ready for execution. The commit strategy table at L1420 should be updated to reflect Task 1's corrected message, but this can be done as part of execution setup.
