---
'@bibliotype/core': patch
'@bibliotype/layout': patch
'@bibliotype/reader': patch
---

P4 批 1（I4）：覆盖率统一配置与阈值门槛。各包新增 `test:coverage` 脚本（v8 provider，`text + lcov` 报告，排除 `__tests__` / fixtures / 类型声明）；`core` / `layout` / `reader` 按真实基线略下调设阈值（行 82 / 94 / 95）在 CI 拦截回归，其余包只报告不拦；CI 以 `pnpm test:coverage` 取代测试步骤并把各包 `coverage/lcov.info` 归档为 artifact。
