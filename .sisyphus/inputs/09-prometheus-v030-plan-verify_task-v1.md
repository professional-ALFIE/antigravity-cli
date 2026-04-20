# Metis + Momus 검증 지시사항

## 검증 대상
`.sisyphus/plans/01-plan-v030-auth-rotate.md`

## 검증 목적
v0.3.0 auth rotate + wake-up plan 문서의 품질을 검증합니다.

## Metis 검증 포인트
1. 빠진 맥락이 없는지 (codebase와 일치하는 라인 번호, 함수명, 파일 경로)
2. 각 Task의 References에 명시된 라인 번호가 실제 코드에 존재하는지
3. 성공조건 SC-1~SC-12가 모든 Must Have 항목을 커버하는지
4. Dependency Matrix에 순환 의존성이 없는지
5. 각 Task의 Acceptance Criteria가 구체적이고 검증 가능한지
6. Guardrails(Must NOT Have)가 코드베이스 실제 상태와 충돌하지 않는지

## Momus 검증 포인트
1. 파일 참조 정확성 — 모든 라인 번호가 실제 파일에 존재하는지
2. Task별 acceptance criteria가 빠짐없이 있는지
3. QA Scenarios가 구체적인지 (selector, data, assertion, evidence path)
4. 성공조건이 GIVEN/WHEN/THEN 형식이고 검증 가능한지
5. 의존성이 올바른지 (순환 없음, 누락 없음)
6. Guardrails가 실행 에이전트에게 충분히 명확한지

## 출력
결과를 `.sisyphus/outputs/`에 파일로 저장하세요.
파일명 규칙: `{nn}_{agent_name}_v030-plan-verify_{task_id}.md`
