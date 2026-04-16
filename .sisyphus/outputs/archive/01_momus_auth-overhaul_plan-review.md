**[REJECT]**
**Summary**: 레퍼런스들은 실제로 존재하고 auth login/auth list/rotate/wake-up 작업도 시작점은 충분합니다. 다만 wake-up 정의가 내부적으로 충돌하고, 여러 QA 시나리오가 실행 가능한 절차로 닫혀 있지 않아 그대로는 구현자와 검증자가 막힙니다.

**Blocking Issues**
1. .sisyphus/plans/00-plan-v0.2.1-auth-overhaul.md의 §7-3(wake-up 실행 흐름)가 같은 Feature의 목표와 충돌합니다. 1단계는 "active 계정만 로드"인데, §7-1/§7-2/§7-4는 null-quota dormant account들을 계정별로 판정하고 cooldown/forbidden을 관리하는 설계입니다. wake-up이 현재 활성 계정만 대상으로 도는지, 아니면 모든 eligible account를 순회하는지와 그 호출 시점을 하나로 고정해야 구현자가 대상 범위와 상태 저장 범위를 확정할 수 있습니다.
2. 같은 파일의 QA 시나리오 다수가 아직 실행 가능한 검증 절차로 닫혀 있지 않습니다. 예를 들어 L-1/L-8, A-2/A-5, W-1/W-4, E2E-1~E2E-5, S-1~S-4는 "파일 확인", "로그 확인", "E2E", "테스트"처럼 도구·명령·절차·기대 결과가 비어 있어 Final Verification Wave를 바로 수행할 수 없습니다. 각 항목을 bun test/실제 CLI invocation/sqlite3/mock server 등 구체 도구와 단계별 절차, 기대 출력·상태로 다시 써야 합니다.
