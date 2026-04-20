# 6차 Plan 검증 지시서 (Metis + Momus 병렬)

## 검증 대상
`.sisyphus/plans/01-plan-v030-auth-rotate.md`

## 5차 Momus REJECT 3건 수정 내용

### Issue 1 — auth list "즉시 표시" vs "갱신 후 표시" 충돌 → 해결
- **수정 위치**: SC-2(L122), Task 4(L601-610)
- **수정 내용**:
  - SC-2를 "3단계 흐름"으로 재기술: (1) 캐시 즉시 렌더링 → (2) 오래된 계정 병렬 갱신 → (3) 재렌더링
  - Task 4 What to do를 3단계로 재구성
  - Acceptance Criteria에 "1단계 캐시 즉시 렌더링이 네트워크 대기 전에 실행됨" 테스트 추가
  - QA Scenarios에 "1단계 캐시 즉시 렌더링" 시나리오 추가
- **해결 원리**: mandate의 "즉시 표시 + selective refresh"와 plan의 "갱신 후 표시"는 모순이 아닌 2단계를 명확히 분리

### Issue 2 — switch/pending-switch 시점 충돌 → 해결
- **수정 위치**: SC-7(L169), Task 8(L969), Task 12(L1275)
- **수정 내용**:
  - SC-7을 "3단계 Switch 흐름"으로 재기술:
    - 1단계 (현재 세션 post-response): rotate 판단 즉시 → pending-switch.json 작성 + accounts.json 변경
    - 2단계 (다음 실행 startup): pending-switch.json 소비 → 계정 전환 확정
    - 3단계 (다음 실행 startup): fingerprint load → state.vscdb 적용
  - Task 8에 Switch 흐름 요약 다이어그램 추가
  - Task 8에서 "다음 실행부터 적용" = **계정 전환의 시점** (LS 재시작 필요)임을 명시
  - Task 12에서 fingerprint 적용이 Switch 흐름 3단계에 위치함을 명시
- **해결 원리**: "다음 실행부터 적용"은 계정 전환 시점, post-prompt rotate 판단은 현재 세션에서 즉시, fingerprint는 startup에서 자동

### Issue 3 — Task 13 QA 반환 shape 불일치 → 해결
- **수정 위치**: Task 13 QA(L1467-1475), Acceptance Criteria(L1456)
- **수정 내용**:
  - Expected Result를 실제 API shape에 맞게 수정:
    - 기존: `gemini_used, claude_used` (존재하지 않는 필드)
    - 수정: `UserStatusSummary.familyQuotaSummaries: ModelFamilyQuotaSummary[]` ({familyName, remainingPercentage, exhausted, resetTime})
  - Acceptance Criteria에 shape 검증 추가: "반환값의 각 항목이 familyName, remainingPercentage, exhausted, resetTime 포함"
  - 테스트 카운트 5+ → 6+ 로 증가

## 검증 요청
1. 수정된 3개 이슈가 Momus의 차단 사유를 완전히 해소했는지 확인
2. 수정으로 인해 새로운 모순이나 누락이 발생했는지 확인
3. 나머지 plan 내용과의 일관성 확인

## mandate (참조)
`.sisyphus/mandate_v030-spec-plan.md`
