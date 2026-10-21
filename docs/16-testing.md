# 16 测试指南

> 涉及包：全仓　·　相关：[12 工程化与发布](12-release-and-ci.md)、[14 常见问题与故障排查](14-faq.md)、[15 SSR 与 Node 同构](15-ssr-and-node.md)

## 组织方式

- 测试文件统一放在各包 `src/__tests__/` 下，命名 `*.test.ts`（与源码同包，就近维护）；
- 运行器统一 **Vitest**：各包 `package.json` 的 `"test": "vitest run"`，由 turbo 全仓并行调度；
- turbo 中 `test` 任务依赖 `^build`：上游包先构建、测试经**包入口**消费产物，以使用者视角验证导出面（而非源码路径直引）。

| 包 | 环境要点 |
| --- | --- |
| `core` / `layout` / `reader` / `classical` / `collab` / `exporter-epub` / `exporter-pdf` / `editor` | Node 环境（纯函数与状态机） |
| `adapter-indexeddb` | `fake-indexeddb` 注入 `factory`（仅 IndexedDB 相关用例；`MemoryAdapter` 零依赖） |
| `adapter-sqlite` | `sql.js`（WASM，devDependency）建内存库跑真实 SQL；契约套件来自 `@bibliotype/core/testing` |
| `provider-websocket` | Node 原生 `BroadcastChannel` + 假 socket 单测；e2e 用 `ws`（devDependency）起参考服务端（端口 0） |
| `vue` | `happy-dom`（`vite.config.ts` 中 `test.environment`）+ `@vue/test-utils`；SFC 由 Vite 插件编译 |

## 常用命令

```bash
pnpm test                                             # 全仓（turbo 并行；含依赖构建）
pnpm test:coverage                                    # 全仓覆盖率（turbo 并行；含阈值拦截）
pnpm --filter @bibliotype/core test                   # 单包
pnpm --filter @bibliotype/core exec vitest            # 单包 watch 模式
pnpm --filter @bibliotype/layout exec vitest run book-css   # 指定文件
```

## 覆盖率（I4）

统一配置在根 `vitest.shared.ts` 的 `createVitestConfig()` 工厂：v8 provider、
`include: ['src/**']`、排除 `__tests__` / fixtures / 类型声明 / dist、reporter
`text + lcov`。各包 `"test:coverage": "vitest run --coverage"`（turbo 任务
`test:coverage` 与 `test` 同构，依赖 `^build`）。

**阈值拦截**：core / layout / reader 通过各自 `vitest.config.ts` 设阈值（按交付时真实
基线略下调，宁低勿假绿）；其余包只出报告不拦。低于阈值时 vitest 输出
`Coverage for lines (…) does not meet global threshold (…)` 并以非 0 退出，CI 随之失败。

| 包 | 行 / 语句 | 函数 | 分支 | 交付时基线（行/分支/函数） |
| --- | --- | --- | --- | --- |
| `core` | 82 | 85 | 80 | 84.55 / 82.36 / 87.57 |
| `layout` | 94 | 94 | 85 | 96.28 / 87.64 / 96.29 |
| `reader` | 95 | 93 | 87 | 96.88 / 89.18 / 94.87 |

CI 在 `pnpm test:coverage` 后把各包 `coverage/lcov.info` 归档为 artifact
（`coverage-lcov-node<版本>`，保留 7 天），阈值失败也能下载定位（见 [12](12-release-and-ci.md)）。

> 仓库约定（`.gitattributes`）：`*.mjs` 一律 LF。Windows 下 `core.autocrlf=true` 检出的
> CRLF 会让 vitest/vite-node 对带 import 的 `.mjs`（如 `scripts/version.mjs`）的 SSR
> 重写产生坏代码（`SyntaxError: Invalid or unexpected token`）；`.ts` 经 esbuild 规范化
> 不受影响。测试中导入仓内 `.mjs` 前请确认工作区文件为 LF。

## 编写约定

- 断言聚焦**对外行为**（公共导出的输入输出），不锁定内部实现细节；
- 时间相关逻辑通过参数注入获得确定性（如 `SaveOptions.updatedAt`，见 [10](10-storage-adapters.md)）；
- 避免随机性：导出标识符等必须可复现（见 [07 EPUB 导出](07-export-epub.md) 确定性一节）；
- 跨包行为经公共入口消费（如 layout 的 HTML / 样式用例经 `@bibliotype/layout/html` 导入）；
- core 节点类型增删改后必须跑**全量回归**——editor 规格表同步问题的典型暴露路径（见 [14](14-faq.md) 第 5 条）。

## 相关

- 工程化与发布：[12 工程化与发布](12-release-and-ci.md)
- 环境对照（哪些模块可以 Node 直跑）：[15 SSR 与 Node 同构](15-ssr-and-node.md)
