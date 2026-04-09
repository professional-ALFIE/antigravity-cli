# Antigravity CLI Integration Plan — Live LS + Headless Unified Flow

> **Date**: 2026-04-09 (revised)
> **Scope**: Merge two proven paths (live LS direct attach + standalone headless) into one CLI entry point.
> **Sources**: Opus initial plan + Codex review + live probe verification results.

---

## 1. Background & Problem Statement

### What We Have (Two Working Paths)

| Path | How It Works | When It's Useful |
|------|-------------|------------------|
| **Live LS Direct Attach** (verified probe) | `ps` → find running LS by `workspace_id` → `lsof` → find ConnectRPC port → HTTPS POST with CSRF token → `StartCascade` / `SendUserCascadeMessage` / `UpdateConversationAnnotations` | IDE is already open for this workspace |
| **Standalone Headless** (v0.2.0 `main.ts`) | Spawn own LS child → `FakeExtensionServer` → metadata stdin → discovery file → USS topic handshake → `StartCascade` → stream observe → state.vscdb hydration | IDE is not running, or no live LS exists |

### What's Missing

Neither path alone covers the full product story:

1. **Live path** was a one-off probe script with no transcript, no stream observation, no product-grade error handling.
2. **Headless path** spawns its own LS, which means:
   - ~5s cold start penalty (LS spawn + discovery + USS handshake)
   - Duplicate LS process when IDE is already running
   - No live UI sync (summaries only appear after restart)

### Target State

A single `antigravity-cli` binary that:

```
IF live LS found for this workspace
  → Attach directly (fast path, ~100ms to first RPC)
  → Reuse IDE's existing auth, models, and conversation state
  → UI reflects new conversations immediately (verified)
ELSE
  → Fall back to standalone headless (current v0.2.0 flow)
  → Hydrate state.vscdb for later-open surfacing
```

---

## 2. Architecture Overview

```
                   antigravity-cli "prompt"
                           │
                     ┌─────▼──────┐
                     │ argv parse │  (existing: parseArgv_func)
                     │ config load│  (existing: resolveHeadlessBackendConfig)
                     │ model resol│  (existing: resolveModelAlias_func)
                     └─────┬──────┘
                           │
                   ┌───────▼────────┐
                   │ discoverLiveLS │  ◄── NEW MODULE
                   └───────┬────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              live LS found   not found
                    │             │
            ┌───────▼──────┐  ┌──▼──────────────┐
            │ LIVE PATH    │  │ OFFLINE PATH     │
            │ (direct RPC) │  │ (spawn own LS)   │
            └───────┬──────┘  └──┬───────────────┘
                    │            │
                    ▼            ▼
            transcript +     transcript +
            local tracking   local tracking +
                             atomic persist
                             (trajectorySummaries
                              + sidebarWorkspaces)
```

### Critical Design Rule: Post-Flight Divergence

```
LIVE PATH post-flight:
  ✅ transcript append (JSONL)
  ✅ local session tracking file
  ✅ stderr status messages
  ❌ NO state.vscdb hydration — IDE owns its own DB

OFFLINE PATH post-flight:
  ✅ transcript append (JSONL)
  ✅ local session tracking file
  ✅ stderr status messages
  ✅ state.vscdb hydration (trajectorySummaries + sidebarWorkspaces)
```

**Rationale**: Live path reuses the same LS that the IDE's state owner is already managing. Writing `trajectorySummaries` + `sidebarWorkspaces` into state.vscdb from our side would create duplicate persist or conflict with the IDE's own USS sync.

---

## 3. New Module: `src/services/liveAttach.ts`

### 3.1 Responsibilities

| Function | Purpose |
|----------|---------|
| `discoverLiveLanguageServer_func(workspacePath)` | Find running LS process matching this workspace |
| `extractLiveDiscoveryInfo_func(processLine)` | Parse PID, CSRF token, extension_server_port from `ps` output |
| `probeLiveConnectRpcPort_func(pid, extPort, csrfToken)` | `lsof` → candidate ports → `GetUserStatus` probe → return working port |
| `buildLiveDiscoveryInfo_func(port, csrfToken)` | Create `DiscoveryInfo`-compatible object for existing `callConnectRpc` |

