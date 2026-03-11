import type { RouteHandler } from '../router';
import { parseJsonBody, sendJson } from '../router';
import {
  ackAttachmentRequest_func,
  enqueueAttachmentMessage_func,
  getAttachmentFile_func,
  getNextAttachmentRequest_func,
  noteAttachmentRendererActive_func,
} from '../../attachment-bridge';

export const handleAttachments: RouteHandler = async (req, res, _sdk, segments) => {
  const action_var = segments[0] ?? '';
  const method_var = req.method ?? 'GET';

  if (method_var === 'POST' && action_var === 'send') {
    const body_var = (await parseJsonBody(req)) as Record<string, unknown>;
    const result_var = await enqueueAttachmentMessage_func({
      cascade_id_var: typeof body_var['cascadeId'] === 'string' ? body_var['cascadeId'] : undefined,
      text_var: String(body_var['text'] ?? ''),
      attachments_var: ((body_var['attachments'] as unknown[]) ?? []).map((attachment_var) => {
        const attachment_record_var = (attachment_var ?? {}) as Record<string, unknown>;
        return {
          label: typeof attachment_record_var['label'] === 'string' ? attachment_record_var['label'] : undefined,
          fileName: String(attachment_record_var['fileName'] ?? ''),
          mimeType: typeof attachment_record_var['mimeType'] === 'string' ? attachment_record_var['mimeType'] : undefined,
          tempPath: String(attachment_record_var['tempPath'] ?? ''),
          sizeBytes: typeof attachment_record_var['sizeBytes'] === 'number' ? attachment_record_var['sizeBytes'] : undefined,
        };
      }),
    });
    sendJson(res, 200, { success: true, data: result_var });
    return;
  }

  if (method_var === 'POST' && action_var === 'ping') {
    noteAttachmentRendererActive_func();
    sendJson(res, 200, { success: true });
    return;
  }

  if (method_var === 'POST' && action_var === 'ack') {
    const request_id_var = segments[1];
    if (!request_id_var) {
      sendJson(res, 400, { success: false, error: 'Missing request ID in path' });
      return;
    }

    const body_var = (await parseJsonBody(req)) as Record<string, unknown>;
    const status_var = body_var['status'] === 'error' ? 'error' : 'sent';
    const acked_var = ackAttachmentRequest_func(
      request_id_var,
      status_var,
      typeof body_var['error'] === 'string' ? body_var['error'] : undefined,
    );
    sendJson(res, acked_var ? 200 : 404, acked_var ? { success: true } : { success: false, error: 'Unknown request' });
    return;
  }

  if (method_var === 'GET' && action_var === 'next') {
    noteAttachmentRendererActive_func();
    sendJson(res, 200, { success: true, data: getNextAttachmentRequest_func() });
    return;
  }

  if (method_var === 'GET' && action_var === 'file') {
    const request_id_var = segments[1];
    const attachment_id_var = segments[2];
    if (!request_id_var || !attachment_id_var) {
      sendJson(res, 400, { success: false, error: 'Missing request or attachment ID in path' });
      return;
    }

    const attachment_var = getAttachmentFile_func(request_id_var, attachment_id_var);
    if (!attachment_var) {
      sendJson(res, 404, { success: false, error: 'Attachment not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': attachment_var.mime_type_var,
      'Content-Length': attachment_var.content_var.byteLength.toString(),
      'Cache-Control': 'no-store',
    });
    res.end(attachment_var.content_var);
    return;
  }

  sendJson(res, 404, { success: false, error: `Unknown attachments action: ${action_var}` });
};
