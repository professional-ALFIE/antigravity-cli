import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type * as vscode from 'vscode';
import type { AntigravitySDK } from 'antigravity-sdk';

const SCRIPT_BASENAME_VAR = 'ag-bridge-attachments.js';
const CONFIG_BASENAME_VAR = 'ag-bridge-attachments.json';
const HTML_MARKER_START_VAR = '<!-- AG Bridge Attachments -->';
const HTML_MARKER_END_VAR = '<!-- /AG Bridge Attachments -->';
const RENDERER_ACTIVE_WINDOW_MS = 15000;
const REQUEST_TIMEOUT_MS = 20000;
const CLAIM_STALE_MS = 10000;

interface AttachmentInputPayload {
  label?: string;
  fileName: string;
  mimeType?: string;
  tempPath: string;
  sizeBytes?: number;
}

interface BufferedAttachment {
  attachment_id_var: string;
  label_var: string;
  file_name_var: string;
  mime_type_var: string;
  size_bytes_var: number;
  content_var: Buffer;
}

interface PendingAttachmentRequest {
  request_id_var: string;
  cascade_id_var: string;
  text_var: string;
  attachments_var: BufferedAttachment[];
  created_at_var: number;
  claimed_at_var?: number;
  timeout_handle_var: ReturnType<typeof setTimeout>;
  resolve_var: () => void;
  reject_var: (error_var: Error) => void;
}

interface PublicAttachmentRequest {
  requestId: string;
  cascadeId: string;
  text: string;
  attachments: Array<{
    id: string;
    label: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
  }>;
}

class AttachmentBridgeService {
  private sdk_var: AntigravitySDK | undefined;
  private output_var: vscode.OutputChannel | undefined;
  private bridge_port_var = 0;
  private renderer_last_seen_at_var = 0;
  private pending_requests_var: PendingAttachmentRequest[] = [];
  private workbench_dir_var: string | null = null;
  private config_path_var: string | null = null;
  private script_path_var: string | null = null;

  async initialize_func(
    sdk_var: AntigravitySDK,
    output_var: vscode.OutputChannel,
    bridge_port_var: number,
  ): Promise<void> {
    this.sdk_var = sdk_var;
    this.output_var = output_var;
    this.bridge_port_var = bridge_port_var;

    const workbench_dir_var = this.resolveWorkbenchDir_func();
    if (!workbench_dir_var) {
      output_var.appendLine('[Attachments] workbench directory not found; renderer bridge disabled');
      return;
    }

    this.workbench_dir_var = workbench_dir_var;
    this.config_path_var = path.join(workbench_dir_var, CONFIG_BASENAME_VAR);
    this.script_path_var = path.join(workbench_dir_var, SCRIPT_BASENAME_VAR);

    const install_status_var = await this.ensureRendererScriptInstalled_func();
    await this.writeConfig_func();

    const status_suffix_var = install_status_var === 'installed'
      ? ' (restart required once to activate renderer script)'
      : '';
    output_var.appendLine(`[Attachments] renderer bridge ready on :${bridge_port_var}${status_suffix_var}`);
  }

  dispose_func(): void {
    for (const request_var of this.pending_requests_var.splice(0)) {
      clearTimeout(request_var.timeout_handle_var);
      request_var.reject_var(new Error('Antigravity Bridge가 종료되어 이미지 전송을 중단했습니다.'));
    }
  }

  noteRendererActive_func(): void {
    this.renderer_last_seen_at_var = Date.now();
  }

  getNextRequest_func(): PublicAttachmentRequest | null {
    this.noteRendererActive_func();

    const now_var = Date.now();
    const next_request_var = this.pending_requests_var.find((request_var) => (
      request_var.claimed_at_var === undefined
      || (now_var - request_var.claimed_at_var) > CLAIM_STALE_MS
    ));

    if (!next_request_var || this.bridge_port_var <= 0) {
      return null;
    }

    next_request_var.claimed_at_var = now_var;

    return {
      requestId: next_request_var.request_id_var,
      cascadeId: next_request_var.cascade_id_var,
      text: next_request_var.text_var,
      attachments: next_request_var.attachments_var.map((attachment_var) => ({
        id: attachment_var.attachment_id_var,
        label: attachment_var.label_var,
        fileName: attachment_var.file_name_var,
        mimeType: attachment_var.mime_type_var,
        sizeBytes: attachment_var.size_bytes_var,
        url: `http://127.0.0.1:${this.bridge_port_var}/api/attachments/file/${next_request_var.request_id_var}/${attachment_var.attachment_id_var}`,
      })),
    };
  }