### 3.2 Key Design Decisions

1. **Reuse `createWorkspaceId_func` logic from v0.1.x `ls-process-match.ts`**
   - Formula: `'file' + workspacePath.replace(/[^a-zA-Z0-9]/g, '_')`
   - This is the workspace_id the running LS was launched with

2. **Port discovery via `lsof`** (macOS) / `ss`+`netstat` (Linux) / `netstat -aon` (Windows)
   - Same cross-platform strategy as `LSBridge._findConnectPort()` in v0.1.x

3. **Probe with `GetUserStatus`** — same as v0.1.x `LSBridge._probePort()`
   - HTTPS, `rejectUnauthorized: false`, self-signed cert
   - 401 = correct endpoint (CSRF missing), 200 = authenticated
   - Send `x-codeium-csrf-token` header for actual calls

4. **No `vscode` import** — unlike v0.1.x `LSBridge` which could call `vscode.commands.executeCommand`, this module uses only `child_process` and `node:https`

5. **"Attach 가능" 판정 기준** — discovery만 됐다고 live path로 가지 않음. 반드시:
   - workspace_id 정확 매칭
   - CSRF token 추출 성공
   - ConnectRPC port 확인
   - 비파괴 probe (GetUserStatus) 성공
   까지 통과해야 live path로 진입

### 3.3 Return Type

```typescript
interface LiveLsConnection {
  pid: number;
  port: number;
  csrfToken: string;
  workspaceId: string;
  /** DiscoveryInfo-compatible object usable by callConnectRpc */
  discovery: DiscoveryInfo;
}
```

---

## 4. Changes to `src/main.ts`

### 4.1 Implementation Order (Top-Down)

**Step 0 (prerequisite)**: Extract existing headless boot (Steps 5–14) into `runOfflineSession_func()`.
- No behavior change — pure extraction
- This creates a clean insertion point for the live path decision

**Step 1**: Add live discovery call after config/model resolve
**Step 2**: Add `handleLivePath_func` for create + resume-send
**Step 3**: Wire the decision point:

```
argv parse → config load → model resolve
  → discoverLiveLS()
  → IF found: handleLivePath_func(...)
  → ELSE:     runOfflineSession_func(...)   // extracted existing flow
```

### 4.2 Live Path Handler: `handleLivePath_func`

```typescript
async function handleLivePath_func(
  liveConnection: LiveLsConnection,
  config: HeadlessBackendConfig,
  workspaceRootPath: string,
  cli: CliOptions,
  modelEnum: number,
  effectiveModelName: string,
): Promise<void>
```

What it does:
1. **Skip** FakeExtensionServer, LS spawn, discovery wait, USS topic wait, chat stream
2. **Directly call** `StartCascade` / `SendUserCascadeMessage` via `callConnectRpc` using `liveConnection.discovery`
3. **Observe** via `StreamAgentStateUpdates` → `GetCascadeTrajectorySteps` (same loop as headless)
4. **Track** via `UpdateConversationAnnotations` (same as headless)
5. **Append** transcript (same JSONL format)
6. **NO state.vscdb hydration** — IDE's own state owner handles this

### 4.3 What's Shared Between Live & Offline Paths

| Component | Shared? | Notes |
|-----------|---------|-------|
| `parseArgv_func` | ✅ | Identical |
| `resolveHeadlessBackendConfig` | ✅ | Config paths are the same |
| `resolveModelAlias_func` | ✅ | Identical |
| `callConnectRpc` / `callConnectProtoRpc` | ✅ | Only `DiscoveryInfo` differs |
| `observeAndAppendSteps_func` | ✅ | Works with any LS connection |
| `trackConversationVisibility_func` | ✅ | Same RPC call |
| `trackConversationLocally_func` | ✅ | Same local file |
| `printSessionContinuationNotice_func` | ✅ | Identical |
| `appendTranscriptLine_func` | ✅ | Same JSONL format |
| `hydrateSurfacedStateToStateDb_func` | ❌ | **Offline path only** |
| `FakeExtensionServer` | ❌ | Offline path only |
| LS spawn + metadata + stdin | ❌ | Offline path only |
| `waitForDiscoveryFile` | ❌ | Offline path only |
| `waitForTopics_func` | ❌ | Offline path only |
| `StartChatClientRequestStream` | ❌ | Offline path only (live TBD §5.1) |

