import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec_file_async_func = promisify(execFile);
const CLIPBOARD_IMAGE_DIRNAME_VAR = 'antigravity-cli-images';

export interface ClipboardImageAttachment {
  label_var: string;
  file_name_var: string;
  temp_path_var: string;
  mime_type_var: string;
  byte_size_var: number;
  width_px_var: number;
  height_px_var: number;
}

interface CaptureResult {
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
}

function escapePowerShellSingleQuoted_func(value_var: string): string {
  return value_var.replace(/'/g, "''");
}

export function buildPowerShellCaptureScript_func(temp_path_var: string): string {
  const escaped_path_var = escapePowerShellSingleQuoted_func(temp_path_var);

  return [
    '$ErrorActionPreference = \'Stop\'',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    'if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { throw \'NO_IMAGE_IN_CLIPBOARD\' }',
    '$image = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($null -eq $image) { throw \'NO_IMAGE_IN_CLIPBOARD\' }',
    `$path = '${escaped_path_var}'`,
    '$directory = Split-Path -Parent $path',
    'if (-not [string]::IsNullOrWhiteSpace($directory)) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }',
    '$image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$result = [pscustomobject]@{',
    '  path = $path',
    '  sizeBytes = ([System.IO.FileInfo]::new($path)).Length',
    '  width = $image.Width',
    '  height = $image.Height',
    '}',
    '$result | ConvertTo-Json -Compress',
  ].join('\n');
}

export function decodeCliXmlMessage_func(value_var: string): string {
  const normalized_var = value_var
    .replace(/^#< CLIXML/iu, '')
    .replace(/_x000D__x000A_/giu, '\n')
    .replace(/_x000D_/giu, '\r')
    .replace(/_x000A_/giu, '\n')
    .replace(/<Objs[^>]*>/giu, '')
    .replace(/<\/Objs>/giu, '')
    .replace(/<Obj[^>]*>/giu, '')
    .replace(/<\/Obj>/giu, '')
    .replace(/<TN[^>]*>[\s\S]*?<\/TN>/giu, '')
    .replace(/<ToString>([\s\S]*?)<\/ToString>/giu, '$1')
    .replace(/<S(?: [^>]*)?>([\s\S]*?)<\/S>/giu, '$1')
    .replace(/<Props>|<\/Props>|<MS>|<\/MS>/giu, '')
    .replace(/<[^>]+>/giu, ' ')
    .replace(/\s+\n/gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();

  return normalized_var.replace(/\s{2,}/gu, ' ').trim();
}

function buildTempPath_func(index_var: number): string {
  const file_name_var = `ag-image-${Date.now()}-${process.pid}-${index_var}.png`;
  return path.join(os.tmpdir(), CLIPBOARD_IMAGE_DIRNAME_VAR, file_name_var);
}

export async function captureClipboardImage_func(index_var: number): Promise<ClipboardImageAttachment> {
  if (process.platform !== 'win32') {
    throw new Error('현재 Alt+V 이미지 첨부는 Windows에서만 지원합니다.');
  }

  const temp_path_var = buildTempPath_func(index_var);
  await fs.mkdir(path.dirname(temp_path_var), { recursive: true });

  const script_var = buildPowerShellCaptureScript_func(temp_path_var);
  const encoded_script_var = Buffer.from(script_var, 'utf16le').toString('base64');

  try {
    const result_var = await exec_file_async_func(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', encoded_script_var],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    const parsed_var = JSON.parse((result_var.stdout ?? '').trim()) as CaptureResult;

    return {
      label_var: `img${index_var}`,
      file_name_var: path.basename(parsed_var.path),
      temp_path_var: parsed_var.path,
      mime_type_var: 'image/png',
      byte_size_var: parsed_var.sizeBytes,
      width_px_var: parsed_var.width,
      height_px_var: parsed_var.height,
    };
  } catch (error_var) {
    await cleanupClipboardImage_func(temp_path_var);

    const stderr_var = error_var instanceof Error && 'stderr' in error_var
      ? String((error_var as { stderr?: string }).stderr ?? '')
      : '';
    const stdout_var = error_var instanceof Error && 'stdout' in error_var
      ? String((error_var as { stdout?: string }).stdout ?? '')
      : '';
    const decoded_error_var = decodeCliXmlMessage_func(`${stderr_var}\n${stdout_var}`);

    if (decoded_error_var.includes('NO_IMAGE_IN_CLIPBOARD')) {
      throw new Error('클립보드에 이미지가 없습니다. 캡처 또는 복사 후 다시 Alt+V를 누르세요.');
    }

    throw new Error(`클립보드 이미지 캡처 실패: ${decoded_error_var || String(error_var)}`);
  }
}

export async function cleanupClipboardImage_func(temp_path_var: string): Promise<void> {
  try {
    await fs.unlink(temp_path_var);
  } catch {
    // ignore
  }
}

export async function cleanupClipboardImages_func(attachments_var: ClipboardImageAttachment[]): Promise<void> {
  await Promise.all(attachments_var.map((attachment_var) => cleanupClipboardImage_func(attachment_var.temp_path_var)));
}
