import http from 'node:http';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Extension HTTP 서버와 통신하는 클라이언트.
 * Node.js 내장 http 모듈만 사용 (외부 의존성 없음).
 */
export class BridgeClient {
  private readonly baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  /**
   * SSE 스트림을 열고 각 이벤트를 콜백으로 전달한다.
   * Ctrl+C로 종료할 때까지 blocking.
   */
  async stream(path: string, onEvent: (eventName: string, data: unknown) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/${path}`, this.baseUrl);

      http.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed: HTTP ${res.statusCode}`));
          return;
        }

        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // SSE 파싱: "event: name\ndata: json\n\n"
          const messages = buffer.split('\n\n');
          buffer = messages.pop() ?? ''; // 마지막 불완전 메시지는 버퍼에 유지

          for (const message of messages) {
            if (!message.trim()) continue;

            let eventName = 'message';
            let eventData = '';

            for (const line of message.split('\n')) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7);
              } else if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }

            if (eventData) {
              try {
                onEvent(eventName, JSON.parse(eventData));
              } catch {
                onEvent(eventName, eventData);
              }
            }
          }
        });

        res.on('end', resolve);
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * SSE를 연결하고 idle timeout 시 자동 종료.
   * 이벤트가 발생할 때마다 onEvent 호출 + idle 타이머 리셋.
   * idleMs 동안 이벤트가 없으면 자동으로 연결 종료.
   */
  streamUntil(
    path: string,
    onEvent: (eventName: string, data: unknown) => void,
    idleMs: number = 10000,
  ): { promise: Promise<void>; abort: () => void } {
    let req_var: ReturnType<typeof http.get> | null = null;
    let idle_timer: ReturnType<typeof setTimeout> | null = null;
    let resolve_fn: (() => void) | null = null;

    const resetIdle = (): void => {
      if (idle_timer) clearTimeout(idle_timer);
      idle_timer = setTimeout(() => {
        // idle timeout — 완료로 판단
        req_var?.destroy();
      }, idleMs);
    };

    const abort = (): void => {
      if (idle_timer) clearTimeout(idle_timer);
      req_var?.destroy();
    };

    const promise = new Promise<void>((resolve, reject) => {
      resolve_fn = resolve;
      const url = new URL(`/api/${path}`, this.baseUrl);

      req_var = http.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed: HTTP ${res.statusCode}`));
          return;
        }

        let buffer = '';
        resetIdle();

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const messages = buffer.split('\n\n');
          buffer = messages.pop() ?? '';

          for (const message of messages) {
            if (!message.trim()) continue;

            let eventName = 'message';
            let eventData = '';

            for (const line of message.split('\n')) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7);
              } else if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }

            if (eventData) {
              resetIdle();
              try {
                onEvent(eventName, JSON.parse(eventData));
              } catch {
                onEvent(eventName, eventData);
              }
            }
          }
        });

        res.on('end', resolve);
        res.on('close', resolve);
        res.on('error', reject);
      });

      req_var.on('error', (err: Error) => {
        if ((err as any).code === 'ERR_STREAM_DESTROYED') {
          resolve(); // abort or idle timeout — 정상 종료
        } else {
          reject(err);
        }
      });
    });

    return { promise, abort };
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/${path}`, this.baseUrl);
      const payload = body ? JSON.stringify(body) : undefined;

      const req = http.request(
        url,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            try {
              resolve(JSON.parse(raw) as ApiResponse<T>);
            } catch {
              reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
            }
          });
        },
      );

      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error(
            'Cannot connect to Bridge server.\n' +
            'Please check that the Extension is active in Antigravity IDE.',
          ));
        } else {
          reject(error);
        }
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
