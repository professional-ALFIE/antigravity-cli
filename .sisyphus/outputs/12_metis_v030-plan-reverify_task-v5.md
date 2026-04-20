# v0.3.0 Plan 5th Re-verification: Fingerprint + Offline-Gateway Addition

**Verifier**: Metis (Pre-Planning Consultant)
**Date**: 2026-04-17
**Scope**: 01-plan-v030-auth-rotate.md — existing 11 Tasks + new Task 12 (Fingerprint) + Task 13 (Offline-Gateway)
**Input**: .sisyphus/inputs/14-prometheus-v030-plan-reverify-task-v5.md

---

## 1. Reference Verification (Task 12 — Fingerprint)

### Pattern References

| Reference | Claimed | Actual | Status |
|-----------|---------|--------|--------|
| `ref/cockpit-tools/.../fingerprint.rs:10-260` | fingerprint generation logic | File exists (384 lines total). Lines 10-260 cover the core generation/storage/apply logic. | ✅ VALID |
| `ref/cockpit-tools/.../account.rs:132-191` | account-fingerprint binding | File exists (2310 lines). Lines 132-191 confirmed: `remember_deleted_account_fingerprint` function visible at L130+. | ✅ VALID |
| `ref/cockpit-tools/.../account.rs:2247-2289` | switch fingerprint apply | File exists. Lines 2247+ confirmed: `apply_bound_fingerprint_for_switch` function visible at L2249+. | ✅ VALID |

### API/Type References

| Reference | Claimed | Actual | Status |
|-----------|---------|--------|--------|
| `src/services/accounts.ts:53-79` | AccountDetail interface | Lines 53-79 confirmed: `AccountDetail` interface with `fingerprint_id: string` at L61. | ✅ VALID |
| `src/services/authInject.ts:139-197` | injectAuthToStateDb_func | Lines 139-197 confirmed: function exists with `serviceMachineId?: string` param at L144. Already has serviceMachineId write at L188-191. | ✅ VALID |
| `src/services/stateVscdb.ts` | upsertTopicRowValuesAtomic | File exists (1537 lines). Function is available. | ✅ VALID |

### External References

| Reference | Exists | Status |
|-----------|--------|--------|
| `handoff-plan-spec/cockpit조사-01-auth.md` | ✅ | VALID |
| `handoff-plan-spec/v0.2.1-01-investigation-cockpit-tools.md` | ✅ | VALID |

**Finding T12-R1**: authInject.ts already has `serviceMachineId?: string` parameter (L144) and the corresponding DB write (L188-191). Task 12 says "serviceMachineId 파라미터 추가" but it's **already present**. The task description should say "USE existing serviceMachineId parameter" rather than "ADD".

**Risk**: LOW — This is a documentation accuracy issue, not a plan defect. The executor will discover the parameter already exists and simply use it.

---

## 2. Reference Verification (Task 13 — Offline-Gateway)

### Pattern References

| Reference | Claimed | Actual | Status |
|-----------|---------|--------|--------|
| `src/services/stateVscdb.ts:1456+` | extractUserStatusSummary_func | L1456 confirmed: function exists. Total file = 1537 lines, so function body extends to ~L1500+. | ✅ VALID |
| `src/services/stateVscdb.ts:1381+` | extractOAuthAccessToken_func | L1381 confirmed. But plan says this is the function — the actual name is `extractOAuthAccessToken` (without `_func`), which matches AGENTS.md convention (the class method). | ⚠️ MINOR — Name: `extractOAuthAccessToken` (method, no `_func` suffix on class methods) |
| `src/services/fakeExtensionServer.ts` | offline reverse RPC shim | File exists (347 lines). | ✅ VALID |
| `src/services/liveAttach.ts` | live LS fast-path | File exists (516 lines). | ✅ VALID |

### API/Type References

| Reference | Claimed | Actual | Status |
|-----------|---------|--------|--------|
| `src/services/quotaClient.ts` | fetchQuotaForAccounts_func | File exists (467 lines). Function confirmed. | ✅ VALID |
| `src/services/authList.ts` | buildAuthListRows_func | File exists (269 lines). | ✅ VALID |
| `src/services/accounts.ts:53-79` | AccountDetail | Confirmed. | ✅ VALID |

### External References