---

## 5. Fallback Rules

### 5.1 Fallback Permitted (first mutating RPC NOT yet sent)

These failures safely fall back to offline path:

| Failure | Reason Fallback Is Safe |
|---------|------------------------|
| Live LS not found | No write attempted |
| workspace_id mismatch | No write attempted |
| CSRF token extraction failure | No write attempted |
| ConnectRPC port detection failure | No write attempted |
| Attach probe ECONNREFUSED/ECONNRESET/timeout | No write attempted |
| Pre-mutating 401/403/404 | No write attempted |

### 5.2 Immediate Failure (NO fallback — first mutating RPC already sent)

| Failure | Why Fallback Is Forbidden |
|---------|--------------------------|
| `StartCascade` returned cascadeId, then observe fails | Fallback would create duplicate conversation |
| `SendUserCascadeMessage` returned 2xx, then subsequent error | Message already delivered; resend = duplication |
| `resume-send` with invalid cascadeId | Semantic error, not a connectivity issue |
| CLI input validation errors | Not a path issue |

### 5.3 Decision Point Location

The fallback/fail decision must live in the **outer hybrid wrapper**, NOT inside `handleNewConversation_func` or `handleResumeSend_func`. Placing it inside the handler risks missing the mutating-RPC boundary.

---

## 6. Open Questions to Investigate Before Implementation

### 6.1 Chat Stream Requirement for Live LS

**Question**: Does the live path need `StartChatClientRequestStream`?

- In headless, without this stream the LS stalls on RUNNING state
- In live path, the IDE UI already has one open
- **Hypothesis**: Not needed — IDE's existing stream covers it
- **Verification needed**: Run probe script WITHOUT chat stream, check if RUNNING→IDLE transition happens

### 6.2 Concurrent Access Safety

**Question**: Can we use the same LS while IDE is actively using it?

- The probe verified basic RPC works
- Stream observation (StreamAgentStateUpdates) with a separate subscriberId should work
- **Risk**: LS may have subscription limits or rate limits
- **Mitigation**: Use unique subscriberId, respect timeouts

---

## 7. Implementation Plan

### Phase 1: Extract Offline Session (Top-Down Prep)

**File**: `src/main.ts` (refactor only — zero behavior change)

1. Extract existing Steps 5–14 into `runOfflineSession_func(...)`
2. Verify all existing tests pass unchanged
3. This creates the clean insertion point for live path

### Phase 2: Live LS Discovery Module

**Files**: `src/services/liveAttach.ts`, `src/services/liveAttach.test.ts`

1. Implement `createWorkspaceId_func(workspacePath)` — port from v0.1.x `ls-process-match.ts`
2. Implement `findLiveLanguageServerProcess_func(workspaceId)` — `ps` → match → extract
3. Implement `findConnectRpcPort_func(pid, extPort)` — `lsof` → probe → return
4. Implement `discoverLiveLanguageServer_func(workspacePath, config)` — orchestrate above
5. Write tests: mock `ps`/`lsof` output, verify parsing and port selection

### Phase 3: Live Path Handler (create only)

**File**: `src/main.ts` (additions)

1. Add `handleLivePath_func` — hybrid wrapper with fallback boundary
2. Wire to `main()`: `discoverLiveLS() → live or offline`
3. Verify: live attach → immediate UI reflection
4. Verify: live miss → offline persist succeeds

### Phase 4: Extend to resume-send

1. Same hybrid wrapper for resume-send
2. Additional constraint: invalid cascadeId = immediate fail (no fallback)

### Phase 5: Chat Stream Investigation

