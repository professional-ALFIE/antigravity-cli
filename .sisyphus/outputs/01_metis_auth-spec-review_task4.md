# Metis Auth Spec Review — v0.2.1 Auth Overhaul

> **Reviewer**: Metis (Pre-Planning Consultant)
> **Date**: 2026-04-15
> **Subject**: `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`
> **Mandate**: `.sisyphus/mandate_v0.2.1-auth-overhaul.md`

---

## Intent Classification

**Type**: Spec Review (Research)
**Confidence**: High
**Rationale**: The task is to review an existing spec document for gaps, contradictions, ambiguities, and migration adequacy before it becomes an implementation contract.

---

## Executive Summary

The integrated spec is **well-structured and largely complete**. It successfully merges the GPT spec's feature scope with the Opus spec's implementation depth, and faithfully reflects all 3 rounds of user interview decisions. However, I found **13 findings** across 4 severity levels:

| Severity | Count | Key Theme |
|----------|-------|-----------|
| 🔴 Critical | 2 | Schema version contradiction; Wake-up CLI surface contradiction |
| 🟡 High | 4 | Missing PKCE/OAuth security; ambiguous account ID format; quota cache path inconsistency; missing error recovery for corrupt store |
| 🔵 Medium | 4 | Missing file permissions spec; `import-token` surface conflict; `serviceMachineId` inject scope unclear; pending-switch race condition |
| ⚪ Low | 3 | NF-5 measurement ambiguity; E2E-3 threshold data mismatch; cache directory naming drift |

---

## Finding Details

### 🔴 F-1: Schema Version Contradiction (Critical)

**Location**: §9 (Account Store Schema) vs source specs

**Problem**: The integrated spec declares `version: "1.0"` in `accounts.json` (§9-1), matching the Opus spec. However, the GPT spec uses `version: "2.0"`. This isn't just a cosmetic difference — the two specs define **entirely different field structures** for the same account detail file:

| Aspect | GPT spec (v2.0) | Integrated spec (v1.0 / Opus) |
|--------|-----------------|-------------------------------|
| Status model | `disabled: boolean` + `is_forbidden: boolean` | `account_status: "active"|"protected"|"forbidden"|"disabled"` (enum) |
| Quota shape | `quota.models[]` (flat model array) | `quota_cache.families.{FAMILY}.remaining_pct` (family-aggregated) |
| Rotation state | `auto_rotate_state.last_rotation_bucket_by_family` | `rotation.family_buckets` |
| Cache dir | `~/.antigravity-cli/cache/quota_api_v1_desktop/` | `~/.antigravity-cli/cache/quota/` |
| Token fields | `session_id` field present | No `session_id` field |

**Verdict**: The integrated spec correctly chose the Opus schema (v1.0 with 4-state enum). This is the right call per user interview §3-13. However, the spec should **explicitly state** that the GPT spec's v2.0 schema is superseded, to prevent any implementer from consulting the old GPT spec and picking up the wrong field names.

**Recommendation**: Add a note to §9: "GPT spec's `version: 2.0` schema is superseded. Use only this schema."

---

### 🔴 F-2: Wake-up CLI Surface Contradiction (Critical)

**Location**: §7 (Feature 4: Wake-up) vs §3-9 (CLI 표면 명령)

**Problem**: The spec's §3-9 (CLI 표면 명령) lists only `auth login` and `auth list` as CLI surface commands. The NOT NOW section (§11) does not mention a `wake-up` command. However, §7-3 defines an execution flow that begins with:

```
$ antigravity-cli wake-up
```

And the Opus source spec's §6-4 file changes include:

> `src/main.ts` — `wake-up` 서브커맨드 추가

But the mandate §3-9 explicitly states:

> | `auth login` | 브라우저 OAuth (기본). 내부적으로 Local Import도 처리 |
> | `auth list` | 계정 목록 + quota 진도바. TTY에서 선택 시 auth inject |

Only 2 commands. No wake-up listed. The mandate §3-10 (NOT NOW) does not list wake-up either, because wake-up is in-scope.

