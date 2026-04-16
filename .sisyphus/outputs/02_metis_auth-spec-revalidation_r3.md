# Metis 3rd Round Re-Validation: v0.2.1 Auth Overhaul Spec

**Agent**: Metis (Pre-Planning Consultant)  
**Date**: 2026-04-15  
**Task**: r3 — Final verification after 2nd round fixes  
**Subject**: `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md` (704 lines)

---

## Executive Summary

**Verdict: ✅ PASS — Spec is ready for implementation.**

All 13 original findings (F-1~F-13) from round 1 have been fully resolved.  
All 4 new findings (NEW-1~4) from round 2 have been fully resolved.  
**Zero new issues found** in this 3rd round.

| Round | Total Findings | Status |
|-------|---------------|--------|
| Round 1 (initial) | 13 findings (F-1~F-13) | All PASS |
| Round 2 (re-validation) | 1 partial (F-8) + 4 new (NEW-1~4) | All PASS |
| **Round 3 (this)** | **0 new findings** | **✅ ALL CLEAR** |

---

## Verification Matrix: Original 13 Findings

| # | Finding | Severity | R1 Status | R2 Status | R3 Status | Evidence in Current Spec |
|---|---------|----------|-----------|-----------|-----------|--------------------------|
| F-1 | GPT v2.0 schema superseded note | 🔴 Critical | ✅ PASS | ✅ PASS | ✅ PASS | §9 preamble (L463): explicit "폐기" declaration. Clear. |
| F-2 | Wake-up CLI surface | 🔴 Critical | ✅ PASS | ✅ PASS | ✅ PASS | §7 internal process only. No CLI command. §12 integrates into main.ts flow. |
| F-3 | Account ID format (UUID v4) | 🟡 High | ✅ PASS | ✅ PASS | ✅ PASS | §9 preamble (L465): "UUID v4. 계정 생성 시 생성. 불변." |
| F-4 | Cache path authoritative | 🟡 High | ✅ PASS | ✅ PASS | ✅ PASS | §9-4 (L572): `~/.antigravity-cli/cache/quota/{account_id}.json`. GPT path explicitly excluded. |
| F-5 | Store integrity (corrupt/atomic) | 🟡 High | ✅ PASS | ✅ PASS | ✅ PASS | §9 preamble (L469-472): read tolerance, atomic write (.tmp→rename), corrupt index handling. |
| F-6 | File permissions (0600) | 🔵 Medium | ✅ PASS | ✅ PASS | ✅ PASS | §9 preamble (L467): "mode 0600 (소유자만 읽기/쓰기)". |
| F-7 | import-token CLI surface | 🔵 Medium | ✅ PASS | ✅ PASS | ✅ PASS | §4-1 L95: "CLI 표면 없음 (내부 경로만)". |
| F-8 | serviceMachineId cleanup | 🔵 Medium | ⚠️ PARTIAL | ✅ PASS | ✅ PASS | §5-3 L208: strikethrough + NOT NOW. §5-4 L224: authInject.ts description no longer lists serviceMachineId (only "oauthToken, agentManagerInitState, onboarding"). §13 L693: "(NOT NOW (v0.2.2+))" tag added. |
| F-9 | Single-instance assumption | 🔵 Medium | ✅ PASS | ✅ PASS | ✅ PASS | §9 preamble (L474): "단일 인스턴스 가정". |
| F-10 | NF-5 concrete proof | 🔵 Medium | ✅ PASS | ✅ PASS | ✅ PASS | §10-2 NF-5 (L605): concrete mock scenario with stderr + exit code expectations. |
| F-11 | E2E-3 threshold data | ⚪ Low | ✅ PASS | ✅ PASS | ✅ PASS | §10-1 E2E-3 (L593): "73% → 65% → 70% boundary 첫 crossing". |
| F-12 | Migration backup | ⚪ Low | ✅ PASS | ✅ PASS | ✅ PASS | §9 preamble (L476): "auth.json.v0.2.0.bak로 보존". §9-5 L579: explicit migration safety. |
| F-13 | §4 TOC import-token | ⚪ Low | ✅ PASS | ✅ PASS | ✅ PASS | §4 heading L15: now "Feature 1: auth login (OAuth + Local Import)". import-token removed from heading. Only referenced internally at L95. |

