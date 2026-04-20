# Metis Pre-Plan Review: v0.3.0 Spec + Plan Document

**Intent Classification**: Build from Scratch (new features on existing codebase)
**Confidence**: High
**Rationale**: 10 concrete features to implement on an existing CLI. The scope is bounded, but the handoff document has significant inaccuracies about what already exists in code.

---

## CRITICAL FINDING: Handoff vs Reality Gap

The handoff document (`v0.3.0-01-handoff.md`) claims these code gaps:

> - No `auth refresh` command
> - No AccountCard type / persistent card store
> - No 5h usage cycle tracking
> - No wake-up orchestration
> - No post-response fresh quota re-read + crossing detection pipeline
> - No bucket persistence to store

**Reality check after reading actual code:**

| Handoff Claim | Actual Code State | Gap Assessment |
|---|---|---|
| "No `auth refresh` command" | ✅ True. Only `auth list` and `auth login` exist. `AuthSubcommand = 'list' \| 'login'` | Need to add |
| "No AccountCard type / persistent card store" | ⚠️ **PARTIALLY FALSE**. `AccountDetail` in `accounts.ts` (L53-79) already has: `quota_cache` (tier, families, fetch_error, cached_at), `rotation` (family_buckets, last_rotated_at), `wakeup_history` (last_attempt_at, last_result, attempt_count). Files are persisted per-account under `~/.antigravity-cli/accounts/<id>.json` | Fields exist but NOT all populated by current pipeline |
| "No 5h usage cycle tracking" | ✅ True. No concept of "usage cycle started" flag exists | Need to add |
| "No wake-up orchestration" | ⚠️ **PARTIALLY FALSE**. `wakeup.ts` exists with `filterWakeupCandidates_func` (sleeping quota detection, cooldown, status filtering) and `updateWakeupHistory_func`. Tests exist (`wakeup.test.ts`). But no actual "open Antigravity app → poll state.vscdb" orchestration | Logic exists, execution path missing |
| "No post-response fresh quota re-read + crossing detection" | ⚠️ **PARTIALLY FALSE**. `rotate.ts` exists with `decideAutoRotate_func` that does bucket crossing detection (turn-before vs stored-bucket comparison), pending switch persistence, candidate ranking. `decideAndPersistAutoRotate_func` in main.ts wires it. But the **pre-turn snapshot → post-turn re-read comparison** pipeline is missing | Bucket crossing logic exists, but the turn-before/turn-after comparison flow is incomplete |
| "No bucket persistence" | ⚠️ **FALSE**. `rotate.ts` already implements `familyBuckets` tracking on `RotateAccountSnapshot`. The `decideAutoRotate_func` stores the processed bucket and checks against it. `rotate.test.ts` R-2 test confirms "same bucket does not rotate again" | **Already implemented** |

### Impact on Planning

This gap analysis is critical because:
1. **6 of 10 features have significant existing code** — the plan must be "extend existing" not "build from scratch"
2. The handoff's "code gaps" section is misleading — implementors might rebuild what already exists
3. The real work is **wiring** (connecting existing modules) and **filling specific gaps**, not greenfield development

---

## 1. Questions You Should Have Asked But Didn't

### Q1: What is the exact "auth refresh" UX contract?
The handoff says "auth refresh forces all accounts' cloud quota refresh." But:
- Should `auth refresh` also update `wakeup_history`? The handoff [2-1] says "5h cycle 미시작 계정이 있으면 wake-up 후보로 잡는다" — does `auth refresh` *trigger* wake-ups, or just *mark* them?
- What's the expected output format? Same table as `auth list`? JSON mode support?
- Should `auth refresh` fail if network is unavailable, or fall back to stale cache?

### Q2: How does "pre-turn snapshot" work with the current `decideAndPersistAutoRotate_func`?
The handoff says "이번 턴 전 값과 이번 턴 후 값을 비교" but the current `rotate.ts` compares against `storedBucket` (the last bucket recorded on the account card). These are different:
- **Current code**: stored bucket vs current bucket
- **Handoff spec**: turn-start-pct vs turn-end-pct (turn-before/turn-after)