  getAttachmentFile_func(request_id_var: string, attachment_id_var: string): BufferedAttachment | null {
    const request_var = this.pending_requests_var.find((pending_var) => pending_var.request_id_var === request_id_var);
    if (!request_var) {
      return null;
    }

    return request_var.attachments_var.find((attachment_var) => attachment_var.attachment_id_var === attachment_id_var) ?? null;
  }

  ackRequest_func(request_id_var: string, status_var: 'sent' | 'error', error_var?: string): boolean {
    const request_index_var = this.pending_requests_var.findIndex((request_var) => request_var.request_id_var === request_id_var);
    if (request_index_var < 0) {
      return false;
    }

    const [request_var] = this.pending_requests_var.splice(request_index_var, 1);
    clearTimeout(request_var.timeout_handle_var);

    if (status_var === 'sent') {
      request_var.resolve_var();
    } else {
      request_var.reject_var(new Error(error_var ?? '이미지 첨부 렌더러가 전송을 완료하지 못했습니다.'));
    }

    return true;
  }

  async enqueueMessage_func(payload_var: {
    cascade_id_var?: string;
    text_var: string;
    attachments_var: AttachmentInputPayload[];
  }): Promise<{ cascadeId: string }> {
    if (!this.sdk_var) {
      throw new Error('attachment bridge is not initialized');
    }

    const cascade_id_var = payload_var.cascade_id_var?.trim() || await this.startEmptyCascade_func();
    await this.focusConversation_func(cascade_id_var);

    const buffered_attachments_var = await Promise.all(
      payload_var.attachments_var.map(async (attachment_var, index_var) => {
        const content_var = await fsp.readFile(attachment_var.tempPath);
        return {
          attachment_id_var: crypto.randomUUID(),
          label_var: attachment_var.label?.trim() || `img${index_var + 1}`,
          file_name_var: attachment_var.fileName,
          mime_type_var: attachment_var.mimeType || 'image/png',
          size_bytes_var: attachment_var.sizeBytes ?? content_var.byteLength,
          content_var,
        } satisfies BufferedAttachment;
      }),
    );

    const request_id_var = crypto.randomUUID();

    return new Promise<{ cascadeId: string }>((resolve_var, reject_var) => {
      const timeout_handle_var = setTimeout(() => {
        this.pending_requests_var = this.pending_requests_var.filter((request_var) => request_var.request_id_var !== request_id_var);
        reject_var(new Error('이미지 전송을 Antigravity 입력창으로 넘기지 못했습니다. Antigravity 패널이 열려 있는지 확인하세요.'));
      }, REQUEST_TIMEOUT_MS);

      this.pending_requests_var.push({
        request_id_var,
        cascade_id_var,
        text_var: payload_var.text_var,
        attachments_var: buffered_attachments_var,
        created_at_var: Date.now(),
        timeout_handle_var,
        resolve_var: () => resolve_var({ cascadeId: cascade_id_var }),
        reject_var,
      });
    });
  }

