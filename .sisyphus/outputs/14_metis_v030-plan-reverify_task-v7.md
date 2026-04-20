# 7th Plan Re-verification: v0.3.0 Auth Rotate Plan

**Target**: `.sisyphus/plans/01-plan-v030-auth-rotate.md`
**References**: handoff (v0.3.0-01-handoff.md), question answers (v0.3.0-01-question.md), mandate (mandate_v030-spec-plan.md)
**Focus**: 6th Momus REJECT — Switch 3→2 단계 재정의 일관성

---

## 1. Verification Results: 6th Momus REJECT Fixes

### 1.1 Switch Flow 2-Stage Consistency Check ✅ PASS

| Location | Text | Verdict |
|----------|------|---------|
| SC-7 (L170) | "2단계: post-response에서 즉시 전환+기록 → 다음 실행 시 fingerprint 적용" | ✅ Correctly 2-stage |
| SC-7 (L174-178) | 1단계: accounts.json 즉시 변경 + pending-switch.json 기록 | ✅ Instant switch + record |
| SC-7 (L179-184) | 2단계: startup fingerprint 적용만, 파일은 log로 유지 | ✅ Fingerprint-only, no deletion |
| Task 8 (L989-1024) | Summary diagram shows 2-stage flow | ✅ Consistent with SC-7 |
| Task 8 (L1008-1023) | "1단계: 즉시 전환+기록", "2단계: fingerprint 적용만" | ✅ Clear separation |
| Task 9 (L1107-1118) | "소비 후 삭제 → 읽고 fingerprint 적용, log 유지" | ✅ No deletion, log preserved |
| Task 12 (L1341-1347) | "Switch 흐름 2단계 위치" startup fingerprint apply only | ✅ Consistent |

**Verdict**: All 7 locations consistently describe 2-stage flow. No residual "3-stage" references found.

### 1.2 Task 9 Ambiguity Check ✅ PASS

| Aspect | Previous (6th) | Current (7th) | Verdict |
|--------|---------------|---------------|---------|
| pending-switch.json treatment | "제거하거나 skip" (ambiguous) | "읽고 fingerprint 적용만 수행, 파일은 log로 유지" (L1112-1113) | ✅ Clear |
| Task 9 References | "제거/수정 대상" | "소비 후 삭제 → 읽고 fingerprint 적용 후 유지" (L1108-1109) | ✅ Changed |
| startup behavior | Unclear if file deleted | L1114-1116: "1. pending-switch.json이 존재하면 읽기 (삭제하지 않음)" | ✅ Explicit |

### 1.3 Handoff Consistency Check ✅ PASS

| Handoff Reference | Plan Match | Verdict |
|-------------------|-----------|---------|
| [9] L83-89: "그 시점에 바로 switch를 수행하고, 결과를 pending-switch.json에 기록" | SC-7 1단계: accounts.json 즉시 변경 + pending-switch.json 기록 | ✅ Match |
| [9] L352-353: "다음 [3]이 시작될 때 이 메모를 먼저 적용하고... fingerprint도 같이 맞춘다" | SC-7 2단계 + Task 12: startup fingerprint 적용 | ✅ Match |
| Mandate L22: "pending-switch.json은 적용 기록" | SC-7 L184: "이미 적용 완료된 기록" | ✅ Match |
| Mandate L29: "post-prompt rotate는 같은 실행 안에서 즉시 적용" | Task 8 L993-1001: post-response에서 즉시 실행 | ✅ Match |
| Question I: "적용 기록이다" | Plan consistently treats as log, never as pending intent | ✅ Match |

---

## 2. Full Plan Gap Analysis

### 2.1 Gaps Found: 3 issues (2 Medium, 1 Low)

#### GAP-1 (MEDIUM): Task 9 missing explicit mention of `applyPendingSwitchIntentIfNeeded_func` behavior change

