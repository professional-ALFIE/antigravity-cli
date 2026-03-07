import type { RouteHandler } from '../router';
import { sendJson } from '../router';

/** GET /api/health → 서버 상태 확인 */
export const handleHealth: RouteHandler = async (_req, res, _sdk, _segments) => {
  sendJson(res, 200, { success: true, uptime: process.uptime() });
};
