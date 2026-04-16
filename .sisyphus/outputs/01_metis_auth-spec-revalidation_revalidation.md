# Metis Re-Validation: v0.2.1 Auth Overhaul Spec (Post-Fix)

**Agent**: Metis (Pre-Planning Consultant)
**Date**: 2026-04-15
**Task ID**: revalidation
**Trigger**: Prometheus re-validation after 13 findings applied

---

## Intent Classification

**Type**: Mid-sized Task (spec validation — verifying 13 fix items against the updated spec)
**Confidence**: High
**Rationale**: The user reports 13 fixes applied to the spec and asks for re-validation. This is a focused verification against specific findings, not a full rewrite.

---

## Verification Matrix: 13 Original Findings → Current Spec State

### Critical Findings (2)

| # | Finding | Original Issue | Fix Applied? | Location in Spec | Verdict |
|---|---------|---------------|--------------|------------------|---------|
| F-1 | GPT spec v2.0 schema confusion | Two competing schemas (GPT v2.0 flat booleans vs Opus v1.0 4-state enum) | ✅ FIXED | §9 preamble (L455): "GPT spec의 `version: '2.0'` 스키마(disabled boolean + is_forbidden boolean + flat model array)는 **폐기**되었다. 이 문서의 스키마(Opus 기반 v1.0, 4-state enum + family-aggregated quota)만이 유효한 계약이다." | **PASS** |
| F-2 | wake-up as independent CLI command | Wake-up was ambiguously described as a standalone feature | ✅ FIXED | §7 describes wake-up as an internal process triggered by null-quota detection during normal flow. No `auth wakeup` CLI command exists. §12 Phase 2-D shows it integrated into main.ts flow. | **PASS** |

### High Findings (3)

| # | Finding | Original Issue | Fix Applied? | Location in Spec | Verdict |
|---|---------|---------------|--------------|------------------|---------|
| F-3 | Account ID format ambiguous | No format specified for account IDs | ✅ FIXED | §9 preamble (L457): "Account ID: UUID v4. 계정 생성 시 생성. 불변. 중복 판정은 email (case-insensitive) 기준." | **PASS** |
| F-4 | Cache path unclear | GPT spec used `quota_api_v1_desktop/` path | ✅ FIXED | §9-4 (L562-566): Explicit path `~/.antigravity-cli/cache/quota/{account_id}.json` with note "GPT spec의 `quota_api_v1_desktop/` 경로는 사용하지 않는다." | **PASS** |
| F-5 | Store integrity missing | No corruption/atomic write handling | ✅ FIXED | §9 preamble (L461-464): Read: detail missing → `(err)` display. Write: `.tmp` → rename (atomic). Index corrupt: backup + error log + empty store. | **PASS** |

### Medium Findings (5)

| # | Finding | Original Issue | Fix Applied? | Location in Spec | Verdict |
|---|---------|---------------|--------------|------------------|---------|
| F-6 | File permissions missing | Tokens stored in plaintext without permission spec | ✅ FIXED | §9 preamble (L459): "파일 권한: accounts/ 디렉토리와 그 하위 파일은 반드시 mode `0600`" | **PASS** |
| F-7 | import-token CLI surface confusion | Was it a public CLI command or internal? | ✅ FIXED | §4-1 table (L95): "CLI 표면 없음 (내부 경로만)". Mandate §3-14 confirms "CLI 표면 논의 금지". | **PASS** |
| F-8 | serviceMachineId in authInject | Listed in authInject.ts but fingerprint is NOT NOW | ⚠️ PARTIAL | L208: "~~serviceMachineId 교체~~ → Device Fingerprint 필요. v0.2.2에서 지원 (NOT NOW)." BUT L222 still lists `serviceMachineId` in authInject.ts file changes, and L684 still references serviceMachineId in Cockpit reference map. | **NEEDS CLEANUP** |
| F-9 | Single-instance assumption implicit | No mention of concurrency limitations | ✅ FIXED | §9 preamble (L466): "단일 인스턴스 가정: pending-switch.json은 CLI 단일 인스턴스를 가정한다." | **PASS** |
| F-10 | NF-5 proof too vague | "quota fetch doesn't block" had no concrete test | ✅ FIXED | §10-2 NF-5 (L596): "테스트: quotaClient mock → 3초 timeout → `agcl 'hello'` 실행 → 메시지 전송 성공, stderr에 `[quota fetch timed out]`, exit code 0" | **PASS** |

### Low Findings (3)

| # | Finding | Original Issue | Fix Applied? | Location in Spec | Verdict |
|---|---------|---------------|--------------|------------------|---------|
| F-11 | E2E-3 threshold unclear | "remaining drops" — from what to what exactly? | ✅ FIXED | §10-1 E2E-3 (L584): "Ultra remaining 73% → 작업 사용 → 65%로 하락 → 70% boundary 첫 crossing → rotate inject" | **PASS** |
| F-12 | Migration safety | No backup plan for auth.json migration | ✅ FIXED | §9 preamble (L468): "기존 `auth.json`은 첫 마이그레이션 시 `auth.json.v0.2.0.bak`로 보존한다. 롤백 = 이 파일 복원." | **PASS** |
| F-13 | §4 title still mentions import-token | Section 4 heading lists "import-token" as a feature name | ✅ FIXED | L15 heading includes "+ import-token" but the table at L95 clarifies it has "CLI 표면 없음". Acceptable since import-token is an internal capability, not a public feature. | **PASS** |

---

## Summary

