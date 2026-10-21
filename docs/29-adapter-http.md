# 29 远端存储适配器（HTTP / REST）

> 涉及包：`@bibliotype/adapter-http`（依赖 `@bibliotype/core`）
> 相关篇目：[10 存储适配器](10-storage-adapters.md) · [09 协同编辑](09-collab.md) · [15 SSR 与 Node 同构](15-ssr-and-node.md)

`@bibliotype/adapter-http` 实现 core 的三个端口：

- `StorageAdapter`：文档整存整取；
- `AssetStore`：资产字节读写（图片 / 字体 / 音频）；
- `BookLibraryStore`：书架查询（客户端过滤，服务端零改动，见第八节）。

`BookSummaryStore`（摘要补丁）**不实现**：HTTP 无该端点，阅读进度 / 标签更新请回落到整本 `save`。

## 一、用法

```ts
import { createHttpAdapter } from '@bibliotype/adapter-http';

const adapter = createHttpAdapter({
  baseUrl: 'https://api.example.com/books',
  headers: { Authorization: 'Bearer <token>' },   // 静态头
  resolveHeaders: () => ({ 'X-Trace': crypto.randomUUID() }),   // 动态头（每次请求求值）
});

await adapter.save('book-1', document, { updatedAt: 1760000000000 });
const loaded = await adapter.load('book-1');
const list = await adapter.list();
```

`close()` 只标记关闭，之后仍可继续使用（与 core 契约一致）；HTTP 无长连接句柄需释放。

## 二、端点契约

服务端按下表实现即可；`baseUrl` 末尾斜杠会被规范化。

| 方法 | 路径 | 请求 / 响应 |
| --- | --- | --- |
| `PUT` | `/documents/:id` | body `{ document, updatedAt }` → 2xx |
| `GET` | `/documents/:id` | → `{ document }`；404 表示未命中 |
| `GET` | `/documents` | → `{ documents: DocumentSummary[] }` |
| `DELETE` | `/documents/:id` | 2xx 删除成功；404 表示不存在 |
| `DELETE` | `/documents` | 清空 |
| `PUT` | `/assets/:id` | body 为原始字节，`Content-Type` 为 MIME → 2xx |
| `GET` | `/assets/:id` | → 原始字节（响应 `Content-Type` 还原 mediaType）；404 未命中 |
| `GET` | `/assets` | → `{ assets: AssetRef[] }` |
| `DELETE` | `/assets/:id` | 2xx / 404 |

路径前缀可用 `documentsPath` / `assetsPath` 覆盖。

## 三、错误语义

- 除 404（未命中 / 不存在）外，非 2xx 一律抛 `HttpAdapterError`，携带 `status` 与 `path`；
- 网络异常也包装为 `HttpAdapterError`（`status = 0`），错误信息含 URL 与原因；
- 读取到的 `document` 不是合法 IR（`isBookDocument` 判定失败）时抛错，**不返回脏数据**；
- `list` / `listAssets` 会过滤结构不合法的条目（服务端版本漂移时不至于整页崩溃）。

```ts
import { HttpAdapterError } from '@bibliotype/adapter-http';

try {
  await adapter.load('book-1');
} catch (error) {
  if (error instanceof HttpAdapterError && error.status === 0) {
    // 网络不可用：可切本地缓存
  }
}
```

## 四、资产

```ts
import { isAssetStore } from '@bibliotype/core';

if (isAssetStore(adapter)) {
  const ref = await adapter.putAsset('cover', { mediaType: 'image/png', data: bytes });
  // ref: { id, kind: 'image', mediaType, byteLength, hash }
  const payload = await adapter.getAsset('cover');
}
```

- `putAsset` 覆盖语义；返回的 `AssetRef` 由 core 的 `toAssetRef` 统一计算（含 FNV-1a 内容哈希）；
- `getAsset` 依赖响应头 `Content-Type` 还原 `mediaType`，缺失时回退 `application/octet-stream`；
- 资产与文档**分端存储**：正文只存 `asset:<id>` 引用，避免文档 JSON 膨胀。

## 五、注入 fetch（Node / Electron / 测试）

```ts
const adapter = createHttpAdapter({
  baseUrl: 'http://127.0.0.1:8787/api',
  fetchImpl: myFetch,     // 任意实现 (url, init) => Promise<{ ok, status, json, arrayBuffer, headers? }>
});
```

不注入时取 `globalThis.fetch`；无 fetch 环境会抛出明确错误（提示注入实现），
而不是在调用处出现 `fetch is not defined`。

## 六、服务端参考实现要点

- `PUT /documents/:id` 直接存 `{ document, updatedAt }`，列表按 `updatedAt` 降序返回；
- 文档与资产建议分表 / 分桶；文档走 JSON，资产走对象存储；
- 需要协同时可在此之上加 Yjs WebSocket 端点（见 [09](09-collab.md)），二者互不依赖；
- 鉴权用请求头透传，适配器不解析 token（保持端口中立）。

## 七、常见错误

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 保存成功但列表为空 | 服务端未按 `updatedAt` 冗余存储 | `DocumentSummary` 需含 `id / title / updatedAt` |
| 图片取回后类型丢失 | 响应未带 `Content-Type` | 服务端补响应头，或把 mediaType 记在资产元数据 |
| 401 时静默失败 | 调用方只判断了返回值 | 捕获 `HttpAdapterError` 并按 `status` 分流 |
| 跨域预检失败 | 自定义头触发 preflight | 服务端放行 `Authorization` / 自定义头 |

## 八、书架查询（H3）

适配器同时满足 `BookLibraryStore` 类型守卫，但 `query()` 是**客户端实现**：

```ts
import { isBookLibraryStore } from '@bibliotype/core';

if (isBookLibraryStore(adapter)) {
  const page = await adapter.query({ text: '朱熹', sortBy: 'recentRead', groupBy: 'tag', limit: 60 });
  // { items, total, groups }
}
```

- 取全量 `GET /documents` 摘要，再用 core 的 `queryDocumentSummaries` 做检索 / 排序 / 分组——
  **不新增服务端端点**，老服务端无需改造；
- 检索覆盖标题 / 作者 / ISBN / 标签；排序键 `recentRead` / `updated` / `title` / `wordCount` 中，
  除 `updated` 外的字段依赖服务端返回的摘要；缺字段自动回退（`mergeDocumentSummary`），不报错；
- 服务端只需保证 `id / title / updatedAt`，其余可选字段（`author` / `isbn` / `tags` /
  `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`）原样透传；
- 规模上限：每次查询都拉全量摘要，适合「几十到几百本」的个人书库；书库更大时应由服务端
  提供真正的查询端点，届时替换 `query` 实现即可，调用方代码不变。

> 能力差异：IndexedDB / 内存适配器实现 `BookSummaryStore`（增量写摘要），HTTP 不实现；
> 需要「更新阅读进度但不重写正文」时，HTTP 侧只能整本 `save`。
