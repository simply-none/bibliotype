/**
 * 远端存储适配器（REST 端口实现）
 *
 * 端点契约（服务端按此实现即可，见 docs/29）：
 *
 * | 方法 | 路径 | 语义 |
 * | --- | --- | --- |
 * | PUT | `/documents/:id` | 保存文档，body `{ document, updatedAt }` |
 * | GET | `/documents/:id` | 读取文档 → `{ document }`；404 表示未命中 |
 * | GET | `/documents` | 列出摘要 → `{ documents: DocumentSummary[] }` |
 * | DELETE | `/documents/:id` | 删除 → 2xx 删除成功 / 404 不存在 |
 * | DELETE | `/documents` | 清空 |
 * | PUT | `/assets/:id` | 写入资产（body 为原始字节，`Content-Type` 为 MIME） |
 * | GET | `/assets/:id` | 读取资产 → 原始字节；404 未命中 |
 * | GET | `/assets` | 列出资产 → `{ assets: AssetRef[] }` |
 * | DELETE | `/assets/:id` | 删除资产 |
 *
 * 约定：
 * - 4xx / 5xx（除 404 语义外）一律抛 `HttpAdapterError`，不静默吞错；
 * - `updatedAt` 由 `SaveOptions` 注入（缺省取 clock），保证可测与可回溯；
 * - `close()` 仅标记关闭，之后仍可继续使用（与 core 契约一致）。
 */
import { isBookDocument, queryDocumentSummaries, toAssetRef } from '@bibliotype/core';
import type {
  AssetPayload,
  AssetRef,
  AssetStore,
  BookDocument,
  BookLibraryStore,
  BookQueryResult,
  DocumentQuery,
  DocumentSummary,
  PutAssetOptions,
  SaveOptions,
  StorageAdapter,
} from '@bibliotype/core';
import type { FetchLike } from './fetch-port.js';
import { resolveGlobalFetch } from './fetch-port.js';

/** 适配器选项 */
export interface HttpAdapterOptions {
  /** 服务基地址（如 `https://api.example.com/books`），末尾斜杠会被规范化 */
  baseUrl: string;
  /** fetch 实现（缺省取全局 fetch） */
  fetchImpl?: FetchLike;
  /** 静态请求头（如 Authorization） */
  headers?: Record<string, string>;
  /** 动态请求头（每次请求求值，用于刷新 token） */
  resolveHeaders?: () => Record<string, string>;
  /** 文档端点路径（缺省 `/documents`） */
  documentsPath?: string;
  /** 资产端点路径（缺省 `/assets`） */
  assetsPath?: string;
  /** 时钟（缺省 `Date.now`，测试可注入固定值） */
  clock?: () => number;
}

/** 适配器错误 */
export class HttpAdapterError extends Error {
  /** HTTP 状态码（网络错误为 0） */
  readonly status: number;
  /** 请求路径 */
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = 'HttpAdapterError';
    this.status = status;
    this.path = path;
  }
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<DocumentSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.updatedAt === 'number'
  );
}

function isAssetRef(value: unknown): value is AssetRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<AssetRef>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.mediaType === 'string' &&
    typeof candidate.byteLength === 'number'
  );
}

/**
 * 创建远端存储适配器
 *
 * 返回对象同时实现 `StorageAdapter`、`AssetStore` 与只读的 `BookLibraryStore`；
 * 服务端未提供资产端点时，资产方法会以 404 语义抛错（调用方可用 `isAssetStore` 之外再按需探测）。
 *
 * 书架查询在客户端用 `list()` 结果做纯函数过滤：**不新增服务端端点**，
 * 因而摘要的阅读进度 / 标签等附加字段以服务端返回值为准；摘要补丁端口
 * （`BookSummaryStore`）不实现，调用方须回落到整本 `save`。
 */
