import type { RouteHandler } from '../router';
import { sendJson, parseJsonBody } from '../router';
import {
  acceptCommandCompat_func,
  acceptStepCompat_func,
  driveCascadeProgress_func,
  getCascadeCapabilities_func,
  rejectStepCompat_func,
  runTerminalCompat_func,
} from '../cascade-driver';

/**
 * /api/cascade/...
 *
 * GET  /sessions           → getSessions()
 * POST /focus              → focusSession(id)
 * POST /send-prompt        → sendPrompt(text)
 * POST /accept-step        → acceptStep()
 * POST /reject-step        → rejectStep()
 * POST /accept-terminal    → acceptTerminalCommand()
 * POST /reject-terminal    → rejectTerminalCommand()
 * POST /run-terminal       → runTerminalCommand()
 * POST /accept-command     → acceptCommand()
 * GET  /capabilities       → bridge step-driving capabilities
 * POST /drive              → best-effort progress driver
 * GET  /preferences        → getPreferences()
 * GET  /diagnostics        → getDiagnostics()
 * GET  /mcp-url            → getMcpUrl()
 * GET  /browser-port       → getBrowserPort()
 * POST /git-ignored        → isFileGitIgnored(path)
 */
export const handleCascade: RouteHandler = async (req, res, sdk, segments) => {
  const action = segments[0] ?? '';
  const method = req.method ?? 'GET';

  // GET 엔드포인트
  if (method === 'GET') {
    switch (action) {
      case 'sessions': {
        const sessions = await sdk.cascade.getSessions();
        sendJson(res, 200, { success: true, data: sessions });
        return;
      }
      case 'preferences': {
        const prefs = await sdk.cascade.getPreferences();
        sendJson(res, 200, { success: true, data: prefs });
        return;
      }
      case 'diagnostics': {
        const diag = await sdk.cascade.getDiagnostics();
        sendJson(res, 200, { success: true, data: diag });
        return;
      }
      case 'mcp-url': {
        const url = await sdk.cascade.getMcpUrl();
        sendJson(res, 200, { success: true, data: { url } });
        return;
      }
      case 'browser-port': {
        const port = await sdk.cascade.getBrowserPort();
        sendJson(res, 200, { success: true, data: { port } });
        return;
      }
      case 'capabilities': {
        const capabilities_var = await getCascadeCapabilities_func(sdk);
        sendJson(res, 200, { success: true, data: capabilities_var });
        return;
      }
    }
  }

  // POST 엔드포인트
  if (method === 'POST') {
    const body = (await parseJsonBody(req)) as Record<string, unknown>;

    switch (action) {
      case 'focus': {
        const sessionId = body['id'] as string;
        if (!sessionId) {
          sendJson(res, 400, { success: false, error: 'Missing "id"' });
          return;
        }
        await sdk.cascade.focusSession(sessionId);
        sendJson(res, 200, { success: true });
        return;
      }
      case 'send-prompt': {
        const text = body['text'] as string;
        if (!text) {
          sendJson(res, 400, { success: false, error: 'Missing "text"' });
          return;
        }
        await sdk.cascade.sendPrompt(text);
        sendJson(res, 200, { success: true });
        return;
      }
      case 'accept-step': {
        const result_var = await acceptStepCompat_func(sdk);
        sendJson(res, 200, { success: true, data: result_var });
        return;
      }
      case 'reject-step': {
        await rejectStepCompat_func(sdk);
        sendJson(res, 200, { success: true });
        return;
      }
      case 'accept-terminal': {
        await sdk.cascade.acceptTerminalCommand();
        sendJson(res, 200, { success: true });
        return;
      }
      case 'reject-terminal': {
        await sdk.cascade.rejectTerminalCommand();
        sendJson(res, 200, { success: true });
        return;
      }
      case 'run-terminal': {
        const result_var = await runTerminalCompat_func(sdk);
        sendJson(res, 200, { success: true, data: result_var });
        return;
      }
      case 'accept-command': {
        const result_var = await acceptCommandCompat_func(sdk);
        sendJson(res, 200, { success: true, data: result_var });
        return;
      }
      case 'drive': {
        const result_var = await driveCascadeProgress_func(sdk);
        sendJson(res, 200, { success: true, data: result_var });
        return;
      }
      case 'git-ignored': {
        const filePath = body['path'] as string;
        if (!filePath) {
          sendJson(res, 400, { success: false, error: 'Missing "path"' });
          return;
        }
        const ignored = await sdk.cascade.isFileGitIgnored(filePath);
        sendJson(res, 200, { success: true, data: { ignored } });
        return;
      }
    }
  }

  sendJson(res, 404, { success: false, error: `Unknown cascade action: ${action}` });
};
