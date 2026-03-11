import test from 'node:test';
import assert from 'node:assert/strict';
import {
  default_model_name_var,
  documented_models_var,
  resolveModelId_func,
} from '../src/model-resolver.ts';

test('기본 모델은 claude-opus-4.6 이다', () => {
  assert.equal(default_model_name_var, 'claude-opus-4.6');
  assert.equal(resolveModelId_func(), 'MODEL_PLACEHOLDER_M26');
});

test('canonical 모델명이 올바른 internal ID 로 해석된다', () => {
  assert.equal(resolveModelId_func('claude-opus-4.6'), 'MODEL_PLACEHOLDER_M26');
  assert.equal(resolveModelId_func('claude-sonnet-4.6'), 'MODEL_PLACEHOLDER_M35');
  assert.equal(resolveModelId_func('gemini-3.1-pro-high'), 'MODEL_PLACEHOLDER_M37');
  assert.equal(resolveModelId_func('gemini-3.1-pro'), 'MODEL_PLACEHOLDER_M36');
  assert.equal(resolveModelId_func('gemini-3-flash'), 'MODEL_PLACEHOLDER_M18');
});

test('기존 짧은 별칭도 계속 지원한다', () => {
  assert.equal(resolveModelId_func('opus'), 'MODEL_PLACEHOLDER_M26');
  assert.equal(resolveModelId_func('sonnet'), 'MODEL_PLACEHOLDER_M35');
  assert.equal(resolveModelId_func('pro-high'), 'MODEL_PLACEHOLDER_M37');
  assert.equal(resolveModelId_func('pro'), 'MODEL_PLACEHOLDER_M36');
  assert.equal(resolveModelId_func('flash'), 'MODEL_PLACEHOLDER_M18');
});

test('exact internal ID 는 그대로 통과시킨다', () => {
  assert.equal(resolveModelId_func('MODEL_PLACEHOLDER_M18'), 'MODEL_PLACEHOLDER_M18');
  assert.equal(resolveModelId_func('MODEL_PLACEHOLDER_M26'), 'MODEL_PLACEHOLDER_M26');
});

test('gpt 와 알 수 없는 모델명은 로컬 에러로 막는다', () => {
  assert.throws(() => resolveModelId_func('gpt'), /Unknown model/u);
  assert.throws(() => resolveModelId_func('MODEL_CLAUDE_4_OPUS'), /Unknown model/u);
  assert.throws(() => resolveModelId_func('totally-unknown-model'), /Unknown model/u);
});

test('문서화된 모델 목록은 canonical 이름 다섯 개만 노출한다', () => {
  assert.deepEqual(
    documented_models_var.map((model_var) => model_var.cliName),
    [
      'claude-opus-4.6',
      'claude-sonnet-4.6',
      'gemini-3.1-pro-high',
      'gemini-3.1-pro',
      'gemini-3-flash',
    ],
  );
});