1. Run live path without `StartChatClientRequestStream`
2. Verify RUNNING→IDLE transition with real prompt
3. If it stalls: add chat stream to live path
4. If it works: no change needed

### Phase 6: Integration Test + Output Polish

1. With IDE running: `antigravity-cli "hello"` → verify live path activates
2. Without IDE: `antigravity-cli "hello"` → verify headless fallback
3. Resume send: both paths allow message continuation
4. State persistence: hydrated state appears after IDE restart (offline only)
5. Output policy:
   - `--json` stdout contract unchanged
   - Mode/fallback/warnings on `stderr` only
   - Three status lines: `live attach matched` / `live attach unavailable, falling back to offline` / `offline persist completed; will surface on next app launch`

---

## 8. Success Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | Live LS detected when IDE is running | `discoverLiveLanguageServer_func` returns connection info |
| 2 | RPC calls succeed on live LS | `StartCascade` + `SendUserCascadeMessage` return valid cascadeId |
| 3 | Stream observation works on live LS | `observeAndAppendSteps_func` produces transcript |
| 4 | Headless fallback when no live LS | Same behavior as current v0.2.0 |
| 5 | Live path does NOT write state.vscdb | No `trajectorySummaries`/`sidebarWorkspaces` persist in live mode |
| 6 | Cold start < 500ms for live path | No LS spawn, no discovery wait, no USS handshake |
| 7 | Transcript output identical between paths | Same `appendTranscriptLine_func`, same JSONL format |
| 8 | No fallback after mutating RPC | cascadeId received → failure = exit, not retry |

---

## 9. Scope Exclusions (NOT NOW)

- ❌ `resume-list` hybrid path — 1차 범위에서 분리 (read-only, 별도 구현)
- ❌ `SmartFocusConversation` integration — future enhancement
- ❌ Windows/Linux support for live discovery — macOS first
- ❌ Multiple workspace support in single CLI invocation
- ❌ Bridge extension revival or modification

---

## 10. File Layout After Implementation

```
src/
├── main.ts                        # Modified: extract runOfflineSession, add live path
├── main.test.ts                   # Modified: add live path tests
├── services/
│   ├── liveAttach.ts              # NEW: live LS discovery + connection
│   ├── liveAttach.test.ts         # NEW: unit tests
│   ├── connectRpc.ts              # UNCHANGED
│   ├── stateVscdb.ts              # UNCHANGED (atomic write + sidebar seed already landed)
│   ├── fakeExtensionServer.ts     # UNCHANGED (offline-only)
│   ├── bundleRuntime.ts           # UNCHANGED
│   └── observeStream.ts          # UNCHANGED
└── utils/                         # UNCHANGED
```

---

## 11. Reference: Key Code Locations

### v0.1.x (issue-34, read-only reference)

| File | What to Reference |
|------|-------------------|
| `packages/extension/src/ls-process-match.ts` | `createWorkspaceId_func`, `findMatchingLanguageServerLine_func` |
| `packages/extension/src/extension.ts:23-94` | `fixLsConnection` — Phase 1/2 discovery via ps+lsof |
| `packages/sdk/src/transport/ls-bridge.ts` | `LSBridge._rpc`, `_findLSProcess`, `_findConnectPort`, `_probePort`, `_extractArg` |
| `packages/sdk/src/transport/state-bridge.ts` | USS key constants, state.vscdb structure |

### v0.2.0 (issue-36, target codebase)

| File | Relevant Functions |
|------|-------------------|
| `src/main.ts` | `main()`, `handleNewConversation_func`, `handleResumeSend_func`, `observeAndAppendSteps_func` |
| `src/services/connectRpc.ts` | `callConnectRpc`, `callConnectProtoRpc`, `DiscoveryInfo` |
| `src/services/stateVscdb.ts` | `StateDbReader`, `upsertTopicRowValuesAtomic` |
| `src/services/bundleRuntime.ts` | `loadAntigravityBundle_func`, `createLanguageServerClient_func` |
| `src/utils/config.ts:93` | workspace_id 계산 로직 |
