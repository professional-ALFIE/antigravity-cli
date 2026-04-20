**[REJECT]**
**Summary**: 이 계획은 대부분 실행 가능하지만, 현재 기준으로는 auth list 동작과 switch 적용 시점이 상위 mandate 및 내부 task들 사이에서 충돌하고, Task 13의 QA 시나리오도 실제 API shape와 맞지 않아 Final Verification Wave를 그대로 실행할 수 없습니다.

**Blocking Issues**
1. `mandate_v030-spec-plan.md:23-24`는 auth list를 "즉시 표시 + 필요한 계정만 selective refresh"로 고정하지만, 계획은 `.sisyphus/plans/01-plan-v030-auth-rotate.md:47`, `122-130`, `601-608`에서 "선택적 갱신 후 전체 표시"를 요구합니다. `auth list`가 먼저 캐시를 즉시 렌더링하는지, 아니면 stale 계정 refresh 완료 후 한 번만 그리는지 하나로 고정해야 Task 4와 Task 9 및 QA를 구현할 수 있습니다.
2. switch/pending-switch semantics가 충돌합니다. Mandate는 `mandate_v030-spec-plan.md:22,29`에서 `pending-switch.json`을 적용 기록으로 두고 post-prompt rotate를 같은 실행 안에서 즉시 적용하라고 하지만, 계획은 `.sisyphus/plans/01-plan-v030-auth-rotate.md:34,48,169-177,969-979`에서 "다음 실행부터 적용"을 요구하고, `1273-1295`에서는 `applyPendingSwitchIntentIfNeeded_func` startup consumer에 fingerprint 적용을 붙이려 합니다. switch가 post-response 시점에 즉시 끝나는지, 다음 실행 startup consumer가 계속 필요한지, fingerprint는 어느 경로에서 적용되는지 단일 흐름으로 정리해야 합니다.
3. Task 13 QA가 구현 설명과 맞지 않습니다. 계획은 `.sisyphus/plans/01-plan-v030-auth-rotate.md:1396-1405`에서 `stateVscdb.extractUserStatusSummary_func()` 기반 fast-path를 쓰겠다고 하지만, QA는 `1467-1475`에서 반환 객체에 `gemini_used`, `claude_used` 필드가 있다고 검증합니다. 현재 reference API는 family summary shape를 반환하므로, Task 13 QA와 acceptance를 실제 반환 구조에 맞게 고쳐야 Final Verification Wave가 실행 가능합니다.
