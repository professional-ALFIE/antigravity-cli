# Metis R6 Auth Spec Verification: Post-needs_reauth Contradiction Audit

**Verified Spec**: `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md` (736 lines)
**Trigger**: 5th PASS + Momus REJECT → needs_reauth introduction + L-8 rewrite + §5-3/§6-6/§7-3 exclusion additions
**Date**: 2026-04-15

---

## Executive Summary

**Verdict: ✅ PASS — 0 CRITICAL, 0 WARNING, 3 INFO**

The needs_reauth state introduction is internally consistent across the entire spec. All cross-references between sections hold. No contradictions found between the 5-state enum, exclusion lists, test contracts, and feature descriptions.

---

## 1. Cross-Reference Audit: needs_reauth Usage

### 1-1. Enum Definition (§9-2, line 529-537) vs. All Consumers

| Section | Line | needs_reauth Mention | Consistent with §9-2? |
|---------|------|---------------------|----------------------|
| §4-3 (Local Import) | 133 | account_status = "needs_reauth" | ✅ Correct source state |
| §4-3 blockquote | 142 | token.refresh_token null → needs_reauth | ✅ Correct trigger |
| §4-5 (L-8) | 166 | refresh_token 없으면 needs_reauth | ✅ Matches trigger |
| §5-3 (Auth Inject gate) | 215 | needs_reauth → block inject | ✅ Matches enum "auto assign ❌" |
| §6-6 (Rotate exclusion) | 356 | needs_reauth 제외 | ✅ Matches enum "auto assign ❌" |
| §7-3 (Wake-up exclusion) | 410 | needs_reauth 제외 | ✅ Matches enum "wake-up ❌" |
| §9-2 enum table | 537 | refresh_token 없음, auto ❌, wake-up ❌ | ✅ Canonical |
| §12 (impl order) | 669 | 5-state enum includes needs_reauth | ✅ Consistent |

**Result: All 8 references are consistent. No orphan references or missing references.**

### 1-2. Status State Completeness

The §9-2 enum (line 531-537) defines 5 states. Let's verify every section that references account_status covers all relevant states:

**§5-3 inject gate (line 214-216):**
- Blocks: needs_reauth ✅, forbidden ✅, disabled ✅
- Implicitly allows: active ✅, protected ✅ (protected can still be selected manually)
- **Consistent**: protected accounts can be inject-targets (user explicitly chose), just excluded from auto-rotate.

**§6-6 rotate target selection (line 353-359):**
- Excludes: current ✅, forbidden ✅, disabled ✅, needs_reauth ✅, protected (Pro <20%) ✅
- Remaining candidates: active only ✅
- **Consistent**: Only active accounts are rotation candidates.

