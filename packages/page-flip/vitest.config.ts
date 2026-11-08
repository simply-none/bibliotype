import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 引擎测试为纯函数 / 状态机（GL 与 DOM 均以测试桩注入），无需真实浏览器环境
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
