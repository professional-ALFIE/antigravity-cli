import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAttachmentQueue_func } from '../src/interactive.ts';

function stripAnsi_func(value_var: string): string {
  return value_var.replace(/\x1b\[[0-9;]*m/g, '');
}

test('첨부 대기 포맷은 비어 있을 때 none 을 표시한다', () => {
  const rendered_var = stripAnsi_func(formatAttachmentQueue_func([]));
  assert.match(rendered_var, /첨부 대기:/u);
  assert.match(rendered_var, /\(none\)/u);
});

test('첨부 대기 포맷은 img 라벨을 모두 표시한다', () => {
  const rendered_var = stripAnsi_func(formatAttachmentQueue_func([
    {
      label_var: 'img1',
      file_name_var: 'img1.png',
      temp_path_var: 'C:\\temp\\img1.png',
      mime_type_var: 'image/png',
      byte_size_var: 123,
      width_px_var: 100,
      height_px_var: 100,
    },
    {
      label_var: 'img2',
      file_name_var: 'img2.png',
      temp_path_var: 'C:\\temp\\img2.png',
      mime_type_var: 'image/png',
      byte_size_var: 456,
      width_px_var: 200,
      height_px_var: 200,
    },
  ]));

  assert.match(rendered_var, /img1/u);
  assert.match(rendered_var, /img2/u);
});
