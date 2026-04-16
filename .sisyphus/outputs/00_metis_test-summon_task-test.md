# Metis Test Summon — Pre-Analysis Report

**Agent**: Metis (Pre-Planning Consultant)
**Date**: 2026-04-15
**Task ID**: test
**Trigger**: Prometheus test summon verification

---

## Intent Classification

**Type**: Research (test summon — no actual implementation task)
**Confidence**: High
**Rationale**: This is a smoke test to verify Metis agent can be summoned, analyze the project, and produce an output file. No code changes requested.

---

## Project State Summary

### Source Structure
```
src/
├── entrypoints/cli.ts          — CLI entrypoint
├── main.ts                     — Orchestration hub (3,390 lines)
├── main.test.ts                — Integration/regression tests
├── cli/                        — (reserved, empty)
├── constants/                  — (reserved, empty)
├── types/                      — (reserved, empty)
├── services/                   — 9 modules + 9 test files (18 files)
│   ├── accounts.ts             — Multi-account discovery/activation
│   ├── authList.ts             — Auth list rendering
│   ├── authLogin.ts            — Auth login flow
│   ├── bundleRuntime.ts        — App bundle schema extraction (VM sandbox)
│   ├── connectRpc.ts           — ConnectRPC communication (895 lines)
│   ├── fakeExtensionServer.ts  — LS reverse RPC handler
│   ├── liveAttach.ts           — Live LS detection + attach (516 lines)
│   ├── observeStream.ts        — StreamAgentStateUpdates parser
│   └── stateVscdb.ts           — USS topic + DB read/write (1,537 lines)
└── utils/                      — 4 modules + 3 test files (7 files)
    ├── config.ts               — Path/env config
    ├── hash.ts                 — djb2 hash
    ├── makeMetadata.ts         — LS startup metadata builder
    └── sessionStoragePortable.ts — Session directory management
```

### Codebase Metrics
- **Total source lines**: ~11,965
- **Total test lines**: ~4,438
- **Test-to-source ratio**: ~0.37 (reasonable for a CLI tool)
- **Largest file**: `main.ts` at 3,390 lines (orchestration hub)
- **Hot spots** (4 files totaling 6,338 lines): main.ts, stateVscdb.ts, connectRpc.ts, liveAttach.ts

### Verified Paths
- Live attach path: ✅ Verified
- Offline fallback path: ✅ Verified
- Auth multi-account: ✅ Verified

---

## Identified Risks & Improvement Points

### Risk 1: `main.ts` Monolith — 3,390-line Orchestration File [HIGH]
- **Impact**: Highest blast radius. Any change to orchestration logic (live/offline branch, auth flow, resume handling) touches this file.
- **Mitigation**: Consider extracting discrete orchestration phases (auth, argv parse, live attach, offline spawn, observation loop) into separate modules under `src/services/` or `src/orchestration/`.
- **Priority**: Address before adding new features. Each new feature increases the monolith's surface area.

### Risk 2: Bundle Module ID Fragility in `bundleRuntime.ts` [HIGH]
- **Impact**: Hardcoded webpack module IDs (20217, 62573, 30495, 29076, 17028) will break on every Antigravity.app update.
- **Mitigation**: 
  1. Add a runtime validation step that verifies extracted exports match expected shapes
  2. Consider feature-detection over ID-matching (probe for `create`, `toBinary`, `createClient` exports by signature)
  3. At minimum, add a version guard that warns when bundle format changes
- **Priority**: This is the first thing that breaks on app updates. Needs defensive coding.

### Risk 3: `observeAndAppendSteps_func` Pipeline Complexity [MEDIUM]
- **Impact**: 5-stage pipeline (stream → fetch → append → pending-tail → stabilize) has tight coupling. Changes to any stage cascade.
- **Mitigation**: Each stage should have isolated unit tests with clear input/output contracts. Consider extracting into a pipeline class with composable stages.
- **Priority**: Medium — works correctly now, but fragile for future changes.

---

## Directives for Prometheus

### Core Directives
- MUST: Read `AGENTS.md` investigation rules before any codebase analysis
- MUST: Use `ref/prettier-formatted/ANNOTATED_INDEX.md` as first lookup for any Antigravity bundle investigation
- MUST NOT: Modify `main.ts` without first running `bun test` to establish baseline
- MUST NOT: Touch protobuf wire format constants without cross-referencing `bundleRuntime.ts` module IDs

### QA/Acceptance Criteria Directives
- MUST: All acceptance criteria as executable `bun test` commands
- MUST: Include exact expected outputs for each test
- MUST NOT: Create criteria requiring manual browser interaction or visual confirmation

---

## Recommended Approach

This is a test summon — no implementation plan needed. For future real tasks: start with intent classification, explore before questioning, and always verify against the annotated index before investigating bundle internals.

---

## Smoke Test Verification

- [x] Metis agent summoned successfully
- [x] Project state analyzed
- [x] Risks identified (3 items: 2 HIGH, 1 MEDIUM)
- [x] Output file created at `.sisyphus/outputs/00_metis_test-summon_task-test.md`
- [x] Concise response format prepared
