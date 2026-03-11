/**
 * spinner.ts — ANSI 기반 CLI 스피너 (외부 의존성 없음).
 *
 * NO_COLOR / --no-color 환경에서는 애니메이션 없이 점(.) 출력.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_PREFIX_WIDTH = 4;
const ELLIPSIS = '...';

function isWideCodePoint_func(code_point_var: number): boolean {
  return (
    (code_point_var >= 0x1100 && code_point_var <= 0x115f)
    || code_point_var === 0x2329
    || code_point_var === 0x232a
    || (code_point_var >= 0x2e80 && code_point_var <= 0xa4cf && code_point_var !== 0x303f)
    || (code_point_var >= 0xac00 && code_point_var <= 0xd7a3)
    || (code_point_var >= 0xf900 && code_point_var <= 0xfaff)
    || (code_point_var >= 0xfe10 && code_point_var <= 0xfe19)
    || (code_point_var >= 0xfe30 && code_point_var <= 0xfe6f)
    || (code_point_var >= 0xff00 && code_point_var <= 0xff60)
    || (code_point_var >= 0xffe0 && code_point_var <= 0xffe6)
    || (code_point_var >= 0x1f300 && code_point_var <= 0x1faff)
    || (code_point_var >= 0x20000 && code_point_var <= 0x3fffd)
  );
}

function codePointWidth_func(code_point_var: number): number {
  if (code_point_var === 0) return 0;
  if (code_point_var < 32 || (code_point_var >= 0x7f && code_point_var < 0xa0)) return 0;
  return isWideCodePoint_func(code_point_var) ? 2 : 1;
}

export function estimateDisplayWidth_func(text_var: string): number {
  let width_var = 0;

  for (const char_var of text_var) {
    width_var += codePointWidth_func(char_var.codePointAt(0) ?? 0);
  }

  return width_var;
}

export function fitSpinnerText_func(
  text_var: string,
  columns_var: number | undefined = process.stderr.columns,
  prefix_width_var: number = SPINNER_PREFIX_WIDTH,
): string {
  const single_line_text_var = text_var.replace(/[\r\n\t]+/gu, ' ').trim();
  if (!columns_var || columns_var <= 0) {
    return single_line_text_var;
  }

  const max_width_var = Math.max(columns_var - prefix_width_var, ELLIPSIS.length);
  if (estimateDisplayWidth_func(single_line_text_var) <= max_width_var) {
    return single_line_text_var;
  }

  if (max_width_var <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, max_width_var);
  }

  const target_width_var = max_width_var - ELLIPSIS.length;
  let rendered_var = '';
  let rendered_width_var = 0;

  for (const char_var of single_line_text_var) {
    const char_width_var = codePointWidth_func(char_var.codePointAt(0) ?? 0);
    if (rendered_width_var + char_width_var > target_width_var) {
      break;
    }

    rendered_var += char_var;
    rendered_width_var += char_width_var;
  }

  return `${rendered_var}${ELLIPSIS}`;
}

export class Spinner {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _frame_idx = 0;
  private _text = '';
  private readonly _noColor: boolean;

  constructor() {
    this._noColor = !!process.env['NO_COLOR'] || process.argv.includes('--no-color');
  }

  start(text_var: string): void {
    this._text = text_var;
    if (this._timer) return;

    if (this._noColor) {
      process.stderr.write(`  ${this._fitText_func(text_var)}`);
      return;
    }

    // 커서 숨기기
    process.stderr.write('\x1b[?25l');
    this._timer = setInterval(() => {
      const frame_var = FRAMES[this._frame_idx % FRAMES.length];
      process.stderr.write(`\r\x1b[2K  ${frame_var} ${this._fitText_func(this._text)}`);
      this._frame_idx++;
    }, 80);
  }

  update(text_var: string): void {
    this._text = text_var;
    if (this._noColor) {
      process.stderr.write('.');
    }
  }

  succeed(text_var: string): void {
    this._stop();
    const icon_var = this._noColor ? '[OK]' : '\x1b[32m✓\x1b[0m';
    process.stderr.write(`\r\x1b[2K  ${icon_var} ${this._fitText_func(text_var)}\n`);
  }

  fail(text_var: string): void {
    this._stop();
    const icon_var = this._noColor ? '[FAIL]' : '\x1b[31m✗\x1b[0m';
    process.stderr.write(`\r\x1b[2K  ${icon_var} ${this._fitText_func(text_var)}\n`);
  }

  stop(): void {
    this._stop();
    process.stderr.write('\r\x1b[2K');
  }

  private _stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    // 커서 복원
    if (!this._noColor) {
      process.stderr.write('\x1b[?25h');
    }
  }

  private _fitText_func(text_var: string): string {
    return fitSpinnerText_func(text_var);
  }
}
