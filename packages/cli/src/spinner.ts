/**
 * spinner.ts — ANSI 기반 CLI 스피너 (외부 의존성 없음).
 *
 * NO_COLOR / --no-color 환경에서는 애니메이션 없이 점(.) 출력.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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
      process.stderr.write(`  ${text_var}`);
      return;
    }

    // 커서 숨기기
    process.stderr.write('\x1b[?25l');
    this._timer = setInterval(() => {
      const frame_var = FRAMES[this._frame_idx % FRAMES.length];
      process.stderr.write(`\r\x1b[2K  ${frame_var} ${this._text}`);
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
    process.stderr.write(`\r\x1b[2K  ${icon_var} ${text_var}\n`);
  }

  fail(text_var: string): void {
    this._stop();
    const icon_var = this._noColor ? '[FAIL]' : '\x1b[31m✗\x1b[0m';
    process.stderr.write(`\r\x1b[2K  ${icon_var} ${text_var}\n`);
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
}