---

## Verification Matrix: Round 2 New Findings

| # | Finding | Severity | R2 Status | R3 Status | Evidence in Current Spec |
|---|---------|----------|-----------|-----------|--------------------------|
| NEW-1 | fingerprint_id field comment | ⚪ Low | NEEDS FIX | ✅ PASS | §9-2 L523: `"fingerprint_id": "original", // NOT NOW: 항상 "original". v0.2.2 fingerprint 지원 전까지 변경 없음`. Inline comment added. |
| NEW-2 | §4 heading import-token removal | ⚪ Trivial | NEEDS FIX | ✅ PASS | L15 TOC: "Feature 1: auth login (OAuth + Local Import)". "import-token" removed from TOC entry. |
| NEW-3 | Token refresh timing in §5-3 | 🔵 Medium | NEEDS FIX | ✅ PASS | §5-3 L202: "access_token이 5분 이내 만료 시에만 refresh. 유효한 토큰은 그대로 inject. quota fetch §5-1과 동일한 5분 정책". Explicit policy added. |
| NEW-4 | version type change in migration | ⚪ Trivial | NEEDS FIX | ✅ PASS | §9-5 L579: "auth.json.version (integer, 예: 1) → accounts.json.version (string, 예: '1.0'). 타입 변경 의도적." |

---

## Cross-Section Consistency Checks (New for R3)

### Switch Contract Consistency (§5-3 vs §6-5 vs §8-4)

| Section | Contract Statement | Consistent? |
|---------|-------------------|-------------|
| §5-3 L214-217 | Full Switch Default block: "inject는 state.vscdb에 쓴다. LS kill/respawn은 하지 않는다." | ✅ |
| §6-5 L318 | "auth inject (Full Switch 경로, §5-3과 동일 계약: state.vscdb 쓰기만, LS kill/respawn 없음)" | ✅ Explicitly references §5-3 |
| §8-4 L440-448 | "Full Switch 기본 정의 (모든 Feature에서 동일한 계약)" block. "§5-3, §6-5와 동일한 계약." | ✅ Triple-anchored |

**Verdict**: Switch contract is now a single unified definition referenced by all 3 sections.

### QA Scenario Specificity (Momus 2nd round request)

| ID | R2 Issue | R3 Evidence | Status |
|----|----------|-------------|--------|
| A-1 | Vague proof | L232: "도구: bun test + mock server. 절차: 1) quotaClient 테스트에서 Cloud Code API 응답을 mock... 기대 출력: JSON..." | ✅ PASS |
| A-6 | Vague proof | L237: "도구: sqlite3 + 수동 앱 재시작. 절차: 4-step process with sqlite3 query and app UI verification." | ✅ PASS |
| R-5 | Vague proof | L355: "도구: bun test + mock. 절차: 1) mock remaining_pct=0. 2) agcl 'hello'. 3) stderr check. 4) exit code check." | ✅ PASS |
| SS-2 | Vague proof | L456: "도구: bun test + live LS. 절차: 4-step process with getStatus RPC and expected response." | ✅ PASS |

### Section References Integrity

| Reference | Target Exists? | Correct? |
|-----------|---------------|----------|
| §5-3 ↔ §6-5 cross-ref | ✅ Both exist | ✅ |
| §8-4 references §5-3, §6-5 | ✅ Both exist | ✅ |
| §13 Cockpit refs (oauth.rs L3~4, L49~55, etc.) | ✅ Verifiable against investigation docs | ✅ |
| §9 preamble references NOT NOW from §11 | ✅ | ✅ |
| §12 Phase references success condition IDs (L-1~L-8, A-1~A-7, etc.) | ✅ All IDs exist in their respective sections | ✅ |

