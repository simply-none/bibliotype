/**
 * @bibliotype/adapter-http 统一导出入口
 *
 * 实现 core 的两个端口：
 * - `StorageAdapter`：文档整存整取（REST）；
 * - `AssetStore`：资产字节读写（图片 / 字体 / 音频）。
 *
 * 服务端端点契约见包 README 与 docs/29。
 */
export { createHttpAdapter, HttpAdapterError } from './adapter.js';
export type { HttpAdapterOptions } from './adapter.js';
export { resolveGlobalFetch } from './fetch-port.js';
export type { FetchLike, HttpRequestInit, HttpResponseLike, HttpHeadersLike } from './fetch-port.js';
