import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 引擎测试全部为纯函数 / 状态机，无需 DOM 环境，默认 node 即可
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
