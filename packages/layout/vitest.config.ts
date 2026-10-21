/**
 * vitest 配置（layout 包）
 *
 * 覆盖率门槛（I4）：阈值按真实基线（行 96.28 / 分支 87.64 / 函数 96.29）略下调设定。
 */
import { createVitestConfig } from '../../vitest.shared';

export default createVitestConfig({
  thresholds: {
    lines: 94,
    statements: 94,
    functions: 94,
    branches: 85,
  },
});