export function createHttpAdapter(
  options: HttpAdapterOptions,
): StorageAdapter & AssetStore & BookLibraryStore {
  const base = trimSlash(options.baseUrl);
  const documentsPath = options.documentsPath ?? '/documents';
  const assetsPath = options.assetsPath ?? '/assets';
  const clock = options.clock ?? ((): number => Date.now());
  let closed = false;

  const resolveFetch = (): FetchLike => {
    const impl = options.fetchImpl ?? resolveGlobalFetch();
    if (!impl) {
      throw new HttpAdapterError(
        '创建请求失败：当前环境没有 fetch，请在 options.fetchImpl 注入实现。',
        0,
        '',
      );
    }
    return impl;
  };

  const request = async (
    path: string,
    init: { method?: string; body?: string | Uint8Array; contentType?: string } = {},
  ): Promise<{ response: Awaited<ReturnType<FetchLike>>; path: string }> => {
    const fetchImpl = resolveFetch();
    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
      ...(options.resolveHeaders ? options.resolveHeaders() : {}),
    };
    if (init.contentType) {
      headers['Content-Type'] = init.contentType;
    }
    if (init.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const url = `${base}${path}`;
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      const requestInit: { method?: string; headers: Record<string, string>; body?: string | Uint8Array } = {
        headers,
      };
      if (init.method !== undefined) {
        requestInit.method = init.method;
      }
      if (init.body !== undefined) {
        requestInit.body = init.body;
      }
      response = await fetchImpl(url, requestInit);
    } catch (error) {
      throw new HttpAdapterError(
        `请求失败：${url}（${error instanceof Error ? error.message : String(error)}）。请检查网络与服务地址。`,
        0,
        path,
      );
    }
    return { response, path };
  };

  const ensureOk = (
    response: { ok: boolean; status: number },
    path: string,
    action: string,
  ): void => {
    if (!response.ok) {
      throw new HttpAdapterError(
        `${action}失败：HTTP ${response.status}（${path}）。请检查服务端路由与鉴权。`,
        response.status,
        path,
      );
    }
  };

  const documentUrl = (id: string): string => `${documentsPath}/${encodeURIComponent(id)}`;
  const assetUrl = (id: string): string => `${assetsPath}/${encodeURIComponent(id)}`;

  const adapter: StorageAdapter & AssetStore & BookLibraryStore = {
    name: 'http',

    async save(id: string, document: BookDocument, saveOptions: SaveOptions = {}): Promise<void> {
      const updatedAt = saveOptions.updatedAt ?? clock();
      const { response, path } = await request(documentUrl(id), {
        method: 'PUT',
        body: JSON.stringify({ document, updatedAt }),
        contentType: 'application/json',
      });
      ensureOk(response, path, '保存文档');
    },

    async load(id: string): Promise<BookDocument | undefined> {
      const { response, path } = await request(documentUrl(id), { method: 'GET' });
      if (response.status === 404) {
        return undefined;
      }
      ensureOk(response, path, '读取文档');
      const payload = (await response.json()) as { document?: unknown };
      const document = payload?.document;
      if (!isBookDocument(document)) {
        throw new HttpAdapterError(
          `读取文档失败：${path} 返回的 document 不是合法 IR（缺 schemaVersion / metadata.title / root）。`,
          response.status,
          path,
        );
      }
      return document;
    },

    async list(): Promise<DocumentSummary[]> {
      const { response, path } = await request(documentsPath, { method: 'GET' });
      ensureOk(response, path, '列出文档');
      const payload = (await response.json()) as { documents?: unknown };
      if (!Array.isArray(payload?.documents)) {
        throw new HttpAdapterError(
          `列出文档失败：${path} 需返回 { documents: DocumentSummary[] }。`,
          response.status,
          path,
        );
      }
      return payload.documents.filter(isDocumentSummary).map((item) => ({ ...item }));
    },

    async query(documentQuery: DocumentQuery = {}): Promise<BookQueryResult> {
      // 服务端未提供查询端点：取全量摘要后在客户端过滤 / 排序 / 分组
      return queryDocumentSummaries(await adapter.list(), documentQuery);
    },

    async delete(id: string): Promise<boolean> {
      const { response, path } = await request(documentUrl(id), { method: 'DELETE' });
      if (response.status === 404) {
        return false;
      }
      ensureOk(response, path, '删除文档');
      return true;
    },

    async clear(): Promise<void> {
      const { response, path } = await request(documentsPath, { method: 'DELETE' });
      ensureOk(response, path, '清空文档');
    },

    async close(): Promise<void> {
      // HTTP 无长连接句柄需释放；按契约保持可再次使用
      closed = true;
    },

    async putAsset(id: string, payload: AssetPayload, putOptions: PutAssetOptions = {}): Promise<AssetRef> {
      const { response, path } = await request(assetUrl(id), {
        method: 'PUT',
        body: payload.data,
        contentType: payload.mediaType,
      });
      ensureOk(response, path, '写入资产');
      return toAssetRef(id, payload, putOptions);
    },

    async getAsset(id: string): Promise<AssetPayload | undefined> {
      const { response, path } = await request(assetUrl(id), { method: 'GET' });
      if (response.status === 404) {
        return undefined;
      }
      ensureOk(response, path, '读取资产');
      const buffer = await response.arrayBuffer();
      const mediaType = response.headers?.get('content-type') ?? 'application/octet-stream';
      return { mediaType, data: new Uint8Array(buffer) };
    },

    async listAssets(): Promise<AssetRef[]> {
      const { response, path } = await request(assetsPath, { method: 'GET' });
      ensureOk(response, path, '列出资产');
      const payload = (await response.json()) as { assets?: unknown };
      if (!Array.isArray(payload?.assets)) {
        throw new HttpAdapterError(
          `列出资产失败：${path} 需返回 { assets: AssetRef[] }。`,
          response.status,
          path,
        );
      }
      return payload.assets.filter(isAssetRef).map((item) => ({ ...item }));
    },

    async deleteAsset(id: string): Promise<boolean> {
      const { response, path } = await request(assetUrl(id), { method: 'DELETE' });
      if (response.status === 404) {
        return false;
      }
      ensureOk(response, path, '删除资产');
      return true;
    },
  };

  // 关闭只作诊断标记，不阻断后续调用（契约要求 close 后仍可用）
  Object.defineProperty(adapter, 'closed', {
    get: () => closed,
    enumerable: false,
  });

  return adapter;
}
