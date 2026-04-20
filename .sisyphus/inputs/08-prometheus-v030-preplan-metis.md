# v0.3.0 통합 spec+plan 사전 갭 점검

먼저 `.sisyphus/mandate_v030-spec-plan.md`와 `.sisyphus/drafts/v030-spec-plan.md`를 읽어라.

그 다음 아래 문서를 검토해라.
- `handoff-plan-spec/v0.3.0-01-handoff.md`
- `.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`
- 현재 코드 기준 핵심 파일:
  - `src/services/accounts.ts`
  - `src/services/authList.ts`
  - `src/services/quotaClient.ts`
  - `src/services/rotate.ts`
  - `src/services/wakeup.ts`
  - `src/services/authInject.ts`
  - `src/services/authLogin.ts`
  - `src/services/oauthClient.ts`

## 목적
이제 곧 `.sisyphus/plans/01-plan-v030-spec-plan.md`를 작성할 예정이다.
작성 전에, 아래 항목을 점검해서 **빠질 수 있는 중요한 갭**만 지적해라.

## 꼭 검토할 것
1. handoff의 핵심 정책 중 문서에서 빠지기 쉬운 것
2. 현재 코드와 충돌하는데 문서에서 덮어써야 하는 것
3. success criteria에서 빠지면 안 되는 항목
4. NOT NOW에 명시해야 하는 항목
5. 구현 checklist가 추상적으로 흐를 위험 지점
6. 사용자 요구("빠진 맥락 절대 금지", "성공조건 필수", "바로 구현 가능한 checklist")를 어길 수 있는 부분

## 출력 형식
- 아주 간결하게.
- 섹션은 `Critical Gaps`, `Minor Gaps`, `Recommended Defaults` 세 개만 사용.
- 각 항목은 불릿으로 1~2문장.
- 파일 수정은 하지 마라.
