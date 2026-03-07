import type * as http from 'node:http';
import type { AntigravitySDK } from 'antigravity-sdk';
import { handleHealth } from './routes/health';
import { handleCascade } from './routes/cascade';
import { handleLs } from './routes/ls';
import { handleCommands } from './routes/commands';
import { handleState } from './routes/state';
import { handleMonitor } from './routes/monitor';
import { handleIntegration } from './routes/integration';
import { handleAutoRun } from './routes/auto-run';

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sdk: AntigravitySDK,
  pathSegments: string[],
) => Promise<void>;

/** JSON body 파싱 유틸리티 */
export async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** JSON 응답 헬퍼 */
export function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode);
  res.end(JSON.stringify(data));
}

/**
 * 라우터 팩토리 — URL path의 첫 세그먼트로 핸들러를 분기한다.
 * /api/{module}/{...rest}
 */
export function createRouter(sdk: AntigravitySDK) {
  const routes: Record<string, RouteHandler> = {
    health: handleHealth,
    cascade: handleCascade,
    ls: handleLs,
    commands: handleCommands,
    state: handleState,
    monitor: handleMonitor,
    integration: handleIntegration,
    'auto-run': handleAutoRun,
  };

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    // /api/cascade/sessions → ['cascade', 'sessions']
    const segments = url.pathname
      .replace(/^\/api\//, '')
      .split('/')
      .filter(Boolean);

    const moduleName = segments[0] ?? '';
    const handler = routes[moduleName];

    if (!handler) {
      sendJson(res, 404, {
        success: false,
        error: `Unknown route: ${url.pathname}`,
      });
      return;
    }

    await handler(req, res, sdk, segments.slice(1));
  };
}
