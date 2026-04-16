# 5차 검증 요청: v0.2.1 Auth Overhaul Spec

## 검증 대상
`.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`

## 4차 검증 결과
- **Metis 4차**: ⚠️ CONDITIONAL — 1 CRITICAL(F1), 3 WARNING(F2~4), 4 INFO
- **Momus 4차**: ❌ REJECT — 3 blocking issues

## 이번 수정 내용 (총 13건)

### Metis CRITICAL/WARNING 해결 (5건)
1. **F1 CRITICAL**: §4-3에 refresh_token 획득 경로 명시 (uss-oauth에서 추출 또는 최초 API 호출 시 획득). L-8 기대치도 access_token 존재로 수정, refresh_token은 nullable.
2. **F2**: §7-3 step 5a에서 "Full Switch 경로" → "§5-3과 동일한 inject payload"로 변경. §8-4에 wake-up 예외 문구 추가.
3. **F3**: W-1에 authInject spy 검증 추가 (호출 1회 + 인자 확인).
4. **F4**: §6-5에 stale intent 삭제 타이밍 명시 ("CLI 시작 시 첫 번째 확인 단계에서 즉시").
5. **INFO 2건**: §7-3에 current_account_id side effect 명시 + cooldown prose 보강.

### Momus Blocking 해결 (8건)
6. **Block 1**: E2E-4에서 wake-up 트리거를 "메시지 전송 경로에서 자동"으로 고정. "수동" 경로 제거.
7. **Block 2**: E2E-3에 구체 mock mechanism 명시 (`QUOTA_MOCK_DIR` 환경변수 + fixture 파일).
8. **Block 3**: R-1~R-6, W-2~W-5, SS-1, SS-3, NF-1~NF-4 전면 구체화 (총 16개 항목).

## 검증 요청사항

### Momus에게
- F1(refresh_token gap)이 해결되었는지
- E2E-3/4가 이제 실행 가능한지
- 이전에 지적한 **모든** QA 항목(R-1~6, W-2~5, SS-1~3, NF-1~4)이 구체화되었는지
- 전체 spec의 섹션 간 모순, 파일 레퍼런스, 실행 가능성 종합 재확인

### Metis에게
- F1~F4 모두 해결되었는지
- §4-3 재작성 + §7-3 용어 정리로 새로운 모순이 생겼는지
- 전체 spec 일관성 재확인