---

## Schema Deep-Dive (R3)

### accounts.json (§9-1)

- `version: "1.0"` — string type ✅ (not int, matches NEW-4 fix)
- `current_account_id` — UUID v4 reference ✅
- `accounts[]` — array with id, email, name, created_at, last_used ✅

### accounts/{id}.json (§9-2)

- `account_status` — 4-state enum (active/protected/forbidden/disabled) ✅
- `token` — complete OAuth token shape ✅
- `fingerprint_id` — has NOT NOW comment ✅ (NEW-1 fix verified)
- `quota_cache` — family-aggregated structure ✅
- `rotation.family_buckets` — includes GEMINI, CLAUDE, _min keys ✅
- `wakeup_history` — last_attempt_at, last_result, attempt_count ✅

### No schema contradictions found between sections.

---

## New Issue Scan (R3)

I performed a fresh scan for issues not covered in previous rounds:

### Checked Areas

| Area | Issue Found? | Notes |
|------|-------------|-------|
| Contradictions between sections | ❌ None | All cross-references consistent |
| Missing error handling | ❌ None | 403, timeout, corrupt store all covered |
| Security gaps | ❌ None | File permissions, CSRF state, PKCE noted as recommended (not blocking) |
| Race conditions | ❌ None | Single-instance assumption stated |
| Schema completeness | ❌ None | All fields have clear types and semantics |
| CLI surface completeness | ❌ None | Only auth login + auth list + internal wake-up |
| Migration path | ❌ None | Backup preserved, rollback defined, type changes documented |
| NOT NOW boundaries | ❌ None | serviceMachineId, fingerprint, daemon all clearly marked |
| Implementation order consistency | ❌ None | Phase 2-A through 2-F aligns with feature numbers |
| Success criteria IDs referenced in §12 | ❌ None | All IDs (L-*, A-*, R-*, W-*, SS-*, E2E-*, NF-*, S-*) exist |
| Switch contract triple-anchor | ❌ None | §5-3, §6-5, §8-4 all share identical contract wording |

### Zero new findings.

---

## Implementation Readiness Assessment

| Criterion | Assessment |
|-----------|-----------|
| Spec completeness | ✅ All 5 features fully specified |
| Schema stability | ✅ Single schema, no competing versions |
| Migration safety | ✅ Backup + rollback defined |
| Error handling | ✅ 403/timeout/corrupt all addressed |
| Security posture | ✅ File permissions, CSRF, PKCE noted |
| QA specificity | ✅ All critical criteria have concrete tools/steps |
| Cross-section consistency | ✅ Switch contract unified, no contradictions |
| NOT NOW boundaries | ✅ Clear and enforced |
| Reference integrity | ✅ All section/Cockpit references valid |

---

## Directives for Prometheus

### Core Directives (Minimal — spec is clean)

- ✅ No mandatory fixes remaining
- MUST: Use this spec **as-is** for task decomposition
- MUST: Phase order follows §12 (2-A → 2-B → 2-C → 2-D → 2-E → 2-F)
- MUST: Schema contract is §9 only (ignore GPT spec's v2.0 schema)
- MUST: Switch default is Full Switch (state.vscdb write only, no LS kill/respawn)
- MUST NOT: Implement serviceMachineId in authInject.ts
- MUST NOT: Create `agcl auth wakeup` CLI command
- MUST NOT: Use `quota_api_v1_desktop/` cache path

### QA Directives

- MUST: All unit tests via `bun test` with exact mock expectations
- MUST: Token file permissions test: `stat -f '%Lp'` → 600
- MUST: Atomic write test: verify no `.tmp` remnants
- MUST: Migration backup test: verify `auth.json.v0.2.0.bak` exists
- MUST: NF criteria measured with concrete commands

---

## Recommended Approach

**Spec is approved for implementation.** Prometheus should proceed directly to task decomposition following §12 phase order. No further spec revisions are needed.
