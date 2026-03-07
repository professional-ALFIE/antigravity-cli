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
          reject(new Error(`SSE 연결 실패: HTTP ${res.statusCode}`));
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
              reject(new Error(`응답 파싱 실패: ${raw.slice(0, 200)}`));
            }
          });
        },
      );

      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error(
            'Bridge 서버에 연결할 수 없습니다.\n' +
            'Antigravity IDE에서 Extension이 활성화되어 있는지 확인해주세요.',
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
