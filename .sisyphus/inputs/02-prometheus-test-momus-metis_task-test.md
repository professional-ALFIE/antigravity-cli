# 테스트 소환 — Momus & Metis 병렬 검증 테스트

## 목적
Momus와 Metis 에이전트가 정상적으로 소환되고 output 파일을 생성하는지 확인한다.

## 지시사항
- 각 에이전트는 자신의 역할(Momus: 비평가, Metis: 사전분석가)에 맞게 간단한 응답을 작성할 것.
- 이것은 **테스트 소환**이므로, 특정 계획 파일 검증이 아닌 "소환 가능 여부 + output 파일 생성" 확인이 목적이다.
- output 파일 경로: `.sisyphus/outputs/{nn}_{agent_name}_test-summon_task-test.md`
- 간결응답 포맷: 구조화된 한줄 + output 파일 경로 명시

## 현재 프로젝트 컨텍스트
- 프로젝트: Antigravity CLI Hybrid Flow (`issue-36-antigravity-headless`)
- 주요 파일: `src/main.ts`, `src/services/*.ts`, `src/utils/*.ts`
- 테스트 프레임워크: bun test
