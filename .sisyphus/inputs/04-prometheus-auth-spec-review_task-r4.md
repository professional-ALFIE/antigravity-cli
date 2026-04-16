# 6차 검증 요청: v0.2.1 Auth Overhaul Spec

## 검증 대상
`.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`

## 5차 검증 결과
- **Metis 5차**: ✅ PASS — 0 CRITICAL, 0 WARNING, 3 INFO
- **Momus 5차**: ❌ REJECT — 2 blocking issues

## Momus 5차 Blocker 및 해결 내용

### Block 1: refresh_token 없이 Google OAuth refresh flow 수행 불가
- **지적**: §4-3에서 refresh_token 없이 "Google OAuth refresh flow로 refresh_token 획득"은 기술적으로 불가능
- **해결**: refresh_token 미포함 시 account_status를 "needs_reauth"로 설정. 이 계정은 quota 조회 불가, rotate/wake-up 대상에서 제외. 사용자에게 "agcl auth login으로 재로그인 필요" 안내.
- **영향 범위**:
  - §4-3(130~136행): 5b 경로를 needs_reauth로 재작성
  - §4-5 blockquote(141~144행): "최초 API 호출 시 획득" 문구 제거, needs_reauth 상태로 변경
  - §9-2(525~534행): 5-state enum으로 확장 (needs_reauth 추가)
  - §5-3(213~216행): needs_reauth 계정 inject 시 사전 차단 추가
  - §6-6(351~357행): rotate 대상에서 needs_reauth 제외 추가
  - §7-3(406행): wake-up 대상에서 needs_reauth 제외 추가
  - §12(666행): "4-state" → "5-state enum" 수정
  - L-8(167행): "최초 API 호출 시 획득" → needs_reauth 상태로 검증하도록 재작성

### Block 2: L-2~L-7, A-3, A-4, A-7, NF-5 구체화 부족
- **지적**: 여전히 "cat으로 확인", "테스트", "DB 확인" 수준
- **해결 상태**: 5차 수정에서 이미 구체화 완료
  - L-2: `cat` + `jq`로 5단계 절차 + 기대 결과 명시
  - L-3: `cat` + `jq`로 3단계 절차 + 기대 결과 명시
  - L-4: `bun test` + mock timer로 4단계 절차 + 기대 결과 명시
  - L-5: `bun test` + mock HTTP로 4단계 절차 + 기대 결과 명시
  - L-6: `bun test` + mock으로 4단계 절차 + 기대 결과 명시
  - L-7: `bun test` + 환경 변수로 4단계 절차 + 기대 결과 명시
  - A-3: `bun test` + mock으로 6단계 절차 + 기대 결과 명시
  - A-4: `bun test` + `sqlite3`으로 5단계 절차 + 기대 결과 명시
  - A-7: `bun test`로 5단계 절차 + 기대 결과 명시
  - NF-5: `bun test` + mock + `performance.now()`로 8단계 절차 + 기대 결과 명시

## 검증 요청사항

### Momus에게
- Block 1: refresh_token 불가능 경로가 needs_reauth 상태로 해결되었는지
- Block 2: L-2~L-7, A-3, A-4, A-7, NF-5가 이제 실행 가능한 수준인지
- 5-state enum 도입으로 spec 전체에 새 모순이 없는지
- §5-3, §6-6, §7-3에 needs_reauth 제외가 정확히 반영되었는지

### Metis에게
- Metis 5차에서 PASS했으나, 이후 needs_reauth 도입 + L-8 재작성으로 새 모순이 없는지
- §9-2의 5-state enum이 모든 Feature에서 정합하게 사용되는지
- §5-3의 0단계(needs_reauth 차단)가 다른 섹션과 충돌하지 않는지
- §4-3 blockquote와 L-8 테스트가 동일한 계약을 기술하는지
