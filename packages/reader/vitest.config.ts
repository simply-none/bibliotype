/**
 * vitest 配置（reader 包）
 *
 * 覆盖率门槛（I4）：阈值按真实基线（行 96.88 / 分支 89.18 / 函数 94.87）略下调设定。
 */
import { createVitestConfig } from '../../vitest.shared';

export default createVitestConfig({
  thresholds: {
    lines: 95,
    statements: 95,
    functions: 93,
    branches: 87,
  },
});
