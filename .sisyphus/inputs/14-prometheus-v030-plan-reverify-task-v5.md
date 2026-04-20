# v0.3.0 Plan 5차 검증 (fingerprint + Offline-Gateway 추가 후)

## 검증 대상
- `.sisyphus/plans/01-plan-v030-auth-rotate.md`
- 기존 11 Tasks (4차 검증 통과) + 신규 Task 12 (fingerprint) + Task 13 (Offline-Gateway)

## 변경 내용 요약
1. **Task 12 (Fingerprint 자동화 파이프라인)** 신규 추가
   - `src/services/fingerprint.ts` 신규: generateSystemFingerprint_func, loadFingerprint_func, applyFingerprintToStateDb_func, bindFingerprintToAccount_func
   - `authLogin.ts` 수정: 로그인 완료 후 fingerprint 자동 생성
   - `authInject.ts` 수정: serviceMachineId 파라미터 추가
   - `main.ts` 수정: switch 경로에 fingerprint 적용
   - cockpit fingerprint.rs 로직을 TypeScript로 copy-paste 수준 이식
   - Wave 3a에서 Task 9와 병렬 실행
   - 의존: Task 8 (switch 실행 구조 확정)
   - 차단: Task 10

2. **Task 13 (Offline-Gateway 최소 동작경로)** 신규 추가
   - `src/services/quotaFastPath.ts` 신규: readQuotaFromStateDb_func, readQuotaFromLiveLs_func, getQuotaFastPath_func
   - `quotaClient.ts` 수정: fast-path 우선 시도 → 실패 시 cloud API fallback
   - `authList.ts` 수정: fast-path 결과를 card에 캐시
   - state.vscdb에서 직접 quota 읽기 (LS spawn 없이)
   - Wave 1b에서 Task 3, 4와 병렬 실행
   - 의존: Task 1 (AccountDetail)
   - 차단: Task 9

3. **기존 항목 수정**
   - Must NOT Have: "Offline-Gateway 구현 금지" → "v0.3.0에 최소 동작경로 포함"
   - Must NOT Have: "Device Fingerprint NOT NOW" → "fingerprint 자동화는 Task 12로 포함"
   - Task 8 Blocks: Task 9 → Task 12 (fingerprint inject), Task 9
   - TL;DR: fingerprint + Offline-Gateway 추가, Effort XL로 상향, 8 waves로 확장
   - Definition of Done: fingerprint + Offline-Gateway 성공조건 2줄 추가
   - SC-13 (fingerprint), SC-14 (Offline-Gateway) 성공조건 추가
   - Wave 구조: 1b에 T13 추가, 3a에 T12 추가
   - Dependency Matrix: T12, T13 행 추가
   - Commit Strategy: 2개 commit 추가
   - Success Criteria: 2줄 추가 + auth list에 fast-path 명시

## 검증 요청사항
1. Task 12와 Task 13의 References가 실제 존재하는 파일/라인을 가리키는지
2. Wave 배치가 올바른지 (의존성 위반 없는지)
3. Dependency Matrix가 실제 Task 내용과 일치하는지
4. Must NOT Have 업데이트가 일관성 있는지
5. 기존 11 Tasks에 영향을 주는 변경이 없는지
6. SC-13, SC-14가 구현 검증 가능한 성공조건인지
7. Commit Strategy가 새 Task를 정확히 반영하는지