The handoff envisions a temporal comparison (what changed during *this conversation*), but `rotate.ts` only does spatial comparison (current position vs stored boundary). This is a fundamental architecture question.

**Recommendation**: Clarify whether the current `storedBucket` approach is sufficient (it achieves the same effect if the card is updated post-turn) or whether a true turn-scoped snapshot is needed.

### Q3: What triggers the "pre-prompt background quick-check"?
The handoff says "매 프롬프트 시작 전에는 현재 계정 카드 quick check" — but:
- Is this a `readQuotaCache_func` call (local file read, ~0ms)?
- Or a `readQuotaCache_func` + staleness check + selective cloud fetch?
- The spec says "never blocks first response" — so it must be fire-and-forget. But what if the cache is empty?

### Q4: How does the switch actually happen?
The handoff [9] says "바로 switch를 수행하고" but there's no implementation of what "switch" means. Currently:
- `seamlessSwitch.ts` only evaluates feasibility (returns `mode: 'unsupported' | 'experimental'`)
- `authInject.ts` can write tokens to state.vscdb
- But there's no code that: (a) reads target account's tokens, (b) injects them, (c) restarts LS, (d) waits for ready

This is the **largest missing piece** and the handoff treats it as a detail.

### Q5: What is the "5h usage cycle" signal?
The handoff says wake-up targets accounts whose "5h usage cycle이 아직 시작되지 않았다." But:
- How do you detect this? Currently `wakeup.ts` checks `remaining_pct === null` for all families. Is "all null" the signal?
- What if an account has partial data (GEMINI quota known but CLAUDE null)?
- Is there a Cloud Code API that returns whether the cycle has started, or is it inferred from quota state?

### Q6: What happens when `auth refresh` discovers a forbidden account?
The handoff doesn't discuss error handling for individual accounts during batch refresh. If 8 of 10 accounts refresh fine but 2 are forbidden:
- Should the command fail or succeed?
- Should the card be updated with `forbidden` status?
- Should wake-up be attempted for forbidden accounts? (Current `wakeup.ts` says no)

### Q7: Is `effectiveFamily` resolution correct in the current code?
Main.ts L1079-1083:
```ts
const effective_family_var = options_var.cli.model?.toLowerCase().includes('claude')
  ? 'CLAUDE'
  : options_var.cli.model?.toLowerCase().includes('gemini')
    ? 'GEMINI'
    : null;
```
The handoff says "기본은 CLAUDE, 명확히 Gemini일 때만 Gemini." But the current code defaults to `null` (which means "use _min across all families"). This contradicts the spec. Which is correct?

---

## 2. Guardrails That Need to Be Explicitly Set

### G1: No rebuild of existing modules
The plan must explicitly state:
- `rotate.ts`: EXTEND, do not rewrite. Bucket crossing logic is already tested and working.
- `wakeup.ts`: EXTEND. Filter logic is correct. Add execution orchestration only.
- `accounts.ts`: EXTEND. `AccountDetail` type already has the right fields. Add population logic.
- `quotaClient.ts`: USE AS-IS. The batch fetch with 60s cache TTL is exactly what `auth refresh` needs.
- `authList.ts`: EXTEND. Add card-based path, keep current network path for `auth refresh`.

### G2: pending-switch.json format must NOT change
Current format in `rotate.ts`:
```ts
interface PendingSwitchIntent {
  target_account_id: string;
  source_account_id: string;
  reason: string;
  decided_at: number;
}
```
The handoff wants to add `fingerprint_id`, `serviceMachineId`, and `before/after values`. These must be ADDED to the existing interface, not replace it.

### G3: Auth tokens must NEVER appear in pending-switch.json
This is already stated in the handoff but needs enforcement in the plan: no `access_token`, `refresh_token`, or bearer strings in any JSON file except `accounts/<id>.json` (which is already chmod 0600).

