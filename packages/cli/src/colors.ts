/**
 * ANSI 컬러 유틸리티.
 * 외부 의존성(chalk) 없이 ANSI escape code 직접 사용.
 * NO_COLOR 환경변수 (https://no-color.org/) 및 --no-color 플래그 지원.
 */

const enabled_var =
  !process.env.NO_COLOR && !process.argv.includes('--no-color');

function wrap_func(code_var: string) {
  return (text_var: string) =>
    enabled_var ? `\x1b[${code_var}m${text_var}\x1b[0m` : text_var;
}

export const c = {
  green: wrap_func('32'),   // 성공 ✓
  red: wrap_func('31'),     // 실패 ✗
  cyan: wrap_func('36'),    // cascade ID
  dim: wrap_func('2'),      // 키/라벨
  bold: wrap_func('1'),     // 강조
  yellow: wrap_func('33'),  // 경고
};
