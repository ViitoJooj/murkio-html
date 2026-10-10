import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', define: 'src/define.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
    noExternal: ['@murkio/spec'],
  },
  {
    entry: { murkio: 'src/cdn.ts' },
    format: ['iife'],
    globalName: 'Murkio',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    noExternal: ['@murkio/spec'],
    outExtension: () => ({ js: '.js' }),
  },
]);