| Reference | Exists | Status |
|-----------|--------|--------|
| `handoff-plan-spec/cockpit조사-03-quota.md` | ✅ | VALID |
| `handoff-plan-spec/v0.2.1-01-investigation-cockpit-tools.md` | ✅ | VALID |
| `AGENTS.md` | ✅ (project root) | VALID |

**Finding T13-R1**: All references point to real, existing files. Line numbers are approximate but within correct ranges.

---

## 3. Wave Placement Verification

### Wave 1b: Task 13 placement

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| T13 Depends On | Task 1 | Plan says: "Blocked By: Task 1 (AccountDetail 필드 구조 확정 후 fast-path 활용)" | ✅ CORRECT |
| T13 Blocks | Task 9 | Plan says: "Blocks: Task 9" | ✅ CORRECT |
| T13 Parallel Group | Wave 1b (with T3, T4) | T3 depends on T1, T4 depends on T1, T13 depends on T1 — all Wave 1b | ✅ CORRECT |

### Wave 3a: Task 12 placement

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| T12 Depends On | Task 8 | Plan says: "Blocked By: Task 8 (switch 실행 구조 확정 후 fingerprint 적용 연동)" | ✅ CORRECT |
| T12 Blocks | Task 10 | Plan says: "Blocks: Task 10" | ✅ CORRECT |
| T12 Parallel Group | Wave 3a (with T9) | T9 depends on T3,T4,T6,T8,T13; T12 depends on T8 only — can run in parallel | ✅ CORRECT |

### Dependency Chain Verification

```
T1 → T13 (Wave 1b) ✓
T1 → T3 (Wave 1b) ✓
T1 → T4 (Wave 1b) ✓
T8 → T12 (Wave 3a) ✓
T9 + T12 → T10 (Wave 3b) ✓
T13 → T9 (Wave 3a) ✓
```

**Finding W1**: Wave placement is correct. No dependency violations detected.

---

## 4. Dependency Matrix Consistency

### Matrix from Plan (Lines 306-320):

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 3, 4, 5, 7, 13 | 1a |
| 2 | — | 7, 9 | 1a |
| 3 | 1 | 6, 9 | 1b |
| 4 | 1 | 6, 9 | 1b |
| 5 | 1 | 6 | 2 |
| 6 | 3, 4, 5 | 9 | 2 |
| 7 | 1, 2 | 8, 9 | 2 |
| 8 | 7 | 12 | 2 |
| 9 | 3, 4, 6, 8, 13 | 10 | 3a |
| 12 | 8 | 10 | 3a |
| 13 | 1 | 9 | 1b |
| 10 | 9, 12 | 11 | 3b |
| 11 | 10 | F1-F4 | 3c |

### Cross-Check with Task Definitions:

| Task | Matrix Depends | Task Def Depends | Match? |
|------|---------------|-----------------|--------|
| 1 | — | None | ✅ |
| 2 | — | None | ✅ |
| 3 | 1 | Task 1 | ✅ |
| 4 | 1 | Task 1 | ✅ |
| 5 | 1 | Task 1 | ✅ |
| 6 | 3,4,5 | Tasks 3, 4, 5 | ✅ |
| 7 | 1,2 | Tasks 1, 2 | ✅ |
| 8 | 7 | Task 7 | ✅ |
| 9 | 3,4,6,8,13 | Tasks 3, 4, 6, 8 + Task 13 (fast-path) | ✅ |
| 12 | 8 | Task 8 (switch execution) | ✅ |
| 13 | 1 | Task 1 (AccountDetail) | ✅ |
| 10 | 9,12 | Tasks 9, 12 | ✅ |

### Reverse-Check (Blocks → Blocked By consistency):

| A blocks B | B depends on A | Match? |
|-----------|---------------|--------|
| 1→3 | 3←1 | ✅ |
| 1→4 | 4←1 | ✅ |
| 1→5 | 5←1 | ✅ |
| 1→7 | 7←1 | ✅ |
| 1→13 | 13←1 | ✅ |
| 2→7 | 7←2 | ✅ |
| 2→9 | 9←? | ⚠️ Matrix shows T9 depends on 3,4,6,8,13 but NOT T2. But T2 blocks T9 in the matrix. |
| 3→6 | 6←3 | ✅ |
| 3→9 | 9←3 | ✅ |
| 4→6 | 6←4 | ✅ |
| 4→9 | 9←4 | ✅ |
| 5→6 | 6←5 | ✅ |
| 7→8 | 8←7 | ✅ |
| 7→9 | 9←? | ⚠️ Same as T2→T9 |
| 8→12 | 12←8 | ✅ |
| 12→10 | 10←12 | ✅ |
| 13→9 | 9←13 | ✅ |

