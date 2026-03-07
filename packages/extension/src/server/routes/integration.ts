import type { RouteHandler } from '../router';
import { sendJson, parseJsonBody } from '../router';

/**
 * /api/integration/...
 *
 * POST /install           → integration.install()
 * POST /signal-active     → integration.signalActive()
 * POST /auto-repair       → integration.enableAutoRepair()
 * POST /add-button        → integration.addTopBarButton(...)
 */
export const handleIntegration: RouteHandler = async (req, res, sdk, segments) => {
  const action = segments[0] ?? '';

  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return;
  }

  switch (action) {
    case 'install': {
      await sdk.integration.install();
      sendJson(res, 200, { success: true });
      return;
    }
    case 'signal-active': {
      await sdk.integration.signalActive();
      sendJson(res, 200, { success: true });
      return;
    }
    case 'auto-repair': {
      await sdk.integration.enableAutoRepair();
      sendJson(res, 200, { success: true });
      return;
    }
    case 'add-button': {
      const body = (await parseJsonBody(req)) as Record<string, unknown>;
      const id = body['id'] as string;
      const icon = body['icon'] as string;
      const tooltip = body['tooltip'] as string;
      if (!id || !icon || !tooltip) {
        sendJson(res, 400, { success: false, error: 'Missing id, icon, or tooltip' });
        return;
      }
      const popup = body['popup'] as string | undefined;
      await sdk.integration.addTopBarButton(id, icon, tooltip, popup);
      sendJson(res, 200, { success: true });
      return;
    }
  }

  sendJson(res, 404, { success: false, error: `Unknown integration action: ${action}` });
};
