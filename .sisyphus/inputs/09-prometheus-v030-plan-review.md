# v0.3.0 통합 spec+plan 검증 요청

먼저 아래 파일을 읽어라.
- `.sisyphus/mandate_v030-spec-plan.md`
- `.sisyphus/drafts/v030-spec-plan.md`
- `.sisyphus/plans/01-plan-v030-spec-plan.md`

## 목적
현재 작성된 `.sisyphus/plans/01-plan-v030-spec-plan.md`가 다음 요구를 만족하는지 검증해라.

## 요구
1. `handoff-plan-spec/v0.3.0-01-handoff.md`의 맥락이 빠지지 않았는가
2. spec에 성공조건이 충분히 들어갔는가
3. plan checklist가 파일/모듈 단위로 당장 구현 가능한 수준인가
4. `pending-switch.json`, wake-up, post-prompt rotate, fingerprint/login, serviceMachineId, Offline-Gateway 최소동작경로가 제대로 반영되었는가
5. `NOT NOW`가 과도하거나 부족하지 않은가

## 출력 규칙
- 파일 수정 금지
- 결과는 한국어
- 아래 3개 섹션만 사용
  - `Critical Issues`
  - `Minor Issues`
  - `Approved Decisions`
- 각 항목은 짧고 직접적으로 쓸 것