**Verdict**: This is a genuine surface ambiguity. The integrated spec added wake-up as a subcommand (matching Opus's design) but forgot to update the CLI surface table.

**Recommendation**: Either:
- (A) Add `wake-up` to §3-9 CLI 표면 명령 table, OR
- (B) Make wake-up an automatic internal process triggered during message-send path (no dedicated CLI command), and remove the `$ antigravity-cli wake-up` example from §7-3

Option (A) is simpler and matches the Opus spec's explicit subcommand design.

---

### 🟡 F-3: Missing PKCE / OAuth Security Hardening (High)

**Location**: §4-2 (브라우저 OAuth 내부 동작)

**Problem**: The spec describes the OAuth flow with `state = random UUID` for CSRF protection, which is correct. However, for CLI/desktop OAuth flows, Google's current best practice recommends **PKCE (Proof Key for Code Exchange)** as an additional layer. The Cockpit reference (`oauth.rs`) may or may not implement PKCE.

Additionally, the spec stores `client_secret` alongside `client_id` in the CLI code. For a desktop/CLI app, this is technically a "public client" — the secret can always be extracted from the binary. Google's OAuth for installed apps accepts this but the spec should acknowledge the security posture explicitly.

**Recommendation**: 
- Add `code_verifier` / `code_challenge` (PKCE S256) to the OAuth flow
- Add a note: "client_id/client_secret are extracted from the Cockpit open-source binary; they are public-client credentials, not confidential"

---

### 🟡 F-4: Ambiguous Account ID Format (High)

**Location**: §9-1, §9-2 (Account Store Schema)

**Problem**: The spec uses `acc_uuid_001` as an example account ID but never defines:
1. Whether IDs are UUIDs, sequential strings, or something else
2. Who generates them (the CLI on account creation? derived from email hash?)
3. Whether they're stable across import/export

This matters because:
- `pending-switch.json` references `target_account_id` and `source_account_id`
- Cache files use `{account_id}.json`
- The dedup upsert logic (L-6) needs to match accounts — currently by email, but the ID generation could collide

**Recommendation**: Add a line to §9: "Account IDs are UUID v4, generated at account creation. ID is immutable. Dedup is by email (case-insensitive)."

---

### 🟡 F-5: Quota Cache Path Inconsistency (High)

**Location**: §9-4 (API 캐시) vs GPT spec §8-3

**Problem**: The integrated spec says `~/.antigravity-cli/cache/quota/{account_id}.json`. The GPT spec says `~/.antigravity-cli/cache/quota_api_v1_desktop/`. These are different paths. If an implementer consults the GPT spec for Cockpit alignment, they'll pick the wrong path.

**Recommendation**: Pick one path and state it authoritatively. Since the integrated spec is the contract, use `~/.antigravity-cli/cache/quota/{account_id}.json` and explicitly note that the GPT spec's longer path is not used.

---

### 🟡 F-6: Missing Error Recovery for Corrupt Account Store (High)

**Location**: §9 (Account Store Schema)

**Problem**: The spec defines `accounts.json` as the single source of truth for all accounts, but doesn't address:
1. What happens if `accounts.json` is corrupt/unparseable?
2. What happens if `accounts/{id}.json` is missing but referenced in the index?
3. What happens if two CLI instances race to write `accounts.json`?

These are real operational scenarios, especially during:
- Migration (old format → new format)
- Auto-rotate (concurrent writes to rotation state)
- Manual file editing

**Recommendation**: Add a section on store integrity:
- "Reads are tolerant: missing detail file → account shown with `(err)` in list"
- "Writes are atomic: write to `.tmp` then rename"
- "Corrupt index → backup + log error + treat as empty store (re-login required)"

---

### 🔵 F-7: Missing File Permissions Spec (Medium)

**Location**: §9 (Account Store Schema)

**Problem**: Account detail files contain `refresh_token` and `access_token` in plaintext JSON. The spec doesn't specify file permissions. On macOS, default file creation is typically `0644` (world-readable), which is a security issue for token files.

Cockpit's approach (Tauri app) handles this differently since it's a sandboxed app. A CLI tool needs explicit permissions.

**Recommendation**: Add to §9: "Account store files MUST be created with mode `0600` (owner read/write only). On creation, `chmod 600` the accounts directory and all files within."

---

### 🔵 F-8: `import-token` CLI Surface Conflict (Medium)

**Location**: §4-1 (등록 경로 3종)

**Problem**: The spec lists `auth login --token` as the CLI surface for import-token. But the mandate §3-14 explicitly states:

> **import-token**: 내부/이행 축. CLI 표면 논의 금지 (주인님 불쾌)

The spec's §4-1 table shows `auth login --token (마이그레이션 경로)` in the CLI surface column, which directly contradicts the user's instruction to not discuss it as a CLI surface.

**Recommendation**: Change the table to show `auth login --token` as "(내부, CLI 표면 아님)" or remove the column entry and describe it only in implementation notes.

---

### 🔵 F-9: `serviceMachineId` Inject Scope Unclear (Medium)

**Location**: §5-3 (선택 후 Auth Inject)

**Problem**: The inject step §5-3 lists 3 keys to inject:
- `antigravityUnifiedStateSync.oauthToken`
- `jetskiStateSync.agentManagerInitState` field 6
- `antigravityOnboarding`

But the Opus spec §4-3 step 4 mentions a 4th key:
- `fingerprint가 있으면 storage.serviceMachineId도 교체`

The integrated spec drops this 4th key without explanation. Since fingerprint is NOT NOW, this might be intentional — but it should be stated explicitly.

**Recommendation**: Add a note: "serviceMachineId inject is deferred to v0.2.2 (requires Device Fingerprint, NOT NOW)."

---

### 🔵 F-10: Pending-Switch Race Condition (Medium)

**Location**: §6-5 (실행 타이밍 + Pending Switch 영속화)

**Problem**: If two CLI instances start simultaneously (e.g., user runs `agcl "task1" & agcl "task2" &`), both could:
1. Read the same `pending-switch.json`
2. Both apply the inject
3. Both delete the file

This is a TOCTOU race. The spec assumes single-instance operation but doesn't state it.

**Recommendation**: Add a note: "pending-switch.json assumes single CLI instance per account store. Concurrent CLI instances are NOT supported in v0.2.1."

---

### ⚪ F-11: NF-5 Measurement Ambiguity (Low)

**Location**: §10-2 (비기능)

**Problem**: NF-5 says "quota fetch timeout/실패가 현재 명령 block 안 함" but the proof method is "테스트: mock timeout 후 명령 정상 완료". This is vague — what mock? What timeout value? What "명령 정상 완료" means exactly?

**Recommendation**: Make it concrete: "Mock quotaClient to return timeout after 3s. Run `agcl "hello"`. Expect: message sent successfully, stderr shows `[quota fetch timed out]`, exit code 0."

---

### ⚪ F-12: E2E-3 Threshold Data Mismatch (Low)

**Location**: §10-1 (전체 E2E)

**Problem**: E2E-3 says "Ultra remaining 65%". But the Ultra threshold buckets are 70→40→10. At 65%, the account would be in the "70" bucket (already crossed from ≥70 to <70). For E2E-3 to demonstrate a *first crossing*, the initial value should be ≥70% and the post-work value should be <70%.

**Recommendation**: Change to "Ultra remaining 73% → work uses quota → remaining drops to 65% → rotate triggered at 70% boundary"

---

### ⚪ F-13: Cache Directory Naming Drift (Low)

**Location**: §9-4

**Problem**: The spec uses `~/.antigravity-cli/cache/quota/` but the current codebase already has cache-like paths under `~/.antigravity-cli/`. There's no migration plan for if cache paths change.

**Recommendation**: Low priority. Add the path to the "파일 생성" list in §12 implementation order so it's explicitly mkdir'd.

---

## Migration Adequacy Assessment

**Overall**: Migration path is **adequate with minor gaps**.

| Aspect | Assessment | Note |
|--------|-----------|------|
| Old → New store migration | ✅ Good | Local Import function extracts tokens from existing user-data dirs |
| No data loss guarantee | ✅ Good | "기존 user-data-dir 삭제하지 않음" explicitly stated |
| Failure mode | ✅ Good | "실패 시 경고 메시지 + 기존 방식 유지" |
| Version skew handling | ⚠️ Gap | No spec for what happens if user has both v0.2.0 and v0.2.1 installed (e.g., two source clones) |
| Rollback path | ⚠️ Gap | No spec for how to revert to v0.2.0 if v0.2.1 breaks. Old user-data is preserved, but old auth.json format is incompatible with new accounts.json |
| Token validity | ✅ Good | refresh_tokens from existing state.vscdb are reusable |

**Missing migration scenarios:**
1. User upgrades → new store created → user downgrades → old `auth.json` is gone (overwritten?) or coexists?
2. User has 8 managed accounts → migration runs → some tokens expired → how many fail before "migration failed"?

**Recommendation**: Add a migration safety note: "v0.2.1 preserves old `auth.json` as `auth.json.v0.2.0.bak` on first migration. Rollback = restore this file."

---

## NOT NOW Assessment

**Overall**: NOT NOW list is **appropriate**. No items that should be in v0.2.1 were incorrectly deferred.

| NOT NOW Item | Assessment | Comment |
|-------------|-----------|---------|
| Seamless Switch (path C) | ✅ Correct | Unvalidated, Full Switch sufficient |
| Device Fingerprint | ✅ Correct | v0.2.2+ |
| Background Daemon | ✅ Correct | Requires cron/launchd |
| Plugin Sync | ✅ Correct | Cockpit-only |
| Default backup (user-00) | ✅ Correct | Account Overlay replaces this |
| YAML Policy Engine | ✅ Correct | Hardcoded rules first |
| Multi-workspace | ✅ Correct | Single workspace for now |
| Standalone quota command | ✅ Correct | `auth list` covers this |

**One concern**: The mandate §3-5 says Seamless Switch was described as "가장 중요한 축 중 하나" by the user. The spec treats it as experimental (Feature 5). This is the right compromise — it's in-scope as an investigation, but the spec's default path is Full Switch. The experimental status is correct.

---

## Schema Consistency Check

**Account Store**: Internally consistent within the integrated spec. The 4-state enum (`active`/`protected`/`forbidden`/`disabled`) is used consistently across:
- §5-3 (inject selection excludes forbidden/disabled)
- §6-6 (rotate candidate filtering)
- §7-1 (wake-up target filtering)
- §9-2 (schema definition)

**One inconsistency found**: The `accounts.json` index (§9-1) does NOT include `account_status`, but the detail file (§9-2) does. This means `auth list` must open every detail file to display status, which could be slow with many accounts. Consider adding a summary field to the index.

---

## Directives for Prometheus

### Core Directives

- MUST: Resolve F-1 by adding explicit "Opus schema supersedes GPT" note to §9
- MUST: Resolve F-2 by adding `wake-up` to CLI surface table OR making it internal-only
- MUST: Resolve F-8 by removing `--token` from CLI surface column per user instruction
- MUST: Add account ID format definition (UUID v4, generated at creation)
- MUST: Add file permissions requirement (0600) for token files
- MUST: Add corrupt store recovery behavior
- MUST: Add migration backup note (preserve old auth.json)
- MUST: Add single-instance assumption for pending-switch.json
- MUST NOT: Add PKCE as a blocking requirement (recommend only, can be post-v0.2.1)
- MUST NOT: Expand scope beyond what mandate defines
- MUST NOT: Add new CLI commands beyond wake-up (already in spec)
- PATTERN: Follow `src/services/authList.ts` rendering for output format (already correct in spec)
- TOOL: Use `ast_grep_search` when implementing to find all `auth.json` references for migration

### QA/Acceptance Criteria Directives

- MUST: Success criteria L-1 through L-8 should have concrete mock/test commands, not just "수동 E2E"
- MUST: Add a test for concurrent CLI instances (expected: documented as unsupported, not a crash)
- MUST: Migration test: create old-format `user-data/user-01` with mock state.vscdb → run migration → verify accounts.json created
- MUST: NF criteria need concrete measurement commands (`time agcl auth list`, not just "time 명령으로 측정")
- MUST: Wake-up test should mock LS spawn timeout and verify cooldown is recorded
- MUST NOT: Create criteria requiring "user manually tests in production browser" for OAuth flow (use mock OAuth server for automated tests)

---

## Recommended Approach

The spec is ~90% ready to become an implementation contract. The 2 critical findings (F-1: schema version ambiguity, F-2: wake-up CLI surface) are quick fixes — a few lines each. The high findings (F-3 through F-6) are important for robustness but none are blockers for starting Phase 2-A implementation. Recommend: fix criticals, annotate highs, then proceed with implementation in spec order (Phase 2-A through 2-F).

