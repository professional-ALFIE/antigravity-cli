export function evaluateSeamlessSwitchFeasibility_func(options_var: {
  hasPluginTransport: boolean;
  hasLiveLanguageServer: boolean;
  hasUnifiedStatePushPath: boolean;
}): {
  mode: 'unsupported' | 'experimental';
  reason: string;
  recommendedFallback: 'full-switch';
} {
  if (options_var.hasPluginTransport) {
    return {
      mode: 'experimental',
      reason: 'Plugin transport exists; seamless switch may be attempted experimentally.',
      recommendedFallback: 'full-switch',
    };
  }

  if (options_var.hasLiveLanguageServer && options_var.hasUnifiedStatePushPath) {
    return {
      mode: 'experimental',
      reason: 'Live LS exists and USS push path may allow experimental token refresh without restart.',
      recommendedFallback: 'full-switch',
    };
  }

  return {
    mode: 'unsupported',
    reason: 'No plugin transport or validated live LS token reload path exists in this CLI architecture.',
    recommendedFallback: 'full-switch',
  };
}