### G4: `auth list` must remain fast (< 1 second)
The whole point of splitting `auth refresh` from `auth list` is speed. The plan must enforce:
- `auth list` default: read from `AccountDetail.quota_cache` (local file reads only)
- Selective refresh: maximum 2-3 accounts, never all
- No blocking on network for the display path

### G5: Wake-up must NEVER block first response
The handoff says this but the plan needs an explicit test:
```
Test: Wake-up of 5 sleeping accounts takes 30+ seconds. First response still arrives immediately.
```

### G6: No Offline-Gateway implementation in v0.3.0
The handoff mentions "Offline-Gateway" in [4] as a future possibility. This MUST be explicitly marked NOT NOW. v0.3.0 scope is:
- `auth refresh` command
- `auth list` lightweight (card-based)
- Account card population pipeline
- Wake-up orchestration (open Antigravity → poll state.vscdb)
- Post-response rotate pipeline
- Bucket persistence (already done, verify wiring)
- immediate switch + pending-switch.json extension

### G7: The 90% bucket reset rule
The handoff says "90% 이상 회복 시 reset 같은 애매한 조항은 넣지 않는다" but the current `rotate.ts` L107-109 DOES implement 90% reset:
```ts
if (currentRemainingPct_var !== null && currentRemainingPct_var >= 90) {
  updatedCurrentAccount_var.familyBuckets[bucketKey_var] = null;
}
```
And `rotate.test.ts` R-9 tests this behavior. **The handoff and the code disagree.** This needs explicit resolution.

---

## 3. Potential Scope Creep Areas to Lock Down

### SC1: Seamless switch implementation
`seamlessSwitch.ts` currently returns `mode: 'unsupported'`. The handoff implies switch happens. Don't let the plan drift into implementing a full seamless switch mechanism. v0.3.0 should do:
1. Write target account tokens to current account's state.vscdb via `authInject.ts`
2. Record the switch in pending-switch.json
3. The NEXT CLI invocation will use the new account

This is NOT seamless (no mid-session switching), but it's safe and testable.

### SC2: Live LS token refresh
Don't implement runtime token refresh on a live LS. The current architecture is "choose account at start, use it for the whole session." Mid-session account switching is v0.4.0+ territory.

### SC3: Wake-up rate limiting
The 30-minute cooldown in `wakeup.ts` is sufficient. Don't add exponential backoff, per-account rate limits, or quota-based throttling.

### SC4: Account card schema versioning
Don't add migration logic for AccountDetail schema changes. The current code handles missing fields with defaults (`existing_var?.quota_cache ?? { ... }`). New fields can follow the same pattern.

### SC5: Network timeout tuning
Don't optimize the 4-at-a-time batch or add per-request timeouts. That's a separate performance concern.

---

## 4. Assumptions That Need Validation

### A1: "all null families = 5h cycle not started"
This is the core assumption for wake-up targeting. But what if:
- An account has never been queried (no card exists yet)
- An account was queried but got an error (families empty but fetch_error is set)
- An account has one family known but another null (partial wake-up?)

**Test needed**: Verify with real accounts what the quota API returns for unused accounts.

### A2: "auth refresh uses the same pipeline as current auth list"
The current `handleAuthList_func` in main.ts does the full network fetch. The plan assumes `auth refresh` reuses this pipeline. But the current code may have coupling to display rendering that needs separation.

### A3: "switch = write target tokens to current state.vscdb"
The handoff doesn't define the switch mechanism. The assumption is:
1. Read target account's token from `accounts/<target-id>.json`
2. Write to current workspace's state.vscdb via `authInject.ts`
3. Update `accounts.json` current_account_id
4. Record in pending-switch.json

This needs validation against `authInject.ts`'s actual capabilities.

### A4: "stored bucket comparison is equivalent to turn-before/turn-after"
The current `rotate.ts` compares `currentBucket` (computed from current pct) vs `storedBucket` (saved on card). If the card is updated post-turn with the post-response pct, then the next turn's comparison is effectively turn-after (previous) vs turn-current. This is equivalent to the handoff's "73%→64% is crossing, 67%→64% is not" because:
- Turn N ends at 73%, bucket='70' is recorded → next turn reads 64%, bucket='70' still matches → no rotate
- Wait, that's wrong. If 73% crosses the 70% boundary, the bucket IS '70' at that point.