**Finding DM1**: T2 says "Blocks: T7, T9" and T7 says "Blocks: T8, T9". The matrix shows T9 Depends On = {3,4,6,8,13}. T9 does NOT list T2 or T7 as dependencies. However:
- T2 (effectiveFamily CLAUDE) is a prerequisite for T7 (post-response rotate which uses effectiveFamily)
- T7 is a prerequisite for T8 which is a prerequisite for T9
- So T2 indirectly reaches T9 via T7→T8→T9

This is a **transitive dependency**, not a direct one. The matrix is technically correct — T9 doesn't need T2 directly, it needs T8 (which needs T7, which needs T2). The "Blocks" column in T2 is slightly misleading but not a plan error.

**Finding DM2**: T8 Blocks column says "12" but also "9" in Task 8 definition (L993: "Blocks: Task 12 (fingerprint inject), Task 9"). However the Dependency Matrix row for T8 says "Blocks: 12" only, not "12, 9". T9's Depends On includes T8, so the matrix row for T8 should say "Blocks: 12, 9" or alternatively T9 should not list T8.

**WAIT**: Looking more carefully:
- T8 matrix row: Blocks = 12 (missing 9?)
- T9 matrix row: Depends On = 3, 4, 6, 8, 13 (includes 8)

So T9 depends on T8, but T8's Blocks column doesn't list T9. **This is an inconsistency in the Dependency Matrix.** T8 Blocks should include T9.

**Severity**: MEDIUM — The task definitions are correct (T9 says "Blocked By: Tasks 3, 4, 6, 8" at L1082-1085), but the matrix row for T8 omits T9 from the Blocks column.

---

## 5. Must NOT Have Update Consistency

### Before (4th verification):
- "Offline-Gateway 구현 금지"
- "Device Fingerprint NOT NOW"

### After (5th — current plan):

| Item | Old | New | Consistent? |
|------|-----|-----|-------------|
| Offline-Gateway | "구현 금지" | "v0.3.0에 최소 동작경로 포함 (Task 13)" | ✅ Strikethrough + replacement |
| Device Fingerprint | "NOT NOW" | "fingerprint 자동화는 Task 12로 포함" | ✅ Strikethrough + replacement |

### Must NOT Have Full Check:

```
✅ rotate.ts 재작성 금지 — unchanged
✅ wakeup.ts 재작성 금지 — unchanged
✅ accounts.ts 스키마 재설계 금지 — unchanged
✅ Offline-Gateway → v0.3.0에 최소 동작경로 포함 (Task 13) — updated
✅ mid-session account switching 금지 — unchanged
✅ pending-switch.json에 auth token 저장 금지 — unchanged
✅ auth list 전체 계정 네트워크 갱신 금지 — unchanged
✅ 90% 회복 reset 규칙 금지 — unchanged
✅ Plugin Sync, Device Fingerprint → fingerprint 자동화는 Task 12로 포함 — updated
✅ exponential backoff, per-account rate limiting — unchanged
```

**Finding MNH1**: All Must NOT Have updates are consistent. The strikethrough notation is clear. No contradictions.

---

## 6. Impact on Existing 11 Tasks

### Check: Do T12 or T13 introduce changes that affect existing T1-T11?

| Existing Task | T12 Impact | T13 Impact | Status |
|---------------|-----------|-----------|--------|
| T1 (AccountDetail) | None — T12 uses existing fingerprint_id field | None — T13 uses existing quota_cache | ✅ NO IMPACT |
| T2 (90% reset + effectiveFamily) | None | None | ✅ NO IMPACT |
| T3 (auth refresh) | None — T12 touches authLogin, not authRefresh | T13 could optimize T3's quota reading, but T3 is self-contained | ✅ NO IMPACT |
| T4 (auth list) | None | T13 modifies authList.ts + quotaClient.ts — **POTENTIAL OVERLAP** | ⚠️ SEE BELOW |
| T5 (wakeup) | None | None | ✅ NO IMPACT |
| T6 (wakeup timings) | None | None | ✅ NO IMPACT |
| T7 (post-response rotate) | None | None | ✅ NO IMPACT |
| T8 (switch execution) | T12 extends T8's switch to apply fingerprint — T8 creates the switch mechanism, T12 adds fingerprint on top | None | ⚠️ SEE BELOW |
| T9 (main.ts integration) | T12 also modifies main.ts switch path — but T12 runs in parallel with T9 in Wave 3a. Need to verify no merge conflict | None | ⚠️ SEE BELOW |
| T10 (edge cases) | T10 depends on T12, so edge cases for fingerprint included | None | ✅ BY DESIGN |
| T11 (docs) | May need fingerprint docs | None | ✅ MINOR |

