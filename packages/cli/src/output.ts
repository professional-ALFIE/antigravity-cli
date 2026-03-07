/**
 * 터미널 출력 헬퍼.
 * 컬러 코드 없이 읽기 쉬운 포맷으로 출력한다.
 */

/** 성공 결과를 보기 좋게 출력 */
export function printResult(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data === null || data === undefined) {
    console.log('(empty)');
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log('(no items)');
      return;
    }
    printTable(data);
    return;
  }

  if (typeof data === 'object') {
    printKeyValue(data as Record<string, unknown>);
    return;
  }

  console.log(String(data));
}

/** 배열을 테이블 형태로 출력 */
function printTable(items: unknown[]): void {
  // 첫 번째 항목의 키를 컬럼으로 사용
  const first = items[0];
  if (typeof first !== 'object' || first === null) {
    for (const item of items) {
      console.log(`  - ${String(item)}`);
    }
    return;
  }

  const keys = Object.keys(first);
  const widths = new Map<string, number>();

  // 컬럼 너비 계산
  for (const key of keys) {
    let maxWidth = key.length;
    for (const item of items) {
      const value = String((item as Record<string, unknown>)[key] ?? '');
      maxWidth = Math.max(maxWidth, value.length);
    }
    widths.set(key, Math.min(maxWidth, 40)); // 최대 40자
  }

  // 헤더
  const header = keys.map((key) => key.padEnd(widths.get(key)!)).join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  // 행
  for (const item of items) {
    const row = keys
      .map((key) => {
        const value = String((item as Record<string, unknown>)[key] ?? '');
        return value.slice(0, 40).padEnd(widths.get(key)!);
      })
      .join('  ');
    console.log(row);
  }
}

/** 객체를 key: value 형태로 출력 */
function printKeyValue(obj: Record<string, unknown>, indent = 0): void {
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      console.log(`${prefix}${key}:`);
      printKeyValue(value as Record<string, unknown>, indent + 1);
    } else {
      console.log(`${prefix}${key}: ${JSON.stringify(value)}`);
    }
  }
}

/** 에러 메시지 출력 */
export function printError(message: string): void {
  console.error(`✗ ${message}`);
}
