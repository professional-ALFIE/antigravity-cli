**[REJECT]**
**Summary**: 레퍼런스와 대부분의 작업/QA 시나리오는 바로 착수 가능한 수준이지만, switch와 pending-switch 흐름이 문서 안에서 두 가지로 충돌합니다. 이 핵심 흐름이 정리되지 않으면 Task 8, Task 9, Task 12를 일관되게 구현할 수 없습니다.

**Blocking Issues**
1. .sisyphus/plans/01-plan-v030-auth-rotate.md:170-182, 989-1018, 1330-1334는 pending-switch를 다음 실행 startup consumer가 이어받는 흐름으로 설명하지만, 같은 문서 1102-1108은 pending-switch.json을 이미 적용된 기록(log)으로 두고 applyPendingSwitchIntentIfNeeded_func를 제거/skip하라고 지시합니다. 여기에 mandate_v030-spec-plan.md:22,29와 handoff-plan-spec/v0.3.0-01-handoff.md:83-89, 351-365도 pending-switch를 “즉시 switch 후 남기는 적용 기록”으로 고정합니다. switch가 응답 직후 same-run으로 끝나는지, 아니면 다음 실행 startup에서 최종 적용되는지 하나로 고정하고, SC-7/Task 8/Task 9/Task 12/QA를 모두 같은 흐름으로 맞춰야 합니다.