**Finding IMP1 (T4 ↔ T13 overlap)**:
- T4 modifies: `src/main.ts`, `src/services/authList.ts`
- T13 modifies: `src/services/authList.ts`, `src/services/quotaClient.ts`
- Both touch `authList.ts`. T4 runs in Wave 1b, T13 also runs in Wave 1b (parallel).
- **Risk**: Merge conflict in authList.ts if both tasks modify the same functions.
- **Mitigation**: T4 focuses on selective refresh logic. T13 focuses on fast-path quota reading. They modify different functions within authList.ts (T4 → buildAuthListRows_func selection logic; T13 → fast-path integration into buildParseResultFromQuotaCache_func or similar).
- **Severity**: MEDIUM — Potential merge conflict but likely in different functions.

**Finding IMP2 (T8 → T12 extension)**:
- T8 creates `applySwitchForNextInvocation_func` in rotate.ts
- T12 adds fingerprint application on top of T8's switch
- T12 runs in Wave 3a, T8 runs in Wave 2 — correct ordering ✅
- T12 modifies `src/main.ts` switch path — but T9 also modifies main.ts in the same wave (Wave 3a, parallel)
- **Risk**: Both T9 and T12 modify main.ts switch/consumption path.
- **Mitigation**: T9 focuses on auth routing + pre/post prompt. T12 focuses on fingerprint injection in the switch path. These are different code sections in main.ts.
- **Severity**: LOW — Different code sections, but parallel execution on same file requires careful merge.

**Finding IMP3 (T12 claims authInject.ts modification)**:
- T12 says: "authInject.ts: serviceMachineId 파라미터 추가"
- But authInject.ts ALREADY has `serviceMachineId?: string` parameter (L144) and the implementation (L188-191)
- T12 should say "USE existing serviceMachineId parameter" instead
- **Severity**: LOW — Misleading description but no functional impact.

---

## 7. SC-13 and SC-14 Verifiability

### SC-13: Fingerprint 자동화

| Given/When/Then | Agent-Verifiable? | How? |
|-----------------|-------------------|------|
| Auth login → fingerprint file created | ✅ YES | `ls ~/.antigravity-cli/fingerprints/{accountName}.json` + bun test mock |
| Fingerprint contains machineId, platformInfo | ✅ YES | bun test assertion on JSON content |
| Switch → fingerprint applied to state.vscdb | ✅ YES | bun test mock: check serviceMachineId value in mock DB |
| Switch → serviceMachineId replaced | ✅ YES | bun test assertion |
| Atomic application with auth inject | ✅ YES | bun test: verify all fields written in single transaction |

**SC-13 Verdict**: ✅ FULLY VERIFIABLE — All conditions are testable via unit tests with mocks.

### SC-14: Offline-Gateway 최소 동작경로

| Given/When/Then | Agent-Verifiable? | How? |
|-----------------|-------------------|------|
| Offline → state.vscdb direct quota read | ✅ YES | bun test mock state.vscdb with uss-userStatus data |
| All-null quota → "sleeping" display | ✅ YES | bun test: check display string |
| Live LS → fast-path quota read | ✅ YES | bun test mock: live LS detected + state.vscdb read |
| Same output format offline/live | ✅ YES | bun test: compare output objects |

**SC-14 Verdict**: ✅ FULLY VERIFIABLE — All conditions are testable via unit tests with mocks.

---

## 8. Commit Strategy Accuracy

### Plan lists 13 commits:

