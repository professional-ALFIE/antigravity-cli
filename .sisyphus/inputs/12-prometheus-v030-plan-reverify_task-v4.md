# 4차 Plan 검증 지시사항

## 검증 대상
`.sisyphus/plans/01-plan-v030-auth-rotate.md`

## 이전 검증 결과 요약
- **Metis 3차**: ✅ APPROVE (4.7/5) — 모든 minor 수정 확인, 새 이슈 0건
- **Momus 3차**: ❌ REJECT — 3건 blocking issue

## 이번 수정 내역 (v4 변경사항)

### 1. Task 1에 userDataDirPath 버그 수정 명시적 추가
- 기존: Task 5의 Wake-up 구현 가이드에만 "이 수정은 Task 1에 포함"이라고 언급
- 수정: Task 1의 "What to do"에 `discoverAccounts_func` index-backed path 버그 수정 코드를 명시적 추가
  - accounts.ts:468-477의 수정 코드를 인라인으로 포함
  - TDD: accounts.test.ts에 discoverAccounts index-backed path 테스트 추가
- Task 1 Acceptance Criteria에 managed 계정 경로 테스트 추가
- Task 1 QA Scenarios에 discoverAccounts userDataDirPath 검증 시나리오 추가
- Task 1 Commit message에 userDataDirPath fix 반영

### 2. Task 9에 pending-switch.json 의미 전환 처리 명시
- 기존: pending-switch.json을 "소비 후 삭제"하는 기존 코드를 고려하지 않음
- 수정: Task 9 "What to do"에 명시적 섹션 추가
  - 기존 코드(main.ts:1028-1052, 2383-2394)의 startup consumer 처리 설명
  - v0.3.0에서는 파일을 "적용 완료된 switch의 기록"으로 사용
  - 따라서 `applyPendingSwitchIntentIfNeeded_func`을 제거하거나 이미 적용된 것으로 간주하도록 수정
  - 명확한 선택: 파일을 기록(log)으로 유지, 시작 시 이미 적용된 것으로 간주
- Task 9 References에 main.ts:1028-1052, 2383-2394 추가
- Task 9 Acceptance Criteria에 pending-switch.json 기록 파일 동작 테스트 추가

### 3. F1 category를 `oracle` → `deep`으로 변경
- 기존: F1이 `oracle` category (execution plan의 허용 category 목록에 없음)
- 수정: F1을 `deep`으로 변경
  - Wave 구조, Agent Dispatch Summary, F1 task 본문 모두 업데이트

## 검증 요청사항
- Momus: 3차 지적 3건이 모두 해결되었는지 확인
- Metis: v4 수정이 plan 무결성을 유지하는지 확인
- 양쪽 모두 새로운 문제가 없는지 확인