**Location**: Task 9 (L1099-1195)
**Issue**: Task 9 says `applyPendingSwitchIntentIfNeeded_func` should change from "소비 후 삭제" → "읽고 fingerprint 적용 후 유지" (L1108-1118), but:
- The function name itself (`applyPendingSwitchIntentIfNeeded`) still implies an "intent" model (apply if needed), while the new semantic is "read log + apply fingerprint"
- No explicit instruction to **rename** or **refactor** the function to match new semantics
- This could confuse implementers into keeping the old "apply and delete" pattern under a new name

**Recommendation**: Add explicit directive: "Rename `applyPendingSwitchIntentIfNeeded_func` → `applyFingerprintFromSwitchLog_func` (or similar) to match new semantic. Old name implies pending intent; new name should reflect log-based fingerprint application."

**Risk**: Implementer keeps old name, old mental model leaks into implementation → accidental deletion of pending-switch.json.

---

#### GAP-2 (MEDIUM): Task 12 depends on Task 8 but Task 9 also depends on Task 12's output

**Location**: Dependency Matrix (L312-329), Task 9 (L1099), Task 12 (L1322)
**Issue**: 
- Task 9 (L1115-1116) says "Task 12의 `applyFingerprintToStateDb_func` 호출"
- Task 12 (L1341-1347) says "Switch 흐름 2단계 위치: applyPendingSwitchIntentIfNeeded_func (startup consumer)"
- Task 9 is Wave 3a, Task 12 is also Wave 3a → they run in **parallel**
- But Task 9's code needs to **call** `applyFingerprintToStateDb_func` which is **defined in Task 12**

If Task 12 hasn't created `applyFingerprintToStateDb_func` yet, Task 9 can't call it.

**Current Dependency Matrix says**:
- Task 9 depends on: Tasks 3, 4, 6, 8, 13 (L324)
- Task 12 depends on: Task 8 (L325)

Missing: Task 9 depends on Task 12 (for `applyFingerprintToStateDb_func`)

**Recommendation**: Either:
(a) Add Task 12 as dependency of Task 9 → Task 9 moves to Wave 3b (after Task 12), OR
(b) Task 9 defines a **stub/interface** for `applyFingerprintToStateDb_func` that Task 12 implements, with explicit note that the actual implementation comes from Task 12

Option (a) is simpler and safer. This changes the Wave structure:
- Wave 3a: Task 12 only (fingerprint first)
- Wave 3b: Task 9 (main.ts integration, calls fingerprint)

**Risk**: If both run parallel, Task 9 may reference a non-existent function → compilation error → build break.

---

#### GAP-3 (LOW): `authInject.ts` reference potentially stale

**Location**: Task 12 (L1338-1340)
**Issue**: Task 12 says: "기존 `injectAuthToStateDb_func`의 `serviceMachineId?: string` 파라미터에 fingerprint.machineId 값을 전달하도록 호출부 수정 (파라미터 자체는 이미 L144에 존재)"

The plan states the parameter already exists (L144) and is already implemented (L188-191). This means Task 12 only needs to modify the **call site** to pass the fingerprint value, not the function itself. However:
- No explicit verification that L144/L188-191 references are accurate
- If the line numbers have shifted since plan writing, the implementer would need to re-verify

**Recommendation**: Add note: "Implementer MUST verify line numbers at time of implementation. If `serviceMachineId` parameter doesn't exist, add it to `injectAuthToStateDb_func` signature."

**Risk**: Low. Line numbers are naturally fragile. The intent is clear enough.

---

### 2.2 Cross-Task Consistency Issues: 0 found ✅

All task descriptions are internally consistent:
- Task 8 output (switch + pending-switch.json) feeds into Task 12 input (fingerprint apply from switch log)
- Task 12 output (applyFingerprintToStateDb_func) is referenced correctly by Task 9
- Wake-up 4 timings in Task 6 match handoff [W] sections
- Account Card schema (Task 1) matches SC-3

### 2.3 Spec Completeness vs Handoff: PASS ✅

