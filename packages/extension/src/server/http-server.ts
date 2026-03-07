import * as http from 'node:http';
import type * as vscode from 'vscode';
import type { AntigravitySDK } from 'antigravity-sdk';
import { createRouter } from './router';

const HOST = '127.0.0.1'; // localhost 전용, 외부 접근 차단

export class HttpServer {
  private server: http.Server | undefined;
  private port = 0;

  constructor(
    private readonly sdk: AntigravitySDK,
    private readonly output: vscode.OutputChannel,
  ) { }

  /** 서버를 시작하고 할당된 포트를 반환한다. */
  async start(): Promise<number> {
    const router = createRouter(this.sdk);

    this.server = http.createServer(async (req, res) => {
      // CORS (CLI → Extension 로컬 통신용)
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        await router(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[Bridge] Request error: ${message}`);

        if (!res.writableEnded) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: message }));
        }
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(0, HOST, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server!.on('error', reject);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }

  getPort(): number {
    return this.port;
  }
}
