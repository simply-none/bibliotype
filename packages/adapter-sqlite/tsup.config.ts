import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  /* 驱动（better-sqlite3 / sql.js / 宿主封装）一律由宿主注入，包本身零引擎依赖 */
  external: ['@bibliotype/core'],
});
