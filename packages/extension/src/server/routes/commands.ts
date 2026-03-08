import type { RouteHandler } from '../router';
import { sendJson, parseJsonBody } from '../router';

/**
 * /api/commands/...
 *
 * GET  /list               → commands.getAntigravityCommands()
 * POST /exec               → commands.executeCommand(cmd, ...args)
 */
export const handleCommands: RouteHandler = async (req, res, sdk, segments) => {
  const action = segments[0] ?? '';
  const method = req.method ?? 'GET';

  if (method === 'GET' && action === 'list') {
    const commands = await sdk.commands.getAntigravityCommands();
    sendJson(res, 200, { success: true, data: commands });
    return;
  }

  if (method === 'POST' && action === 'exec') {
    const body = (await parseJsonBody(req)) as Record<string, unknown>;
    const command = body['command'] as string;
    if (!command) {
      sendJson(res, 400, { success: false, error: 'Missing "command"' });
      return;
    }
    const args = (body['args'] as unknown[]) ?? [];
    const result = await sdk.commands.execute(command, ...args);
    sendJson(res, 200, { success: true, data: result });
    return;
  }

  sendJson(res, 404, { success: false, error: `Unknown commands action: ${action}` });
};
