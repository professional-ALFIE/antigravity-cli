import * as readline from 'node:readline';
import process from 'node:process';
import { Spinner } from './spinner.js';
import { resolveClientForWorkspace_func } from './auto-launch.js';
import { ExecTimeoutError, runExec_func } from './commands/exec.js';
import { filterResumeList_func, formatResumeList_func } from './resume-list.js';
import { default_model_name_var, formatDocumentedModels_func, normalizeModelName_func } from './model-resolver.js';
import { cleanupClipboardImages_func, captureClipboardImage_func, type ClipboardImageAttachment } from './clipboard-image.js';
import { c } from './colors.js';

interface InteractiveOptions {
  port_var?: number;
  model_var?: string;
  resume_var?: string;
}

const INTERACTIVE_IDLE_TIMEOUT_MS = 180000;

function hasInteractiveFlag_func(argv_var: string[]): boolean {
  return argv_var.includes('-i') || argv_var.includes('--interactive');
}

export function shouldStartInteractive_func(argv_var: string[]): boolean {
  if (argv_var.includes('-h') || argv_var.includes('--help') || argv_var.includes('-v') || argv_var.includes('--version')) {
    return false;
  }

  if (hasInteractiveFlag_func(argv_var)) {
    return true;
  }

  return argv_var.length === 0 && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

function requireValue_func(argv_var: string[], index_var: number, option_var: string): string {
  const value_var = argv_var[index_var + 1];
  if (!value_var || value_var.startsWith('-')) {
    throw new Error(`${option_var} 옵션에는 값이 필요합니다.`);
  }

  return value_var;
}

function parseInteger_func(value_var: string, option_var: string): number {
  const parsed_var = Number.parseInt(value_var, 10);
  if (!Number.isFinite(parsed_var)) {
    throw new Error(`${option_var} 값은 숫자여야 합니다.`);
  }

  return parsed_var;
}

export function parseInteractiveOptions_func(argv_var: string[]): InteractiveOptions {
  const result_var: InteractiveOptions = {};

  for (let index_var = 0; index_var < argv_var.length; index_var += 1) {
    const token_var = argv_var[index_var];

    switch (token_var) {
      case '-i':
      case '--interactive':
      case '--no-color':
        continue;
      case '-p':
      case '--port': {
        const value_var = requireValue_func(argv_var, index_var, token_var);
        result_var.port_var = parseInteger_func(value_var, token_var);
        index_var += 1;
        continue;
      }
      case '-m':
      case '--model': {
        const value_var = requireValue_func(argv_var, index_var, token_var);
        result_var.model_var = value_var;
        index_var += 1;
        continue;
      }
      case '-r':
      case '--resume': {
        const next_token_var = argv_var[index_var + 1];
        if (next_token_var && !next_token_var.startsWith('-')) {
          result_var.resume_var = next_token_var;
          index_var += 1;
        }
        continue;
      }
      default:
        if (token_var.startsWith('-')) {
          throw new Error(`알 수 없는 옵션: ${token_var}`);
        }

        throw new Error('인터랙티브 모드에서는 메시지를 positional 인자로 받지 않습니다. 실행 후 프롬프트에 입력하세요.');
    }
  }

  return result_var;
}

function buildPrompt_func(resume_var?: string): string {
  const session_label_var = resume_var ? resume_var.slice(0, 8) : 'new';
  return `ag:${session_label_var}> `;
}

function printInteractiveHelp_func(): void {
  console.log('');
  console.log('Commands:');
  console.log('  /help                 명령 도움말');
  console.log('  /new                  새 대화로 전환');
  console.log('  /resume               현재 작업영역 대화 목록');
  console.log('  /resume <uuid>        해당 대화에 이어쓰기');
  console.log('  /model                현재 모델 표시');
  console.log('  /model <name>         기본 모델 변경');
  console.log('  /images               첨부 대기 이미지 표시');
  console.log('  /clear-images         첨부 대기 이미지 제거');
  console.log('  /status               Bridge / 계정 상태 확인');
  console.log('  /exit, /quit          종료');
  console.log('  Alt+V                 클립보드 이미지 첨부');
  console.log('');
}

function printBanner_func(workspace_dir_var: string, model_var: string, resume_var?: string): void {
  console.log('');
  console.log('Antigravity CLI Interactive');
  console.log(`  workspace  ${workspace_dir_var}`);
  console.log(`  model      ${model_var}`);
  console.log(`  session    ${resume_var ? resume_var.slice(0, 8) : '(new)'}`);
  console.log('  shortcut   ag');
  console.log('  help       /help');
  console.log(`  image      ${c.bold(c.yellow('Alt+V'))} clipboard -> ${c.bold(c.cyan('imgN'))}`);
  console.log('');
}

export function formatAttachmentBadge_func(attachment_var: ClipboardImageAttachment): string {
  return c.bold(c.yellow(attachment_var.label_var));
}

export function formatAttachmentQueue_func(attachments_var: ClipboardImageAttachment[]): string {
  if (attachments_var.length === 0) {
    return `${c.dim('첨부 대기:')} ${c.dim('(none)')}`;
  }

  return `${c.dim('첨부 대기:')} ${attachments_var.map((attachment_var) => formatAttachmentBadge_func(attachment_var)).join(' ')}`;
}

async function clearPendingAttachments_func(attachments_ref_var: { value: ClipboardImageAttachment[] }): Promise<void> {
  if (attachments_ref_var.value.length === 0) {
    return;
  }

  await cleanupClipboardImages_func(attachments_ref_var.value);
  attachments_ref_var.value = [];
}

function redrawPrompt_func(
  rl_var: readline.Interface,
  prompt_var: string,
  input_line_var: string,
): void {
  rl_var.setPrompt(prompt_var);
  rl_var.prompt();
  if (input_line_var) {
    rl_var.write(input_line_var);
  }
}

async function printResumeList_func(
  client_portless_var: Awaited<ReturnType<typeof resolveClientForWorkspace_func>>,
): Promise<void> {
  const result_var = await client_portless_var.client_var.get('ls/list');
  if (!result_var.success) {
    throw new Error(result_var.error ?? 'list failed');
  }

  const workspace_dir_var = client_portless_var.instance_var.workspace === '(manual)'
    ? process.cwd()
    : client_portless_var.instance_var.workspace;
  const filtered_var = filterResumeList_func(result_var.data, workspace_dir_var);
  const lines_var = formatResumeList_func(filtered_var);

  if (lines_var.length === 0) {
    console.log('(no items)');
    return;
  }

  for (const line_var of lines_var) {
    console.log(line_var);
  }
}

async function printStatus_func(
  client_portless_var: Awaited<ReturnType<typeof resolveClientForWorkspace_func>>,
): Promise<void> {
  const [health_var, user_status_var] = await Promise.all([
    client_portless_var.client_var.get('health'),
    client_portless_var.client_var.get('ls/user-status'),
  ]);

  const uptime_var = (health_var.data as Record<string, unknown> | undefined)?.['uptime'];
  console.log(`서버   ${uptime_var ?? 'OK'}`);

  const user_status_payload_var = (user_status_var.data as Record<string, unknown> | undefined)?.['userStatus'] as Record<string, unknown> | undefined;
  if (!user_status_payload_var) {
    console.log('유저   (unknown)');
    return;
  }

  const name_var = user_status_payload_var['name'] as string | undefined;
  const email_var = user_status_payload_var['email'] as string | undefined;
  console.log(`유저   ${name_var ?? '(unknown)'} ${email_var ?? ''}`.trimEnd());
}

async function handleInteractiveCommand_func(
  input_var: string,
  current_resume_ref_var: { value?: string },
  current_model_ref_var: { value: string },
  client_state_var: Awaited<ReturnType<typeof resolveClientForWorkspace_func>>,
  attachments_ref_var: { value: ClipboardImageAttachment[] },
): Promise<boolean> {
  const trimmed_var = input_var.trim();
  const [command_var, ...rest_var] = trimmed_var.split(/\s+/u);
  const argument_var = rest_var.join(' ').trim();

  switch (command_var) {
    case '/help':
      printInteractiveHelp_func();
      return true;
    case '/new':
      await clearPendingAttachments_func(attachments_ref_var);
      current_resume_ref_var.value = undefined;
      console.log('새 대화로 전환했습니다.');
      return true;
    case '/resume':
      if (!argument_var) {
        await printResumeList_func(client_state_var);
        return true;
      }
      await clearPendingAttachments_func(attachments_ref_var);
      current_resume_ref_var.value = argument_var;
      console.log(`세션 전환: ${argument_var}`);
      return true;
    case '/model':
      if (!argument_var) {
        console.log(`현재 모델: ${current_model_ref_var.value}`);
        console.log(formatDocumentedModels_func());
        return true;
      }
      current_model_ref_var.value = normalizeModelName_func(argument_var);
      console.log(`모델 변경: ${current_model_ref_var.value}`);
      return true;
    case '/images':
      console.log(formatAttachmentQueue_func(attachments_ref_var.value));
      return true;
    case '/clear-images':
      await clearPendingAttachments_func(attachments_ref_var);
      console.log('첨부 대기 이미지를 비웠습니다.');
      return true;
    case '/status':
      await printStatus_func(client_state_var);
      return true;
    case '/quit':
    case '/exit':
      return false;
    default:
      throw new Error(`알 수 없는 인터랙티브 명령: ${command_var}`);
  }
}

export async function startInteractive_func(options_var: InteractiveOptions): Promise<void> {
  const connect_spinner_var = new Spinner();
  connect_spinner_var.start('연결');
  const client_state_var = await resolveClientForWorkspace_func(options_var.port_var, undefined, connect_spinner_var);
  connect_spinner_var.stop();

  const workspace_dir_var = client_state_var.instance_var.workspace === '(manual)'
    ? process.cwd()
    : client_state_var.instance_var.workspace;
  const current_resume_ref_var: { value?: string } = { value: options_var.resume_var };
  const current_model_ref_var = { value: normalizeModelName_func(options_var.model_var ?? default_model_name_var) };
  const pending_attachments_ref_var = { value: [] as ClipboardImageAttachment[] };

  printBanner_func(workspace_dir_var, current_model_ref_var.value, current_resume_ref_var.value);

  const rl_var = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    historySize: 1000,
    removeHistoryDuplicates: true,
  });

  readline.emitKeypressEvents(process.stdin, rl_var);
  const stdin_var = process.stdin;
  const can_toggle_raw_mode_var = Boolean(stdin_var.isTTY && typeof stdin_var.setRawMode === 'function');
  const should_restore_raw_mode_var = can_toggle_raw_mode_var && !stdin_var.isRaw;
  if (should_restore_raw_mode_var) {
    stdin_var.setRawMode?.(true);
  }

  let capture_in_progress_var = false;
  const keypress_handler_var = async (_chunk_var: string, key_var: readline.Key): Promise<void> => {
    if (!key_var.meta || key_var.name !== 'v' || capture_in_progress_var) {
      return;
    }

    capture_in_progress_var = true;
    const current_line_var = rl_var.line;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    try {
      const attachment_var = await captureClipboardImage_func(pending_attachments_ref_var.value.length + 1);
      pending_attachments_ref_var.value = [...pending_attachments_ref_var.value, attachment_var];
      console.log(
        `${formatAttachmentQueue_func(pending_attachments_ref_var.value)} ${c.dim(`(${attachment_var.width_px_var}x${attachment_var.height_px_var})`)}`,
      );
    } catch (error_var) {
      console.error(`✗ ${error_var instanceof Error ? error_var.message : String(error_var)}`);
    } finally {
      capture_in_progress_var = false;
      redrawPrompt_func(rl_var, buildPrompt_func(current_resume_ref_var.value), current_line_var);
    }
  };

  stdin_var.on('keypress', keypress_handler_var);

  try {
    process.stdout.write(buildPrompt_func(current_resume_ref_var.value));

    for await (const input_var of rl_var) {
      const trimmed_var = input_var.trim();

      try {
        if (!trimmed_var) {
          process.stdout.write(buildPrompt_func(current_resume_ref_var.value));
          continue;
        }

        if (trimmed_var.startsWith('/')) {
          const should_continue_var = await handleInteractiveCommand_func(
            trimmed_var,
            current_resume_ref_var,
            current_model_ref_var,
            client_state_var,
            pending_attachments_ref_var,
          );
          if (!should_continue_var) {
            break;
          }

          process.stdout.write(buildPrompt_func(current_resume_ref_var.value));
          continue;
        }

        const turn_spinner_var = new Spinner();
        turn_spinner_var.start(current_resume_ref_var.value ? '메시지 전송' : '새 대화 생성');
        const pending_attachments_var = [...pending_attachments_ref_var.value];

        try {
          const exec_result_var = await runExec_func({
            client_var: client_state_var.client_var,
            message_var: trimmed_var,
            model_var: current_model_ref_var.value,
            resume_var: current_resume_ref_var.value,
            attachments_var: pending_attachments_var,
            idle_timeout_var: INTERACTIVE_IDLE_TIMEOUT_MS,
            spinner_var: turn_spinner_var,
          });
          current_resume_ref_var.value = exec_result_var.cascade_id_var;
          await clearPendingAttachments_func(pending_attachments_ref_var);
        } catch (error_var) {
          turn_spinner_var.stop();
          if (error_var instanceof ExecTimeoutError) {
            current_resume_ref_var.value = error_var.cascade_id_var;
            await clearPendingAttachments_func(pending_attachments_ref_var);
          }
          throw error_var;
        }
      } catch (error_var) {
        if (error_var instanceof ExecTimeoutError) {
          console.log(
            `… 응답이 아직 진행 중입니다. 같은 세션(${error_var.cascade_id_var.slice(0, 8)})을 유지합니다. 잠시 후 다시 입력하거나 Antigravity 패널에서 확인하세요.`,
          );
        } else {
          console.error(`✗ ${error_var instanceof Error ? error_var.message : String(error_var)}`);
        }
      }

      process.stdout.write(buildPrompt_func(current_resume_ref_var.value));
    }
  } finally {
    stdin_var.off('keypress', keypress_handler_var);
    if (should_restore_raw_mode_var) {
      stdin_var.setRawMode?.(false);
    }
    await clearPendingAttachments_func(pending_attachments_ref_var);
    rl_var.close();
  }
}
