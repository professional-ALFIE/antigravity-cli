import type { RouteHandler } from '../router';
import { sendJson } from '../router';
import { getStatus, revertAll, autoApply } from '../../auto-run';

/**
 * /api/auto-run/...
 *
 * GET  /status  → 패치 상태 확인
 * POST /revert  → 원본 복원
 * POST /apply   → 수동 패치 적용
 */
export const handleAutoRun: RouteHandler = async (_req, res, _sdk, segments) => {
  const action_var = segments[0] ?? '';
  const method_var = _req.method ?? 'GET';

  if (method_var === 'GET' && action_var === 'status') {
    const status_var = await getStatus();
    sendJson(res, 200, { success: true, data: status_var });
    return;
  }

  if (method_var === 'POST' && action_var === 'revert') {
    const results_var = await revertAll();
    sendJson(res, 200, { success: true, data: results_var });
    return;
  }

  if (method_var === 'POST' && action_var === 'apply') {
    const results_var = await autoApply();
    sendJson(res, 200, { success: true, data: results_var });
    return;
  }

  sendJson(res, 404, { success: false, error: `Unknown auto-run action: ${action_var}` });
};