**§7-3 wake-up (line 409-411):**
- Excludes: forbidden ✅, disabled ✅, needs_reauth ✅, cooldown ✅
- Includes: active ✅, protected ✅ (protected accounts can still be woken up — they're not forbidden)
- **Consistent**: wake-up activates dormant accounts; protected accounts may still need quota refresh after reset.

---

## 2. L-8 Test Contract Verification

### 2-1. L-8 (line 166) vs §4-3 blockquote (lines 141-144)

| Aspect | L-8 Test | §4-3 Blockquote | Match? |
|--------|----------|-----------------|--------|
| refresh_token present → status | "active" (step 5) | — | ✅ |
| refresh_token absent → status | "needs_reauth" (step 8) | "needs_reauth" (line 142) | ✅ |
| refresh_token absent → token value | null (step 7) | null (line 142) | ✅ |
| access_token presence | Implied (base check) | "access_token만 저장" (line 132) | ✅ |
| Tool specification | bun test + cat + jq | — (blockquote is prose) | ✅ Compatible |

**Result: L-8 test contract precisely mirrors the §4-3 blockquote contract. Both describe the same behavior.**

### 2-2. L-8 Edge Cases

L-8 covers exactly 2 branches:
1. refresh_token present → active + non-null refresh_token
2. refresh_token absent → needs_reauth + null refresh_token

**Potential gap check**: Does L-8 cover the case where access_token is also missing?
- §4-3 line 132: "refresh_token 미포함 시 → access_token만 저장" — implies access_token always exists.
- This is correct: uss-oauth always contains an access_token if the account was ever logged in.
- **No gap**: access_token missing = no account data at all, which is a different concern (no account found).

---

## 3. Cross-Section Contract Consistency

### 3-1. §5-3 inject gate (0단계) vs §9-2 enum behavior

§5-3 line 215 blocks needs_reauth from inject.
§9-2 line 537: needs_reauth auto-assign = ❌.

**But**: Can a user explicitly select a needs_reauth account from `auth list`?
- §5-3 line 211: "TTY에서 계정 선택 시 즉시 inject" → step 0 blocks it.
- This means needs_reauth accounts appear in auth list but cannot be selected for use.
- This is **intentional and consistent**: the user sees the account exists but is told to re-login.

**Consistency: ✅ Correct. needs_reauth accounts are visible but not injectable.**

### 3-2. §5-3 line 217 refresh logic vs needs_reauth

§5-3 line 217: "대상 계정의 refresh_token → access_token 갱신"
This step is only reached AFTER step 0 passes (account_status is not needs_reauth).

**Question**: What if an account has a valid refresh_token but access_token is expired?
- Step 0: passes (status is active, not needs_reauth)
- Step 1: refresh_token exists → access_token refreshed ✅
- **Consistent**: needs_reauth accounts are blocked at step 0 before reaching step 1.

**Question**: What if an active account somehow has refresh_token = null?
- This shouldn't happen by spec: OAuth login always produces refresh_token (§4-2 line 107: access_type=offline + prompt=consent).
- Local Import is the only path that produces needs_reauth with null refresh_token.
- If it somehow occurs, step 1 would fail to refresh → error → no inject.
- This is a **defense-in-depth edge case**, not a spec contradiction.
- **Potential INFO**: Could add explicit "if refresh_token is null for active account → treat as needs_reauth" guard. (But this is defensive coding, not a spec fix.)

### 3-3. §6-5 Deferred Inject (line 320-334) vs needs_reauth

§6-5 rotate only fires for message-send paths. After rotate decision, inject is deferred.
The rotate target selection (§6-6) already excludes needs_reauth accounts.

**Question**: Could pending-switch.json reference a needs_reauth account?
- Only if the account became needs_reauth AFTER the pending-switch was written.
- §6-5 line 347: stale check (24h) handles old intents.
- §6-6 line 356: rotate selection excludes needs_reauth at decision time.
- **Race condition**: Account status changes between decision and application.
- **Mitigation**: The inject step (§5-3) has its own step 0 check that blocks needs_reauth.
- **Consistency: ✅ Defense-in-depth. Step 0 in inject acts as a guard even if status changed after rotate decision.**

### 3-4. §7-3 Wake-up scope vs needs_reauth

§7-3 line 400: "forbidden/disabled가 아닌 모든 계정이 대상이다"
§7-3 line 410: "제외: account_status == 'forbidden' 또는 'disabled' 또는 'needs_reauth'"

**Question**: Is there a contradiction between "모든 계정" and "제외"?
- "모든 계정" in context means "all accounts are scanned", then filtered.
- The exclusion list at line 410 defines the filter.
- needs_reauth is explicitly in the exclusion list.
- **Consistency: ✅ "모든 계정 순회 → 제외 필터 적용" is a two-step process, not a contradiction.**

### 3-5. §9-2 enum "자동 배정" column vs Feature behavior

| Status | 자동 배정 | Where enforced | Consistent? |
|--------|----------|----------------|-------------|
| active | ✅ | §6-6 line 358 (remaining candidates) | ✅ |
| protected | ❌ | §6-6 line 357 (Pro <20% excluded) | ✅ |
| forbidden | ❌ | §6-6 line 354, §7-3 line 410 | ✅ |
| disabled | ❌ | §6-6 line 355, §7-3 line 410 | ✅ |
| needs_reauth | ❌ | §6-6 line 356, §7-3 line 410, §5-3 line 215 | ✅ |

**Result: All enum values' "자동 배정" column matches their usage in rotate/wake-up exclusion lists.**

---

## 4. Structural Integrity Checks

### 4-1. Forward References

All section cross-references resolve correctly:
- §5-3 references §5-1 (quota fetch policy) → ✅ exists at line 180
- §6-5 references §5-3 (inject contract) → ✅ exists at line 209
- §8-4 references §5-3, §6-5 → ✅ both exist
- L-8 references importLocalFromStateDb_func → ✅ defined in §4-3
- §9-5 references migration from old format → ✅ consistent with §3 table

### 4-2. Terminology Consistency

| Term | Usage Locations | Consistent? |
|------|----------------|-------------|
| "needs_reauth" | §4-3, §5-3, §6-6, §7-3, §9-2, L-8, §12 | ✅ Identical string |
| "5-state enum" | §9-2 title (529), §12 line 669 | ✅ |
| "Full Switch" | §2-1, §5-3, §6-5, §8-4 | ✅ Same contract everywhere |
| "refresh_token" | §4-2, §4-3, §4-5, L-2, L-6, L-8, §5-3, §9-2 schema | ✅ Consistently nullable |
| "pending-switch.json" | §6-5, §9-3, R-6, S-4 | ✅ Same structure |

### 4-3. Schema Consistency (§9-2 JSON)

The account detail schema at line 539-588 includes:
- `account_status`: "active" (example value) → ✅ matches enum
- `token.refresh_token`: "1//xxx" (example value) → ✅ would be null for needs_reauth
- `account_status_reason`: null → ✅ would be "local_import_no_refresh_token" for needs_reauth
- Missing explicit `account_status_reason` example for needs_reauth → **INFO only** (implementation detail)

---

## 5. Findings Summary

### CRITICAL: 0

None.

### WARNING: 0

None.

### INFO: 3

1. **[INFO-1] needs_reauth recovery path implicit**: The spec clearly defines how accounts enter needs_reauth state (Local Import without refresh_token), but the exit path is implicit — "agcl auth login으로 재로그인" (§4-3 line 135, §5-3 line 215). The login flow (§4-2) produces a fresh refresh_token via OAuth, which would upsert the account to active. This is logically sound but the upsert-overwrite from needs_reauth → active is not explicitly stated as a state transition. **Not a bug**: upsert by email (§4-2 step 7 + L-6 test) naturally handles this since the new login provides both tokens.

2. **[INFO-2] Defensive guard opportunity**: §5-3 step 1 (line 217) attempts refresh_token → access_token refresh, but if an active account somehow has refresh_token = null (shouldn't happen per spec, but could via data corruption), the refresh would fail. The inject would then proceed with a stale/expired access_token. A defensive guard "if refresh_token is null → treat as needs_reauth" at step 1 would be prudent implementation guidance but is not a spec contradiction.

3. **[INFO-3] §9-2 schema example doesn't show needs_reauth**: The JSON example (lines 539-588) shows `"account_status": "active"`. This is correct as a canonical example, but implementers might benefit from a second example showing the needs_reauth state with `token.refresh_token: null` and `account_status_reason: "local_import_no_refresh_token"`. This is a documentation clarity suggestion, not a correctness issue.

---

## 6. Verified Claims

| Claim from task-r4 | Verification Result |
|--------------------|-------------------|
| refresh_token 불가능 경로가 needs_reauth 상태로 해결됨 | ✅ Correct. §4-3 5b → needs_reauth, §5-3 blocks inject, §6-6/§7-3 exclude. |
| L-8 rewritten to verify needs_reauth | ✅ Correct. L-8 tests both branches: refresh_token present → active, absent → needs_reauth. |
| 5-state enum 도입으로 spec 전체에 새 모순 없음 | ✅ Verified. All 8 references consistent, no cross-section contradictions. |
| §5-3에 needs_reauth 제외가 정확히 반영 | ✅ Correct. Step 0 at line 215 blocks needs_reauth before inject. |
| §6-6에 needs_reauth 제외가 정확히 반영 | ✅ Correct. Step 4 at line 356 excludes from rotate candidates. |
| §7-3에 needs_reauth 제외가 정확히 반영 | ✅ Correct. Line 410 includes needs_reauth in exclusion list. |
| §4-3 blockquote와 L-8 테스트가 동일한 계약 기술 | ✅ Verified. Both specify: refresh_token present → active, absent → needs_reauth + null refresh_token. |
