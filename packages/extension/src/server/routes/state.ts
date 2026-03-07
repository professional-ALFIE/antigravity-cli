import type { RouteHandler } from '../router';
import { sendJson } from '../router';

/**
 * /api/state/...
 *
 * GET  /          → state.getAll()
 * GET  /:key      → state.get(key)
 */
export const handleState: RouteHandler = async (req, res, sdk, segments) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return;
  }

  const key = segments[0];

  if (!key) {
    const allState = await sdk.state.getAll();
    sendJson(res, 200, { success: true, data: allState });
    return;
  }

  const value = await sdk.state.get(key);
  sendJson(res, 200, { success: true, data: { key, value } });
};