  private resolveWorkbenchDir_func(): string | null {
    const candidates_var = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'resources', 'app', 'out', 'vs', 'workbench'),
      '/Applications/Antigravity.app/Contents/Resources/app/out/vs/code/electron-browser/workbench',
      '/Applications/Antigravity.app/Contents/Resources/app/out/vs/workbench',
      '/usr/share/antigravity/resources/app/out/vs/code/electron-browser/workbench',
    ];

    for (const candidate_var of candidates_var) {
      if (candidate_var && fs.existsSync(path.join(candidate_var, 'workbench.html'))) {
        return candidate_var;
      }
    }

    return null;
  }

  private async ensureRendererScriptInstalled_func(): Promise<'already-installed' | 'installed'> {
    if (!this.workbench_dir_var || !this.script_path_var) {
      throw new Error('workbench directory not initialized');
    }

    const html_path_var = path.join(this.workbench_dir_var, 'workbench.html');
    const script_content_var = buildAttachmentRendererScript_func(CONFIG_BASENAME_VAR);
    const script_tag_var = `${HTML_MARKER_START_VAR}\n<script src="./${SCRIPT_BASENAME_VAR}"></script>\n${HTML_MARKER_END_VAR}`;

    let install_status_var: 'already-installed' | 'installed' = 'already-installed';

    if (!fs.existsSync(this.script_path_var) || fs.readFileSync(this.script_path_var, 'utf8') !== script_content_var) {
      fs.writeFileSync(this.script_path_var, script_content_var, 'utf8');
    }

    const html_content_var = fs.readFileSync(html_path_var, 'utf8');
    if (!html_content_var.includes(HTML_MARKER_START_VAR)) {
      fs.writeFileSync(
        html_path_var,
        html_content_var.replace('</html>', `${script_tag_var}\n</html>`),
        'utf8',
      );
      install_status_var = 'installed';
    }

    return install_status_var;
  }

  private async writeConfig_func(): Promise<void> {
    if (!this.config_path_var) {
      return;
    }

    await fsp.writeFile(
      this.config_path_var,
      JSON.stringify({
        bridgePort: this.bridge_port_var,
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
  }

  private async startEmptyCascade_func(): Promise<string> {
    if (!this.sdk_var) {
      throw new Error('attachment bridge is not initialized');
    }

    const result_var = await this.sdk_var.ls.rawRPC('StartCascade', { source: 0 });
    const cascade_id_var = String((result_var as Record<string, unknown> | undefined)?.['cascadeId'] ?? '').trim();
    if (!cascade_id_var) {
      throw new Error('이미지 전송용 빈 대화를 만들지 못했습니다.');
    }

    return cascade_id_var;
  }

  private async focusConversation_func(cascade_id_var: string): Promise<void> {
    if (!this.sdk_var) {
      throw new Error('attachment bridge is not initialized');
    }

    try {
      await this.sdk_var.commands.execute('antigravity.agentSidePanel.open');
    } catch {
      // ignore
    }

    await this.sdk_var.ls.focusCascade(cascade_id_var);

    try {
      await this.sdk_var.commands.execute('antigravity.toggleChatFocus');
    } catch {
      // ignore
    }

    await sleep_func(350);
  }
}

function sleep_func(delay_ms_var: number): Promise<void> {
  return new Promise((resolve_var) => {
    setTimeout(resolve_var, delay_ms_var);
  });
}

function buildAttachmentRendererScript_func(config_basename_var: string): string {
  return `(() => {
  'use strict';
  if (window.__agBridgeAttachments) return;
  window.__agBridgeAttachments = true;

  const configPath = './${config_basename_var}';
  let bridgePort = 0;
  let configLoadedAt = 0;
  let busy = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function loadConfig(force) {
    if (!force && bridgePort > 0 && (Date.now() - configLoadedAt) < 2000) {
      return bridgePort;
    }

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', configPath + '?t=' + Date.now(), false);
      xhr.send();
      if (xhr.status !== 0 && xhr.status !== 200) {
        return 0;
      }

      const raw = String(xhr.responseText || '').trim();
      if (!raw) {
        return 0;
      }

      const payload = JSON.parse(raw);
      const nextPort = Number(payload?.bridgePort ?? 0);
      bridgePort = Number.isFinite(nextPort) ? nextPort : 0;
      configLoadedAt = Date.now();
      return bridgePort;
    } catch {
      return 0;
    }
  }

  function findInputContainer() {
    return document.querySelector('#antigravity\\\\.agentSidePanelInputBox');
  }

  function findEditableTarget(container) {
    return container.querySelector('[contenteditable="true"]')
      || container.querySelector('textarea')
      || container.querySelector('input')
      || container;
  }

  function focusElement(target) {
    if (!target) return;
    if (typeof target.focus === 'function') target.focus();
    if (typeof target.click === 'function') target.click();
  }

  function appendText(target, text) {
    if (!target || !text) return;

    focusElement(target);

    if (target.isContentEditable) {
      try {
        document.execCommand('insertText', false, text);
      } catch {
        target.textContent = (target.textContent || '') + text;
      }

      try {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      } catch {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    if ('value' in target) {
      target.value = String(target.value || '') + text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function buildTransfer(files) {
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }
    return transfer;
  }

  function dispatchTransfer(target, container, files) {
    const transfer = buildTransfer(files);

    try {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', { value: transfer });
      target.dispatchEvent(pasteEvent);
    } catch {}

    try {
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', { value: transfer });
      (container || target).dispatchEvent(dropEvent);
    } catch {}
  }

  function isEnabledButton(candidate) {
    return Boolean(candidate)
      && !candidate.disabled
      && candidate.getAttribute('aria-disabled') !== 'true';
  }

  function findSendButton(container) {
    let scope = container;

    while (scope) {
      const candidates = Array.from(scope.querySelectorAll('button,[role="button"]')).filter(isEnabledButton);
      const labeled = candidates.find((candidate) => /send|전송/i.test(String(
        candidate.getAttribute('aria-label')
        || candidate.getAttribute('title')
        || candidate.textContent
        || '',
      )));

      if (labeled) {
        return labeled;
      }

      if (candidates.length > 0) {
        return candidates[candidates.length - 1];
      }

      scope = scope.parentElement;
    }

    return null;
  }

  async function waitForInputContainer() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const container = findInputContainer();
      if (container) {
        return container;
      }
      await sleep(250);
    }

    return null;
  }

  async function sendComposer(container, target) {
    const button = findSendButton(container);
    if (button) {
      button.click();
      return true;
    }

    const keyboardInit = {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
    };

    ['keydown', 'keypress', 'keyup'].forEach((eventName) => {
      target.dispatchEvent(new KeyboardEvent(eventName, keyboardInit));
    });

    return true;
  }

  async function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
  }

  async function processRequest(request, port) {
    busy = true;

    try {
      const container = await waitForInputContainer();
      if (!container) {
        throw new Error('Antigravity 입력창을 찾지 못했습니다.');
      }

      const target = findEditableTarget(container);
      focusElement(target);

      const files = [];
      for (const attachment of request.attachments ?? []) {
        const response = await fetch(attachment.url, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('첨부 파일을 불러오지 못했습니다.');
        }

        const blob = await response.blob();
        files.push(new File([blob], attachment.fileName, { type: attachment.mimeType || blob.type || 'image/png' }));
      }

      if (files.length > 0) {
        dispatchTransfer(target, container, files);
        await sleep(180);
      }

      if (request.text) {
        appendText(target, request.text);
        await sleep(100);
      }

      await sendComposer(container, target);
      await sleep(350);

      await postJson('http://127.0.0.1:' + port + '/api/attachments/ack/' + request.requestId, {
        status: 'sent',
      });
    } catch (error) {
      await postJson('http://127.0.0.1:' + port + '/api/attachments/ack/' + request.requestId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busy = false;
    }
  }

  async function tick() {
    const port = loadConfig(false);
    if (!port) {
      return;
    }

    try {
      await postJson('http://127.0.0.1:' + port + '/api/attachments/ping', {});
    } catch {
      return;
    }

    if (busy) {
      return;
    }

    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/attachments/next', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      if (!payload?.success || !payload.data) {
        return;
      }

      await processRequest(payload.data, port);
    } catch {
      // ignore
    }
  }

  setInterval(() => {
    tick();
  }, 1200);

  setTimeout(() => {
    tick();
  }, 1200);
})();`;
}

const attachment_bridge_singleton_var = new AttachmentBridgeService();

export async function initializeAttachmentBridge_func(
  sdk_var: AntigravitySDK,
  output_var: vscode.OutputChannel,
  bridge_port_var: number,
): Promise<void> {
  await attachment_bridge_singleton_var.initialize_func(sdk_var, output_var, bridge_port_var);
}

export function disposeAttachmentBridge_func(): void {
  attachment_bridge_singleton_var.dispose_func();
}

export async function enqueueAttachmentMessage_func(payload_var: {
  cascade_id_var?: string;
  text_var: string;
  attachments_var: AttachmentInputPayload[];
}): Promise<{ cascadeId: string }> {
  return attachment_bridge_singleton_var.enqueueMessage_func(payload_var);
}

export function getNextAttachmentRequest_func(): PublicAttachmentRequest | null {
  return attachment_bridge_singleton_var.getNextRequest_func();
}

export function getAttachmentFile_func(request_id_var: string, attachment_id_var: string): BufferedAttachment | null {
  return attachment_bridge_singleton_var.getAttachmentFile_func(request_id_var, attachment_id_var);
}

export function ackAttachmentRequest_func(
  request_id_var: string,
  status_var: 'sent' | 'error',
  error_var?: string,
): boolean {
  return attachment_bridge_singleton_var.ackRequest_func(request_id_var, status_var, error_var);
}

export function noteAttachmentRendererActive_func(): void {
  attachment_bridge_singleton_var.noteRendererActive_func();
}
