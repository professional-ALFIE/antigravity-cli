# 7차 Plan 검증 지시서 (Metis + Momus 병렬)

## 검증 대상
`.sisyphus/plans/01-plan-v030-auth-rotate.md`

## 참조 문서 (반드시 읽을 것)
- `handoff-plan-spec/v0.3.0-01-handoff.md` — 원본 handoff 문서
- `handoff-plan-spec/v0.3.0-01-question.md` — handoff 기준 답변
- `.sisyphus/mandate_v030-spec-plan.md` — mandate

## 6차 Momus REJECT 수정 내용

### 핵심 수정: Switch 흐름을 3단계 → 2단계로 재정의

기존 3단계에서 2단계가 충돌하고 있었음:
- SC-7/Task 8은 "다음 실행 startup에서 계정 전환" (2단계)
- Task 9는 "startup consumer 제거/skip" (2단계 부정)

**해결**: 계정 전환(accounts.json 변경)은 이미 1단계(post-response)에서 즉시 완료. startup에서는 fingerprint 적용만.

**수정 위치**:
- SC-7(L170): "3단계" → "2단계"로 재기술. 1단계=즉시 전환+기록, 2단계=startup fingerprint 적용
- Task 8(L989): Switch 흐름 요약 다이어그램 2단계로 축소. "계정 전환은 1단계에서 즉시 완료" 명시
- Task 9(L1102): "제거하거나 skip" → "읽고 fingerprint 적용만 수행, 파일은 log로 유지"로 명확화
- Task 9 References: "제거/수정 대상" → "소비 후 삭제 → 읽고 fingerprint 적용 후 유지"로 변경
- Task 12(L1331): "3단계" → "2단계"로 수정

**handoff 문서와의 일관성 확인 포인트**:
- handoff [9](L83-89, L351-365): "그 시점에 바로 switch를 수행하고, 그 결과를 pending-switch.json에 기록" → 1단계에서 즉시 switch + 기록. 일치.
- handoff [9] L352-353: "다음 [3]이 시작될 때 이 메모를 먼저 적용하고, 실제 switch 시에는 auth와 함께 그 계정에 묶인 fingerprint도 같이 맞춘다" → startup에서 fingerprint 적용. 일치.
- mandate L22: "pending-switch.json은 적용 기록" → log로 유지. 일치.
- mandate L29: "post-prompt rotate는 같은 실행 안에서 즉시 적용" → 1단계에서 즉시. 일치.

## 검증 요청
1. Switch 흐름이 문서 전체(SC-7, Task 8, Task 9, Task 12)에서 2단계로 일관되게 기술되었는지
2. handoff 문서와의 일관성
3. Task 9가 더 이상 "제거하거나" 같은 모호한 표현 없이 명확한지
4. 새로운 모순이나 누락이 없는지
