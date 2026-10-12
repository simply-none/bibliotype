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
| `vue` | `happy-dom`（`vite.config.ts` 中 `test.environment`）+ `@vue/test-utils`；SFC 由 Vite 插件编译 |

## 常用命令

```bash
pnpm test                                             # 全仓（turbo 并行；含依赖构建）
pnpm --filter @bibliotype/core test                   # 单包
pnpm --filter @bibliotype/core exec vitest            # 单包 watch 模式
pnpm --filter @bibliotype/layout exec vitest run book-css   # 指定文件
```

## 编写约定

- 断言聚焦**对外行为**（公共导出的输入输出），不锁定内部实现细节；
- 时间相关逻辑通过参数注入获得确定性（如 `SaveOptions.updatedAt`，见 [10](10-storage-adapters.md)）；
- 避免随机性：导出标识符等必须可复现（见 [07 EPUB 导出](07-export-epub.md) 确定性一节）；
- 跨包行为经公共入口消费（如 layout 的 HTML / 样式用例经 `@bibliotype/layout/html` 导入）；
- core 节点类型增删改后必须跑**全量回归**——editor 规格表同步问题的典型暴露路径（见 [14](14-faq.md) 第 5 条）。

## 相关

- 工程化与发布：[12 工程化与发布](12-release-and-ci.md)
- 环境对照（哪些模块可以 Node 直跑）：[15 SSR 与 Node 同构](15-ssr-and-node.md)
