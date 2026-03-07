import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  external: ['vscode'],
  // antigravity-sdk는 번들에 포함 (Extension 내부에서 직접 사용)
  noExternal: ['antigravity-sdk'],
});
