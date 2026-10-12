/**
 * @bibliotype/vue 构建配置（Vite 库模式 + Vitest）
 *
 * 含 .vue SFC，无法使用仓库其他包的 tsup 模式：
 * - 构建：Vite 库模式输出 ESM + CJS，vite-plugin-dts 产出类型；
 * - 测试：Vitest（插件编译 SFC，happy-dom 提供 DOM 环境）。
 */
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    vue(),
    dts({
      tsconfigPath: './tsconfig.json',
      include: ['src'],
      exclude: ['src/__tests__'],
    }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    /* workspace 包、vue 与 prosemirror 由使用方解析，不打入产物 */
    rollupOptions: {
      external: ['vue', /^@bibliotype\//, /^prosemirror-/],
    },
    sourcemap: true,
    target: 'es2020',
  },
  test: {
    environment: 'happy-dom',
  },
});
