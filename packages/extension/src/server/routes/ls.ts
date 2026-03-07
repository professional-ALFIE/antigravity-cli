import type { RouteHandler } from '../router';
import { sendJson, parseJsonBody } from '../router';

/**
 * /api/ls/...  (핵심 경로 — 헤드리스 Cascade)
 *
 * POST /create           → ls.createCascade({ text, model })
 * POST /send/:id         → ls.sendMessage({ cascadeId, text, model })
 * POST /focus/:id        → ls.focusCascade(cascadeId)
 * GET  /list             → ls.listCascades()
 * GET  /user-status      → ls.getUserStatus()
 */
export const handleLs: RouteHandler = async (req, res, sdk, segments) => {
  const action = segments[0] ?? '';
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    switch (action) {
      case 'list': {
        const cascades = await sdk.ls.listCascades();
        sendJson(res, 200, { success: true, data: cascades });
        return;
      }
      case 'user-status': {
        const status = await sdk.ls.getUserStatus();
        sendJson(res, 200, { success: true, data: status });
        return;
      }
    }
  }

  if (method === 'POST') {
    const body = (await parseJsonBody(req)) as Record<string, unknown>;

    switch (action) {
      case 'create': {
        const text = body['text'] as string;
        if (!text) {
          sendJson(res, 400, { success: false, error: 'Missing "text"' });
          return;
        }
        const model = body['model'] as number | undefined;
        const result = await sdk.ls.createCascade({ text, model });
        sendJson(res, 200, { success: true, data: result });
        return;
      }
      case 'send': {
        const cascadeId = segments[1];
        if (!cascadeId) {
          sendJson(res, 400, { success: false, error: 'Missing cascade ID in path' });
          return;
        }
        const text = body['text'] as string;
        if (!text) {
          sendJson(res, 400, { success: false, error: 'Missing "text"' });
          return;
        }
        const model = body['model'] as number | undefined;
        const result = await sdk.ls.sendMessage({ cascadeId, text, model });
        sendJson(res, 200, { success: true, data: result });
        return;
      }
      case 'focus': {
        const cascadeId = segments[1];
        if (!cascadeId) {
          sendJson(res, 400, { success: false, error: 'Missing cascade ID in path' });
          return;
        }
        await sdk.ls.focusCascade(cascadeId);
        sendJson(res, 200, { success: true });
        return;
      }
    }
  }

  sendJson(res, 404, { success: false, error: `Unknown ls action: ${action}` });
};