| Handoff Section | Plan Coverage | Notes |
|----------------|--------------|-------|
| [1] auth refresh / list separation | Tasks 3, 4 | ✅ |
| [1-2] reset 시각 99% 보정 | SC-9 | ✅ Already implemented |
| [1-3] 오래된/불확실한 id | Task 4 | ✅ |
| [2] account card 저장 | Task 1 | ✅ |
| [3] rotate 미선판단 | SC-5, Task 7 | ✅ |
| [4] post-response quota 재조회 | Task 7 | ✅ |
| [5] effectiveFamily 기본 CLAUDE | Task 2 | ✅ |
| [6] crossing 판단 (pre/post 비교) | SC-5, SC-6, Task 7 | ✅ |
| [7] bucket 영속화 | SC-6, Task 1 | ✅ |
| [8] 후보 선정 규칙 | SC-8 | ✅ |
| [9] switch 즉시 + pending-switch.json | SC-7, Task 8 | ✅ |
| [W] wake-up 타이밍 4개 | SC-11, Tasks 5, 6 | ✅ |
| Fingerprint 자동화 | SC-13, Task 12 | ✅ |
| Offline-Gateway 최소 동작경로 | SC-14, Task 13 | ✅ |
| 90% reset 제거 | SC-12, Task 2 | ✅ |
| serviceMachineId 맞춤 | Task 12 | ✅ |

### 2.4 Mandate Compliance: PASS ✅

| Mandate Requirement | Plan Coverage |
|--------------------|--------------|
| spec + plan 통합 문서 | ✅ Single document with Spec section + TODOs |
| 성공조건 포함 | ✅ SC-1 through SC-14 |
| 파일/모듈 단위 checklist | ✅ Each task specifies files |
| 당장 구현 가능한 수준 | ✅ Each task has "What to do" with code snippets |
| 90% reset 폐기 | ✅ Task 2 |
| effectiveFamily CLAUDE | ✅ Task 2 |
| pending-switch.json = 적용 기록 | ✅ SC-7, Task 8 |
| wake-up = LS 1턴 | ✅ Task 5 (open Antigravity + poll state.vscdb) |
| auth list = selective refresh | ✅ Task 4 |
| fingerprint 포함 | ✅ Task 12 |
| Offline-Gateway 포함 | ✅ Task 13 |
| 정책엔진/YAML = NOT NOW | ✅ Must NOT Have section |

---

## 3. Summary

### Overall Verdict: **PASS with 2 medium recommendations**

| Check | Result |
|-------|--------|
| Switch 2-stage consistency (7 locations) | ✅ PASS — all consistent |
| Task 9 ambiguity resolution | ✅ PASS — clear language |
| Handoff consistency | ✅ PASS — all references match |
| New contradictions | ⚠️ 2 medium gaps found |
| Cross-task consistency | ✅ PASS |
| Spec completeness vs handoff | ✅ PASS — 16/16 sections covered |
| Mandate compliance | ✅ PASS — all requirements met |

### Action Items

1. **GAP-1 (MEDIUM)**: Rename `applyPendingSwitchIntentIfNeeded_func` → something matching log-based semantic. Add to Task 9 or Task 12 "What to do".

2. **GAP-2 (MEDIUM)**: Fix dependency: Task 9 should depend on Task 12. Move Task 9 to Wave 3b (after Wave 3a which includes Task 12). Update Dependency Matrix accordingly.

3. **GAP-3 (LOW)**: Add note to Task 12 about verifying line numbers for `authInject.ts`.

### Recommended Wave Structure Update

```
Wave 3a (Fingerprint first — Task 12 must complete before Task 9):
└── Task 12: Fingerprint 자동화 파이프라인

Wave 3b (Main integration — depends on Task 12):
└── Task 9: main.ts 통합 (calls applyFingerprintToStateDb_func from Task 12)

Wave 3c (Edge cases — depends on Task 9):
└── Task 10: 통합 테스트 + 엣지 케이스

Wave 3d (Docs — depends on Task 10):
└── Task 11: README/CHANGELOG 업데이트
```

This adds one more wave but eliminates the parallel-dependency risk between Tasks 9 and 12.

---

## 4. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Function name mismatch causes confusion | Medium | GAP-1 fix (rename function) |
| Task 9 calls non-existent function | Medium | GAP-2 fix (serial dependency) |
| Line number drift in authInject.ts | Low | GAP-3 fix (verify note) |
