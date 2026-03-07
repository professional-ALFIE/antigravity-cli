import type { RouteHandler } from '../router';

/**
 * /api/monitor/events → SSE 이벤트 스트림
 *
 * EventMonitor의 콜백들을 Server-Sent Events로 전달한다.
 * 클라이언트가 연결을 끊으면 모니터링을 중지한다.
 */
export const handleMonitor: RouteHandler = async (req, res, sdk, segments) => {
  const action = segments[0] ?? '';

  if (action !== 'events' || req.method !== 'GET') {
    res.writeHead(404);
    res.end(JSON.stringify({ success: false, error: 'Use GET /api/monitor/events' }));
    return;
  }

  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // 이벤트 전송 헬퍼
  const sendEvent = (eventName: string, data: unknown): void => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 구독 등록
  const disposables = [
    sdk.monitor.onStepCountChanged((count) => sendEvent('stepCountChanged', { count })),
    sdk.monitor.onActiveSessionChanged((session) => sendEvent('activeSessionChanged', session)),
    sdk.monitor.onNewConversation((conversation) => sendEvent('newConversation', conversation)),
    sdk.monitor.onStateChanged((state) => sendEvent('stateChanged', state)),
  ];

  // 모니터링 시작
  sdk.monitor.start();
  sendEvent('connected', { message: 'Monitor connected' });

  // 연결 종료 시 정리
  req.on('close', () => {
    for (const disposable of disposables) {
      disposable.dispose();
    }
    sdk.monitor.stop();
  });
};
