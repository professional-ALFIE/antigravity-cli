import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPowerShellCaptureScript_func, decodeCliXmlMessage_func } from '../src/clipboard-image.ts';

test('클립보드 캡처 스크립트는 해시 리터럴을 줄바꿈으로 유지한다', () => {
  const script_var = buildPowerShellCaptureScript_func('C:\\temp\\sample.png');
  assert.match(script_var, /\[pscustomobject\]@\{\n/u);
  assert.doesNotMatch(script_var, /@\{;/u);
});

test('CLIXML 에러는 읽을 수 있는 일반 문자열로 정리한다', () => {
  const decoded_var = decodeCliXmlMessage_func('#< CLIXML\r\n<Objs><S S="Error">NO_IMAGE_IN_CLIPBOARD_x000D__x000A_</S></Objs>');
  assert.equal(decoded_var, 'NO_IMAGE_IN_CLIPBOARD');
});