| Wave | Commit Message | Files Listed | Covers Tasks | Status |
|------|---------------|-------------|-------------|--------|
| 1a | feat(accounts): saveAccountCard + discoverAccounts fix | accounts.ts, accounts.test.ts, quotaClient.ts | T1 | ✅ |
| 1a | fix(rotate): remove 90% + CLAUDE default | rotate.ts, rotate.test.ts, main.ts, main.test.ts | T2 | ✅ |
| 1b | feat(auth): auth refresh command | main.ts, main.test.ts, quotaClient.ts, quotaClient.test.ts | T3 | ✅ |
| 1b | feat(auth-list): lightweight card-based | main.ts, main.test.ts, authList.ts, authList.test.ts | T4 | ✅ |
| 1b | feat(quota): state.vscdb fast-path | quotaFastPath.ts, quotaFastPath.test.ts, quotaClient.ts, authList.ts | T13 | ✅ |
| 2 | feat(wakeup): executeWakeup orchestration | wakeup.ts, wakeup.test.ts | T5 | ✅ |
| 2 | feat(wakeup): integrate at 4 timings | main.ts, main.test.ts | T6 | ✅ |
| 2 | feat(rotate): post-response pipeline | main.ts, main.test.ts | T7 | ✅ |
| 2 | feat(rotate): switch-for-next + pending-switch extend | rotate.ts, rotate.test.ts | T8 | ✅ |
| 3 | feat(main): integrate auth refresh, list, pipelines | main.ts, main.test.ts | T9 | ✅ |
| 3 | feat(fingerprint): auto generation + apply on switch | fingerprint.ts, fingerprint.test.ts, authLogin.ts, authInject.ts, main.ts | T12 | ✅ |
| 3 | test: edge case coverage | 각 모듈 test 파일 | T10 | ✅ |
| 3 | docs: update README/CHANGELOG | README.md, README.ko.md, CHANGELOG.md, AGENTS.md | T11 | ✅ |

**Finding CS1**: All 13 tasks have corresponding commits. T12 and T13 are correctly represented.

**Finding CS2**: T12 commit includes `authInject.ts` but as noted, authInject already has serviceMachineId support. The commit should likely say "USE existing serviceMachineId in authInject" rather than implying modification.

---

## Summary of Findings

### ✅ PASS (No Issues)
1. **References**: All file paths and line ranges point to real, existing code
2. **Wave placement**: Correct dependency ordering, no violations
3. **Must NOT Have**: Consistent updates, clear strikethrough notation
4. **SC-13, SC-14**: Fully agent-verifiable via unit tests
5. **Commit strategy**: 13 commits cover all 13 tasks accurately
6. **Existing 11 Tasks**: No breaking changes from T12/T13 additions

### ⚠️ FINDINGS (Non-Blocking)

| ID | Severity | Description | Recommendation |
|----|----------|-------------|----------------|
| DM2 | MEDIUM | Dependency Matrix T8 row "Blocks" column missing T9. T9 Depends On includes T8, but T8's Blocks doesn't list T9. | Fix matrix: T8 Blocks = "12, 9" |
| T12-R1 | LOW | Task 12 says "serviceMachineId 파라미터 추가" but authInject.ts already has it (L144) | Clarify: "USE existing serviceMachineId parameter" |
| IMP1 | MEDIUM | T4 and T13 both modify authList.ts in Wave 1b (parallel). Potential merge conflict. | Executor should coordinate: T4 = selective refresh, T13 = fast-path reading |
| IMP2 | LOW | T9 and T12 both modify main.ts in Wave 3a (parallel). Different sections but same file. | Executor should merge carefully |
| IMP3 | LOW | T12 commit includes authInject.ts modification but it's already implemented | No action needed — executor will discover and use existing code |

### ❌ FAIL (Blocking)
None.

---

## Overall Verdict

**APPROVE WITH MINOR NOTES**

The plan is structurally sound after adding Task 12 and Task 13. All 7 verification points pass:

1. ✅ References valid (minor: T12-R1 serviceMachineId already exists)
2. ✅ Wave placement correct
3. ⚠️ Dependency Matrix has one inconsistency (DM2: T8 Blocks missing T9)
4. ✅ Must NOT Have consistent
5. ✅ No breaking impact on existing tasks
6. ✅ SC-13, SC-14 fully verifiable
7. ✅ Commit strategy accurate

The plan is ready for execution. The DM2 finding is cosmetic (task definitions are correct, only the summary matrix has the omission) and the IMP1 finding is manageable by the executor.
