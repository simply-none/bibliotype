# 15 SSR 与 Node 同构须知

> 涉及包：全仓　·　相关：[10 存储适配器](10-storage-adapters.md)、[13 核心运行时](13-core-runtime.md)、[14 常见问题与故障排查](14-faq.md)、[16 测试指南](16-testing.md)

bibliotype 的多数模块是**纯函数 / 无 DOM 状态机**，可在 Node（SSR、构建脚本、批量处理）中直接使用；
少数 API 依赖浏览器能力，需要替代方案或限定客户端执行。本文给出环境对照与典型场景处理。

## 环境对照表

| 模块 / API | Node / SSR | 说明 |
| --- | --- | --- |
| `@bibliotype/core`（IR / 插件 / 主题 / 事件总线） | ✅ | 纯数据逻辑 |
| `@bibliotype/layout`（分页 / 布局选项 / 直排合并） | ✅ | 纯计算，无 DOM |
| `@bibliotype/layout/html`（`serializeNode` / `buildBookCss`） | ✅ | 字符串生成 |
| `@bibliotype/reader` | ✅ | 无 DOM 的阅读状态机 |
| `@bibliotype/classical` | ✅ | 节点 / 标记定义、主题与编辑命令（数据与逻辑层） |
| `@bibliotype/collab` | ✅ | IR ⇄ Y.Doc 映射与会话为纯 JS；内置 `InMemoryProvider`，网络传输由适配包提供 |
| `@bibliotype/exporter-epub` | ✅ | 不依赖 DOM 与文件系统，产物为 `Uint8Array` |
| `@bibliotype/exporter-pdf`：`renderPrintHtml` / `buildPrintCss` | ✅ | 打印 HTML 与 CSS 生成为纯函数 |
| `@bibliotype/exporter-pdf`：`printHtml` / `printBook` | ❌ | 需要 `document` 与浏览器打印环境 |
| `@bibliotype/adapter-indexeddb`：`MemoryAdapter` | ✅ | 内存实现，适合测试与 SSR |
| `@bibliotype/adapter-indexeddb`：`IndexedDbAdapter` | ⚠️ | 缺省取全局 `indexedDB`；Node 注入 `factory`（`fake-indexeddb`）或改用 `MemoryAdapter` |
| `@bibliotype/adapter-sqlite` | ✅ | 无 DOM 依赖；宿主注入 better-sqlite3 / sql.js 驱动即可 |
| `@bibliotype/provider-websocket`：Provider | ⚠️ | 浏览器用原生 WebSocket / BroadcastChannel；Node 注入 `ws` 的 WebSocket |
| `@bibliotype/provider-websocket`：参考服务端 | ✅ | Node 环境，需宿主安装可选 peer `ws` |
| `@bibliotype/import`（TXT / Markdown / HTML / front-matter） | ✅ | 文本解析为纯函数 |
| `@bibliotype/import-epub`（ZIP 解析 → IR） | ✅ | Node/浏览器均可；不依赖 DOM |
| `@bibliotype/import-docx`（mammoth → HTML → IR） | ✅ | 解析为纯数据转换 |
| `@bibliotype/exporter-site`（站点 ZIP） | ✅ | 纯字符串与 ZIP 打包，不依赖 DOM 与文件系统 |
| `@bibliotype/editor`：规格注册 / schema / `BookEditor` 状态机 | ✅ | IR ⇄ PM 转换与事务为纯逻辑 |
| `@bibliotype/editor`：视图绑定（`attach`） | ❌ | ProseMirror 视图需要 DOM |
| `@bibliotype/vue`：`useReader` / `useReaderBinding` | ✅ | 组合式状态绑定，无 DOM |
| `@bibliotype/vue`：`useEditorBinding` | ⚠️ | 状态机可创建；挂载视图（`attach`）需要 DOM，服务端不调用即可 |
| `@bibliotype/vue`：`BtBookView` / `BtEditor` 等组件 | ❌ | 渲染与样式注入（`onMounted`）需要 DOM；SSR 框架中按仅客户端处理 |

图例：✅ 可直接使用　⚠️ 注入替代能力后可用　❌ 仅浏览器。

## Node 导入冒烟护栏（I9）

上表「✅」的判定由自动化用例守护：core / layout / reader / import / import-epub /
import-docx / exporter-epub / exporter-pdf / exporter-site 九个关键包各有
`src/__tests__/exports.test.ts`，在**默认 node 环境**动态导入包入口，断言关键导出存在、
`typeof document` 全程为 `undefined`——任何新增的顶层 DOM 依赖都会让该测试失败。
CI 以 Node 20/22 双版本矩阵运行同一套测试（见 [12 工程化与发布](12-release-and-ci.md)）。

新增「Node 可用」包时同步补 `exports.test.ts`；包若引入顶层 DOM 依赖（如 vue 组件
包），不应添加该测试，并在对照表中标注 ❌ / ⚠️ 与原因。

## 典型场景

### Node 脚本：离线导出 / 批量转换

```ts
import { renderPrintHtml } from '@bibliotype/exporter-pdf';
import { exportEpub } from '@bibliotype/exporter-epub';

const html = renderPrintHtml(document);   // 纯函数：IR → 打印优化 HTML
const bytes = exportEpub(document);       // Uint8Array，可写盘
```

### 测试环境

- 纯包（core / layout / reader / …）：默认 Node 环境即可；
- DOM 依赖（vue 组件）：`happy-dom`（vue 包已在 `vite.config.ts` 配置）；
- `IndexedDbAdapter`：注入 `factory: fake-indexeddb`；详见 [16 测试指南](16-testing.md)。

### SSR（Nuxt / Vite SSR）

- 导入纯函数包无限制（可在 setup / loader 中直接调用 `Reader`、`exportEpub` 等）；
- 视图组件（`BtEditor` / `BtBookView`）限定客户端：Nuxt 用 `<ClientOnly>`，Vite SSR 用动态导入；
- `BtBookView` 的样式注入与 `ResizeObserver` 均在 `onMounted` 中进行（服务端不执行），但为渲染一致性仍建议仅客户端挂载。

## 相关

- 非浏览器环境报错的排查：[14 常见问题与故障排查](14-faq.md) 第 4 条
- 存储适配器选择：[10 存储适配器](10-storage-adapters.md)
- 测试组织与运行：[16 测试指南](16-testing.md)
