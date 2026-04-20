# Metis + Momus 2차 검증 지시사항

## 검증 대상
`.sisyphus/plans/01-plan-v030-auth-rotate.md`

## 1차 검증에서 지적된 문제 및 수정 내역
1. ✅ **함수명 수정**: `fetchQuotaForAllAccountsBatched_func` → `fetchQuotaForAccounts_func` (실제 함수명)
2. ✅ **Wave 분리**: Wave 1 → Wave 1a (T1,T2) + Wave 1b (T3,T4)
3. ✅ **Task 5 참조 수정**: authLogin.ts 부정확한 참조 제거 → AGENTS.md 기반 신규 구현 가이드 추가
4. ✅ **Tasks 3-11 QA Scenarios 추가**: 모든 Task에 최소 2개 이상 QA Scenario 블록 추가
5. ✅ **E6 누락 수정**: E6 (Live LS 실행 중 wake-up skip) 추가
6. ✅ **Task 3 AC 보완**: forceRefreshAllQuotas_func 60s cache TTL 무시 검증 항목 추가

## 2차 검증 포인트
1. 위 6개 수정사항이 정확히 반영되었는지
2. 1차 검증에서 발견된 문제가 모두 해결되었는지
3. 새로운 문제가 발생하지 않았는지
4. QA Scenarios가 모든 Task에 구체적으로 포함되었는지 (tool, steps, expected result, evidence path)

## 출력
결과를 `.sisyphus/outputs/`에 파일로 저장하세요.
파일명: `{nn}_{agent_name}_v030-plan-reverify_task-v2.md`
nn은 outputs 폴더의 기존 가장 큰 번호 + 1이다.
