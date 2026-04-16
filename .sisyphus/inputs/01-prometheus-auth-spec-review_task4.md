# Metis + Momus 검증 요청: v0.2.1 Auth Overhaul 통합 Spec

## 검증 대상
`.sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md`

## 검증 컨텍스트
- 이 문서는 v0.2.1 Auth Overhaul의 **spec 문서**입니다. 구현 계획이 아닙니다.
- 두 기존 spec (spec-gpt + spec-opus)의 장점을 병합 + 주인님 인터뷰 3라운드 합의사항 반영
- Seamless Switch 조사(2026-04-15) 결과가 Feature 5에 반영됨

## Metis에게 요청
1. 누락된 요구사항이 있는가? (주인님이 언급했는데 spec에 빠진 것)
2. 모호한 정의가 있는가? (구현자가 해석 차이로 잘못 구현할 수 있는 것)
3. 모순되는 서술이 있는가? (Feature 간 충돌, 원칙과 본문 충돌)
4. 성공조건이 주장+증명 쌍으로 충분한가? (증명 방법이 구체적인가?)
5. NOT NOW 항목이 적절한가? (빠져야 할 것도 NOT NOW로 미뤄진 것은 아닌지)
6. 마이그레이션 경로가 충분한가? (기존 사용자가 v0.2.0에서 v0.2.1로 무리 없이 전환 가능한지)

## Momus에게 요청
1. 모든 파일 참조가 존재하는가?
2. 성공조건의 증명 방법이 구체적이고 실행 가능한가?
3. 스키마(JSON)가 일관성 있는가?
4. Feature 간 의존성이 구현순서에 올바르게 반영되었는가?

## 출력 규칙
- 결과를 `.sisyphus/outputs/{nn}_{agent_name}_auth-spec-review_{task_id}.md`에 저장
- 파일에 상세 내용, output은 구조화된 한줄 + 파일 경로
