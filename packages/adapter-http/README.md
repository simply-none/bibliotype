# @bibliotype/adapter-http

远端存储适配器：实现 core 的 `StorageAdapter`（文档）与 `AssetStore`（资产），基于 REST 契约。

## 安装

```bash
pnpm add @bibliotype/adapter-http @bibliotype/core
```

## 快速上手

```ts
import { createHttpAdapter } from '@bibliotype/adapter-http';

const adapter = createHttpAdapter({
  baseUrl: 'https://api.example.com/books',
  headers: { Authorization: 'Bearer <token>' },
});

await adapter.save('book-1', document, { updatedAt: Date.now() });
const loaded = await adapter.load('book-1');

// 资产（图片 / 字体 / 音频）
await adapter.putAsset('cover', { mediaType: 'image/png', data: bytes });
```

## 端点契约

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| `PUT` | `/documents/:id` | body `{ document, updatedAt }` |
| `GET` | `/documents/:id` | → `{ document }`；404 未命中 |
| `GET` | `/documents` | → `{ documents: DocumentSummary[] }` |
| `DELETE` | `/documents/:id` | 2xx / 404 |
| `DELETE` | `/documents` | 清空 |
| `PUT` | `/assets/:id` | 原始字节，`Content-Type` 为 MIME |
| `GET` | `/assets/:id` | 原始字节（靠响应 `Content-Type` 还原 mediaType） |
| `GET` | `/assets` | → `{ assets: AssetRef[] }` |
| `DELETE` | `/assets/:id` | 2xx / 404 |

## API 概览

| 分组 | 导出 |
| --- | --- |
| 适配器 | `createHttpAdapter` / `HttpAdapterError`、`HttpAdapterOptions` |
| 端口类型 | `FetchLike` / `HttpRequestInit` / `HttpResponseLike` / `HttpHeadersLike` |
| 工具 | `resolveGlobalFetch` |

## 约定

- 除 404 外，非 2xx 一律抛 `HttpAdapterError`（含 `status` / `path`），不静默吞错；
- 网络异常包装为 `status = 0`；
- 读到的 `document` 不是合法 IR 时抛错，不返回脏数据；
- `updatedAt` 由 `SaveOptions` 注入（缺省取 `clock`），保证可测与可回溯；
- 资产哈希由 core 的 `toAssetRef` 统一计算（FNV-1a，可用于去重）。

## 相关

- 功能参考：[docs/29-adapter-http.md](../../docs/29-adapter-http.md)
- 存储契约：[docs/10-storage-adapters.md](../../docs/10-storage-adapters.md)
- 仓库主页：[bibliotype](../../README.md)
