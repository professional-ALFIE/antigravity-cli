# v0.3.0 통합 spec+plan 재검증 요청

먼저 아래 파일을 읽어라.
- `.sisyphus/mandate_v030-spec-plan.md`
- `.sisyphus/drafts/v030-spec-plan.md`
- `.sisyphus/plans/01-plan-v030-spec-plan.md`

## 이번 라운드 목적
이전 검토에서 나온 지적을 반영해 문서를 수정했다.
이번에는 아래 항목이 실제로 해소되었는지만 엄격하게 봐라.

## 특히 볼 것
1. rotate 타이밍이 문서 전체에서 일관적인가
2. checklist의 각 task에 QA 시나리오가 실제로 붙었는가
3. `seamlessSwitch.ts` 누락이 해소되었는가
4. `rotate.ts`의 90% reset / `needs_reauth` / `PendingSwitchIntent` 스키마 변경 지시가 충분히 구체적인가
5. `auth refresh` 진입점, `auth list` selective refresh helper, migration/cutover, Offline-Gateway 최소동작경로, secret boundary가 checklist에서 구현 가능한 수준까지 내려왔는가

## 출력 규칙
- 파일 수정 금지
- 한국어로 작성
- 아래 3개 섹션만 사용
  - `Critical Issues`
  - `Minor Issues`
  - `Approved Decisions`
- 판단이 통과면 Critical Issues를 비워도 된다.
