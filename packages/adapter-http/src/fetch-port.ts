/**
 * HTTP 端口（最小契约）
 *
 * 不直接依赖 DOM 的 `fetch` 类型：便于在 Node / Electron / 测试中注入任意实现
 * （`globalThis.fetch`、`undici`、宿主桥接均可）。副作用集中在适配器最外层。
 */

/** 请求初始化（最小字段集） */
export interface HttpRequestInit {
  /** HTTP 方法 */
  method?: string;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体（字符串或字节） */
  body?: string | Uint8Array;
}

/** 响应头读取端口（可选，用于取资产 MIME） */
export interface HttpHeadersLike {
  /** 读取响应头（缺省返回 null） */
  get(name: string): string | null;
}

/** 响应（最小字段集） */
export interface HttpResponseLike {
  /** 是否 2xx */
  ok: boolean;
  /** 状态码 */
  status: number;
  /** 响应头（可选；提供后可还原资产 mediaType） */
  headers?: HttpHeadersLike;
  /** 解析 JSON（内容非法时可抛错，由适配器兜底） */
  json(): Promise<unknown>;
  /** 读取原始字节 */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 可注入的 fetch 实现 */
export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponseLike>;

/**
 * 取全局 fetch（无 fetch 环境返回 undefined）
 *
 * 用结构化判断而不是 `typeof fetch`，避免在无 DOM lib 的宿主里出现类型缺失。
 */
export function resolveGlobalFetch(): FetchLike | undefined {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') {
    return undefined;
  }
  return candidate as FetchLike;
}
