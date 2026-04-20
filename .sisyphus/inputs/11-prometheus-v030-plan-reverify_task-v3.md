# 3차 Plan 검증 지시사항

## 검증 대상
`.sisyphus/plans/01-plan-v030-auth-rotate.md`

## 이전 검증 결과 요약
- **Metis 2차**: ✅ APPROVE (4.5/5) — 3개 minor issue (LOW/INFO)
- **Momus 2차**: ❌ REJECT — 3건 blocking issue

## 이번 수정 내역 (v3 변경사항)

### 1. F1-F4 Final Verification Wave에 QA Scenarios 추가
- 기존: F1-F4가 빈 체크박스 + 한 줄 설명만 있었음
- 수정: 각 F1~F4에 상세 QA Scenarios 추가 (tool/steps/expected/evidence 전부 포함)
  - F1: Must Have/N audit, Must NOT Have 금지 패턴 검사, Evidence 파일 존재 확인
  - F2: 전체 테스트, 코드 품질 (as any/@ts-ignore/console.log), TypeScript 컴파일
  - F3: 크로스태스크 통합 (auth refresh→list, 프롬프트→rotate), 엣지 케이스 (빈 상태, 네트워크 불가)
  - F4: Task별 spec 1:1 매칭, Must NOT do 준수, Cross-task contamination, Unaccounted changes

### 2. Wave 3을 sub-wave로 분리
- 기존: Wave 3에 T9→T10→T11이 같은 wave에 있었음 (T10이 T9에 의존, T11이 T10에 의존)
- 수정: Wave 3a (T9) → Wave 3b (T10) → Wave 3c (T11)로 분리
- Dependency Matrix, Agent Dispatch Summary, TL;DR wave 수 모두 업데이트

### 3. Metis minor 3건 수정
- `writeAccountDetailSync_func` → `writeAccountDetail_func` (실제 함수명)
- `decideAutoRotate_func` 라인 `30-158` → `72-158` (실제 시작 라인)
- `authLogin_func` 범위 `343-399` → `343-492` (실제 끝 라인)

## 검증 요청사항
- Momus: 2차 지적 3건이 모두 해결되었는지 확인
- Metis: 2차 minor 3건이 모두 반영되었는지 + 전체 plan 무결성 재확인
- 양쪽 모두 새로운 문제가 없는지 확인