Actually the logic is:
- 73% → bucket='70', stored=null → CROSSING → record bucket='70'
- 64% → bucket='70', stored='70' → NO CROSSING (same bucket)
- This IS the correct behavior!

So assumption A4 is VALIDATED. The existing approach works.

### A5: "effectiveFamily defaults to CLAUDE"
Handoff [5] says "기본값 default는 CLAUDE 패밀리." But main.ts L1079-1083 defaults to `null` (which uses `_min`). This conflict must be resolved. The handoff is the spec, so main.ts needs updating.

---

## 5. Missing Acceptance Criteria

### AC1: `auth refresh` command
```
GIVEN: 5 accounts exist with stale quota_cache (cached_at > 5h ago)
WHEN:  agcl auth refresh
THEN:  All 5 accounts have fresh quota_cache
  AND: Output shows the same table format as auth list
  AND: Wake-up candidates are identified and displayed
  AND: Command exits 0
```

### AC2: `auth list` lightweight mode
```
GIVEN: 5 accounts exist, 3 have fresh cards (< 1h old), 2 have stale cards (> 5h old)
WHEN:  agcl auth list
THEN:  3 fresh accounts display from cached cards (no network)
  AND: 2 stale accounts are selectively refreshed
  AND: Total wall time < 3 seconds for the display
```

### AC3: Account card has all required fields
```
GIVEN: agcl auth refresh completes
THEN:  Each AccountDetail.quota_cache has:
  - subscription_tier: string | null
  - families: Record<string, AccountQuotaFamilyCache>
  - fetch_error: string | null
  - cached_at: number (Unix seconds)
AND: Each AccountDetail.rotation has:
  - family_buckets: Record<string, string | null> (bucket keys)
  - last_rotated_at: number | null
AND: Each AccountDetail.wakeup_history has:
  - last_attempt_at: number | null
  - last_result: string | null
  - attempt_count: number
```

### AC4: Wake-up identifies 5h cycle not-started accounts
```
GIVEN: Account A has all-null families, Account B has non-null families
WHEN:  filterWakeupCandidates_func is called
THEN:  Account A is a candidate, Account B is not
```
(Note: This already passes in `wakeup.test.ts` W-1)

### AC5: Post-response rotate pipeline
```
GIVEN: Current account starts turn at 73% (bucket=null)
  AND: Turn ends with fresh read showing 64% (bucket='70')
WHEN:  decideAndPersistAutoRotate_func runs post-response
THEN:  pendingSwitch is generated with best candidate
  AND:  Account card's family_buckets is updated to '70'
```
(Note: This already passes in `rotate.test.ts` R-1)

### AC6: Bucket persistence prevents repeat rotate
```
GIVEN: Account card has family_buckets.GEMINI = '70'
  AND: Current read shows 64% (still in '70' bucket)
WHEN:  decideAutoRotate_func runs
THEN:  pendingSwitch is null (no repeat)
```
(Note: This already passes in `rotate.test.ts` R-2)

### AC7: Switch records in pending-switch.json without tokens
```
GIVEN: Rotate decides to switch from acc-1 to acc-2
WHEN:  Switch is performed
THEN:  pending-switch.json exists with target_account_id, source_account_id, reason, decided_at
  AND:  File does NOT contain access_token or refresh_token
  AND:  File is readable (not chmod 0600 — it has no secrets)
```

### AC8: Pro ≤20% forbidden, Ultra ≤10% lowest priority
```
GIVEN: Candidate pool has Pro at 18%, Ultra at 8%, Pro at 60%
WHEN:  Candidates are ranked
THEN:  Pro 18% is excluded (below 20% threshold)
  AND:  Pro 60% is first candidate
  AND:  Ultra 8% is last candidate (lowest priority)
```

### AC9: Reset time elapsed → 99% display
```
GIVEN: Account card shows reset_time = "2025-01-01T00:00:00Z" (in the past)
WHEN:  agcl auth list renders
THEN:  Progress bar shows "██████████ 99%"
```
(Note: This already passes — `authList.ts` L110-111)

