/**
 * vitest 配置（core 包）
 *
 * 覆盖率门槛（I4）：阈值按真实基线（行 84.55 / 分支 82.36 / 函数 87.57）略下调设定。
 */
import { createVitestConfig } from '../../vitest.shared';

export default createVitestConfig({
  thresholds: {
    lines: 82,
    statements: 82,
    functions: 85,
    branches: 80,
  },
});
