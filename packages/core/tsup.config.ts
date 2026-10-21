import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'es2020',
  },
  {
    /* 测试子入口：只出 ESM，vitest 由使用方提供（external，不进产物） */
    entry: { 'testing/index': 'src/testing/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    target: 'es2020',
    external: ['vitest'],
  },
]);
