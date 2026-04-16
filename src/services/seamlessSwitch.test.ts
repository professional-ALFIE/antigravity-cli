import { describe, expect, test } from 'bun:test';

import { evaluateSeamlessSwitchFeasibility_func } from './seamlessSwitch.js';

describe('evaluateSeamlessSwitchFeasibility_func', () => {
  test('returns unsupported when no plugin transport exists', () => {
    const result_var = evaluateSeamlessSwitchFeasibility_func({
      hasPluginTransport: false,
      hasLiveLanguageServer: true,
      hasUnifiedStatePushPath: false,
    });

    expect(result_var.mode).toBe('unsupported');
    expect(result_var.recommendedFallback).toBe('full-switch');
  });

  test('returns experimental when live LS exists and USS push path is available', () => {
    const result_var = evaluateSeamlessSwitchFeasibility_func({
      hasPluginTransport: false,
      hasLiveLanguageServer: true,
      hasUnifiedStatePushPath: true,
    });

    expect(result_var.mode).toBe('experimental');
    expect(result_var.recommendedFallback).toBe('full-switch');
  });
});