### AC10: effectiveFamily defaults to CLAUDE
```
GIVEN: No --model flag, model is null/undefined
WHEN:  Rotation evaluates effectiveFamily
THEN:  effectiveFamily = 'CLAUDE' (not null, not '_min')
```

---

## 6. Edge Cases Not Addressed

### E1: Single account — no candidates
If there's only one account, rotate should be a no-op. Current code handles this (returns warning "No eligible account"). But the plan should explicitly test this case.

### E2: All accounts forbidden/disabled
If every account is forbidden, `auth refresh` should still complete (updating all cards) but wake-up should not be attempted. Output should show all accounts with FORBIDDEN status.

### E3: Concurrent CLI invocations
Two `agcl` processes running simultaneously could both decide to rotate. The `pending-switch.json` is a single file — last writer wins. This is acceptable (both chose the same target), but should be documented.

### E4: Account card is corrupted
`readAccountDetailSync_func` returns `null` for corrupted files. The plan should handle this gracefully — treat as "no card exists" and refresh.

### E5: Wake-up during `auth refresh` — should it be async or sync?
The handoff says "background wake-up" but `auth refresh` is a foreground command. Should:
- `auth refresh` wait for all wake-ups to complete? (Slow, defeats purpose)
- `auth refresh` fire-and-forget wake-ups? (User may close terminal before they finish)
- `auth refresh` start wake-ups and show progress? (Best UX, but complex)

### E6: 5h stale threshold vs 60s cache TTL
The handoff says accounts with "cached_at > 5h" should be refreshed by `auth list`. But `quotaClient.ts` has a 60s TTL. These are different thresholds:
- 60s: "don't hit network twice in a minute" (performance)
- 5h: "this data is too old to trust" (correctness)

The plan needs both: `auth refresh` ignores the 60s TTL and forces network. `auth list` uses the 5h threshold for selective refresh.

### E7: What if the target account has no token?
During switch, if `accounts/<target-id>.json` exists but has an expired/missing token, the switch should fail gracefully, not corrupt the state.vscdb.

---

## 7. Ambiguities in the Handoff Document

### Ambiguity 1: "auth list is lightweight" but also "selectively refreshes stale accounts"
The handoff says auth list shows cached cards, then refreshes stale ones. This means auth list CAN be slow for stale accounts. The plan should specify:
- `auth list`: instant display of cached cards, THEN async refresh of stale ones (update display? or just flag?)
- Or: `auth list`: display cached cards + flag which are stale, don't refresh at all

### Ambiguity 2: "pending-switch.json is applied record, not pending intent"
The handoff [9] says "지금 이 계정으로 이미 바꿨다" but the file is NAMED `pending-switch.json`. The current code in `rotate.ts` names it `pending-switch.json` and saves a `PendingSwitchIntent`. This naming is confusing if it's actually an "applied record." Consider renaming to `last-switch.json` or `applied-switch.json` in v0.3.0.

### Ambiguity 3: Wake-up mechanism is undefined
The handoff describes WHEN to wake up but not HOW. The actual mechanism (open Antigravity app → poll state.vscdb → extract tokens → update card) is completely unspecified. This is the most complex piece and needs explicit design.

### Ambiguity 4: "background" vs "foreground" for pre-prompt tasks
The handoff says "background quick check" and "background wake-up" during pre-prompt. But in a CLI tool, "background" means either:
- A child process that outlives the parent (complex)
- Promise-based concurrency within the same process (simpler)
- The main flow continues while these tasks run in parallel (most likely)

The plan should specify: these are in-process async operations that run concurrently with the main chat flow, not separate processes.

### Ambiguity 5: What does "switch" update?
The handoff says switch includes "fingerprint_id, serviceMachineId." But:
- Where do these come from? The target account's `AccountDetail.fingerprint_id`?
- Does switch also update `storage.serviceMachineId` in state.vscdb?
- Does switch update `accounts.json` current_account_id?

