import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDisplayWidth_func, fitSpinnerText_func } from '../src/spinner.ts';

test('한글 폭은 ASCII 보다 넓게 계산한다', () => {
  assert.equal(estimateDisplayWidth_func('abc'), 3);
  assert.equal(estimateDisplayWidth_func('대기'), 4);
});

test('짧은 스피너 문구는 그대로 유지한다', () => {
  assert.equal(fitSpinnerText_func('Bridge 대기', 40), 'Bridge 대기');
});

test('긴 스피너 문구는 터미널 폭 안으로 잘라낸다', () => {
  const rendered_var = fitSpinnerText_func('Bridge 대기 - 백그라운드 인스턴스 새로 시작 중... 이후 실행은 즉시 연결됩니다.', 28);
  assert.ok(estimateDisplayWidth_func(rendered_var) <= 24);
  assert.match(rendered_var, /\.\.\.$/u);
});
