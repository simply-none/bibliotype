import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // 组件测试需要解析 .vue 单文件组件（其余纯逻辑测试不受影响）
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