---

## Directives for Prometheus

### Core Directives
- MUST: Read all 6 existing service files (`rotate.ts`, `wakeup.ts`, `accounts.ts`, `quotaClient.ts`, `authList.ts`, `authInject.ts`) and their tests before writing any task
- MUST: Classify each feature as "extend existing" or "build new" based on the gap analysis above
- MUST: Resolve the 90% bucket reset conflict (handoff says remove, code has it, test R-9 tests it)
- MUST: Resolve the effectiveFamily default conflict (handoff says CLAUDE, code says null/_min)
- MUST NOT: Rewrite `rotate.ts` — it's already correct and tested
- MUST NOT: Rewrite `wakeup.ts` — filter logic is correct, only execution path is missing
- MUST NOT: Include Offline-Gateway in v0.3.0 scope
- MUST NOT: Implement mid-session account switching
- PATTERN: Follow `writeJsonAtomic0600_func` pattern for all file writes (from `accounts.ts`)
- PATTERN: Follow `_func` naming convention for all helper functions
- PATTERN: Follow existing test file naming: `<module>.test.ts` alongside `<module>.ts`

### QA/Acceptance Criteria Directives
- MUST: Every new function has a test in the corresponding `.test.ts` file
- MUST: `bun test` passes all existing 181+ tests PLUS new tests
- MUST: `agcl auth refresh` exits 0 when network is available
- MUST: `agcl auth list` completes in < 1 second with cached data
- MUST: pending-switch.json never contains access_token or refresh_token
- MUST NOT: Create acceptance criteria requiring "user manually tests..."
- MUST NOT: Create acceptance criteria requiring "user visually confirms..."

### Task Sequencing Directives
- Phase 1 (TDD foundation): AccountCard population, auth refresh command, auth list lightweight
- Phase 2 (Orchestration): Wake-up execution, pre-prompt background tasks
- Phase 3 (Pipeline): Post-response rotate, switch execution, pending-switch.json extension
- Phase 4 (Integration): End-to-end test with multiple accounts

---

## Intent Classification
**Type**: Build from Scratch (with significant existing scaffolding)
**Confidence**: High
**Rationale**: The features are well-defined, existing code is substantial, and the gap is primarily wiring and specific missing pieces (auth refresh command, wake-up execution, effectiveFamily default fix).

## Pre-Analysis Findings
- 6 of 10 features have significant existing code (rotate.ts, wakeup.ts, accounts.ts fields)
- The handoff's "code gaps" section is partially inaccurate — implementors might rebuild existing code
- Two conflicts need resolution: 90% bucket reset and effectiveFamily default
- The wake-up execution mechanism (HOW to wake up) is completely undefined in the handoff
- The "switch" mechanism is the largest missing piece

## Questions for User
1. Should the 90% bucket reset stay (current code) or go (handoff says remove)?
2. Should effectiveFamily default to CLAUDE (handoff) or null/_min (current code)?
3. What is the actual wake-up mechanism? (Open Antigravity app → poll state.vscdb → ???)
4. Should auth list display stale-flagged cards immediately, or wait for selective refresh?
5. Is v0.3.0 switch "apply for next invocation" or "seamless mid-session"?

## Identified Risks
- **Wake-up mechanism undefined**: Largest risk. The handoff describes timing but not implementation. Mitigation: Define a concrete mechanism before planning.
- **Handoff-code conflicts**: Two explicit conflicts could cause rework. Mitigation: Resolve before task creation.
- **Scope creep via "seamless switch"**: The handoff implies immediate switch but current code returns 'unsupported'. Mitigation: Explicitly scope to "next invocation" switch.
- **Auth list speed regression**: If selective refresh is too aggressive, auth list becomes slow again. Mitigation: Hard cap on number of accounts refreshed.

## Recommended Approach
1. Resolve the 2 conflicts (90% reset, effectiveFamily) with the user
2. Define the wake-up execution mechanism
3. Plan as "extend existing modules" with 4 phases, TDD-first
4. Atomic commits: one feature per commit, tests before implementation