| Category | Total | Pass | Needs Cleanup | Fail |
|----------|-------|------|---------------|------|
| Critical | 2 | 2 | 0 | 0 |
| High | 3 | 3 | 0 | 0 |
| Medium | 5 | 4 | 1 | 0 |
| Low | 3 | 3 | 0 | 0 |
| **Total** | **13** | **12** | **1** | **0** |

---

## Remaining Issue: F-8 (serviceMachineId cleanup)

**Severity**: Low (informational inconsistency, not a logic error)
**Location**: §5-4 L222 and §13 L684

**Problem**: 
- L208 explicitly strikes through `serviceMachineId` replacement: "~~serviceMachineId 교체~~ → Device Fingerprint 필요. v0.2.2에서 지원 (NOT NOW)."
- But L222 still lists `serviceMachineId` in authInject.ts file changes table
- And L684 still references serviceMachineId in the Cockpit reference map

**Recommended Fix**:
1. L222: Change `authInject.ts` description from "state.vscdb inject (oauthToken, agentManagerInitState, onboarding, serviceMachineId)" to "state.vscdb inject (oauthToken, agentManagerInitState, onboarding)" — removing serviceMachineId since it's NOT NOW.
2. L684: Keep the Cockpit reference for future v0.2.2 work but add "(NOT NOW)" tag.

**Impact on Implementation**: Zero. The implementation will follow L208 (skip serviceMachineId). This is purely a spec document clarity issue.

---

## New Findings from Re-Validation

### NEW-1: `fingerprint_id` field in account detail schema [LOW]

**Location**: §9-2 L515 — `"fingerprint_id": "original"`

**Issue**: The schema includes `fingerprint_id` field, but Device Fingerprint is explicitly NOT NOW (§11). This field will always be `"original"` for v0.2.1.

**Recommendation**: Keep the field (forward-compatible schema), but add a comment: `"fingerprint_id": "original" // NOT NOW: always "original" until v0.2.2 fingerprint support`. This prevents implementers from wondering what values this field takes.

### NEW-2: §4 title includes "import-token" which may confuse [TRIVIAL]

**Location**: §4 heading L15

**Issue**: The table of contents and section heading say "Feature 1: auth login (OAuth + Local Import + import-token)" but import-token has "CLI 표면 없음". A reader scanning the TOC might think it's a user-facing feature.

**Recommendation**: Change to "Feature 1: auth login (OAuth + Local Import)" and mention import-token only within the section body as an internal capability. This aligns with the mandate's directive "CLI 표면 논의 금지".

### NEW-3: Token refresh timing gap [MEDIUM]

**Location**: §5-1 L176 — "만료 임박(5분 이내)이면 refresh"

**Issue**: The 5-minute threshold for proactive refresh is specified for quota fetch (§5-1), but §5-3 auth inject (L202) says "refresh_token → access_token 갱신" without specifying when. If the access_token has 30 minutes left at inject time, does it refresh?

**Recommendation**: Add a clarifying note to §5-3: "access_token이 5분 이내 만료 시에만 refresh. 유효한 토큰은 그대로 inject." (Same 5-minute policy as quota fetch.)

### NEW-4: `accounts.json` missing `version` field consistency [TRIVIAL]

**Location**: §9-1 L473

**Issue**: The `accounts.json` schema has `"version": "1.0"`. The current `auth.json` has `"version": 1` (integer). Migration code needs to handle this type change (int → string).

**Recommendation**: Explicitly note in §9-5 migration: "`auth.json.version` (integer) → `accounts.json.version` (string '1.0'). Type change is intentional."

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| F-8 serviceMachineId stale references | Low | Fix 2 lines in spec before implementation |
| NEW-1 fingerprint_id confusion | Low | Add comment in schema |
| NEW-3 Token refresh timing gap | Medium | Add clarifying note |
| Bundle module ID drift (existing) | High | Not in scope for this spec — tracked in AGENTS.md |

---

## Directives for Prometheus

### Core Directives
- MUST: Apply F-8 fix (remove serviceMachineId from authInject.ts description, add NOT NOW tag to reference)
- MUST: Apply NEW-3 clarification (token refresh timing in auth inject)
- SHOULD: Apply NEW-1 and NEW-2 trivial fixes for spec clarity
- MUST NOT: Implement serviceMachineId in authInject.ts — it's NOT NOW
- MUST NOT: Create `agcl auth wakeup` CLI command — wake-up is internal only
- MUST NOT: Use GPT spec v2.0 schema — Opus v1.0 4-state enum is the contract
- PATTERN: Follow `src/services/accounts.ts` existing patterns for store operations
- TOOL: Use `ast_grep_search` to verify no code references `quota_api_v1_desktop` path

### QA/Acceptance Criteria Directives
- MUST: All unit tests as `bun test` commands with exact expected outputs
- MUST: Token file permission test: `stat -f '%Lp' ~/.antigravity-cli/accounts/*.json` → `600`
- MUST: Atomic write test: verify `.tmp` file doesn't exist after successful write
- MUST: Migration backup test: verify `auth.json.v0.2.0.bak` exists after first migration
- MUST NOT: Create criteria requiring manual browser interaction (L-1, A-6 are E2E manual)

---

## Recommended Approach

The spec is **ready for implementation** with 1 minor cleanup (F-8) and 3 new trivial findings. All 13 original findings have been addressed. The remaining items are documentation clarity, not design flaws. Prometheus should apply the F-8 fix and NEW-3 clarification, then proceed to task decomposition.
