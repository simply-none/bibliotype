/**
 * 远端适配器测试：REST 契约、错误语义、资产端口、请求头与时钟注入。
 * 用内存假服务端（fake fetch）验证，不依赖网络。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  isAssetStore,
  isBookLibraryStore,
  isBookSummaryStore,
} from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import { HttpAdapterError, createHttpAdapter } from '../index.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../index.js';

interface RecordedCall {
  url: string;
  init: HttpRequestInit | undefined;
}

interface FakeServer {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
  documents: Map<string, { document: BookDocument; updatedAt: number }>;
  assets: Map<string, { data: Uint8Array; mediaType: string }>;
  /** 下一次请求强制返回的状态码（用于错误路径） */
  forcedStatus?: number;
}

const BASE = 'https://api.test/api';

function jsonResponse(status: number, payload: unknown): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function createFakeServer(): FakeServer {
  const server: FakeServer = {
    calls: [],
    documents: new Map(),
    assets: new Map(),
    fetchImpl: async (url, init) => {
      server.calls.push({ url, init });
      if (server.forcedStatus !== undefined) {
        const status = server.forcedStatus;
        server.forcedStatus = undefined;
        return jsonResponse(status, {});
      }
      const path = url.slice(BASE.length);
      const method = init?.method ?? 'GET';

      if (path === '/documents' && method === 'GET') {
        const documents = [...server.documents.entries()].map(([id, value]) => ({
          id,
          title: value.document.metadata.title,
          updatedAt: value.updatedAt,
        }));
        return jsonResponse(200, { documents });
      }
      if (path === '/documents' && method === 'DELETE') {
        server.documents.clear();
        return jsonResponse(204, {});
      }
      if (path.startsWith('/documents/')) {
        const id = decodeURIComponent(path.slice('/documents/'.length));
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as {
            document: BookDocument;
            updatedAt: number;
          };
          server.documents.set(id, body);
          return jsonResponse(204, {});
        }
        if (method === 'GET') {
          const hit = server.documents.get(id);
          return hit ? jsonResponse(200, { document: hit.document }) : jsonResponse(404, {});
        }
        if (method === 'DELETE') {
          return server.documents.delete(id) ? jsonResponse(204, {}) : jsonResponse(404, {});
        }
      }
      if (path === '/assets' && method === 'GET') {
        const assets = [...server.assets.entries()].map(([id, value]) => ({
          id,
          kind: 'image',
          mediaType: value.mediaType,
          byteLength: value.data.byteLength,
        }));
        return jsonResponse(200, { assets });
      }
      if (path.startsWith('/assets/')) {
        const id = decodeURIComponent(path.slice('/assets/'.length));
        if (method === 'PUT') {
          server.assets.set(id, {
            data: init?.body as Uint8Array,
            mediaType: init?.headers?.['Content-Type'] ?? 'application/octet-stream',
          });
          return jsonResponse(204, {});
        }
        if (method === 'GET') {
          const hit = server.assets.get(id);
          if (!hit) {
            return jsonResponse(404, {});
          }
          return {
            ok: true,
            status: 200,
            headers: { get: (name: string) => (name === 'content-type' ? hit.mediaType : null) },
            json: async () => ({}),
            arrayBuffer: async () => hit.data.buffer.slice(0) as ArrayBuffer,
          };
        }
        if (method === 'DELETE') {
          return server.assets.delete(id) ? jsonResponse(204, {}) : jsonResponse(404, {});
        }
      }
      return jsonResponse(500, { message: 'unrouted' });
    },
  };
  return server;
}

function sampleDocument(): BookDocument {
  const document = createEmptyDocument({ title: '论语' });
  document.root.children = [{ id: 'p1', type: 'paragraph', children: [{ type: 'text', text: '学而' }] }];
  return document;
}

describe('createHttpAdapter 文档端口', () => {
  it('保存与读取往返，updatedAt 由时钟注入', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl, clock: () => 1000 });
    const document = sampleDocument();
    await adapter.save('book-1', document);
    expect(server.calls[0]?.url).toBe(`${BASE}/documents/book-1`);
    expect(server.calls[0]?.init?.method).toBe('PUT');
    expect(server.documents.get('book-1')?.updatedAt).toBe(1000);

    expect(await adapter.load('book-1')).toEqual(document);
  });

  it('SaveOptions.updatedAt 优先于时钟', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl, clock: () => 1000 });
    await adapter.save('book-1', sampleDocument(), { updatedAt: 42 });
    expect(server.documents.get('book-1')?.updatedAt).toBe(42);
  });

  it('未命中返回 undefined', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    expect(await adapter.load('missing')).toBeUndefined();
    expect(await adapter.delete('missing')).toBe(false);
  });

  it('列表映射与非法项过滤', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    await adapter.save('b1', sampleDocument(), { updatedAt: 1 });
    const list = await adapter.list();
    expect(list).toEqual([{ id: 'b1', title: '论语', updatedAt: 1 }]);
  });

  it('书架查询在客户端完成（不新增服务端端点）', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    await adapter.save('b1', sampleDocument(), { updatedAt: 100 });
    await adapter.save('b2', { ...sampleDocument(), metadata: { title: '史记' } }, { updatedAt: 200 });

    expect(isBookLibraryStore(adapter)).toBe(true);
    const result = await adapter.query({ text: '史记', sortBy: 'updated' });
    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(['b2']);
    // 只读能力：HTTP 适配器不实现摘要补丁端口
    expect(isBookSummaryStore(adapter)).toBe(false);
    expect(server.calls.every((call) => call.url.startsWith(`${BASE}/documents`))).toBe(true);
  });

  it('删除与清空', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    await adapter.save('b1', sampleDocument());
    expect(await adapter.delete('b1')).toBe(true);
    expect(server.documents.size).toBe(0);

    await adapter.save('b2', sampleDocument());
    await adapter.clear();
    expect(server.documents.size).toBe(0);
  });

  it('非 2xx 抛 HttpAdapterError 带状态码', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    server.forcedStatus = 401;
    await expect(adapter.save('b1', sampleDocument())).rejects.toBeInstanceOf(HttpAdapterError);
    server.forcedStatus = 500;
    await expect(adapter.list()).rejects.toThrow(/列出文档失败/);
  });

  it('返回非法 IR 时抛错', async () => {
    const adapter = createHttpAdapter({
      baseUrl: BASE,
      fetchImpl: async () => jsonResponse(200, { document: { bad: true } }),
    });
    await expect(adapter.load('b1')).rejects.toThrow(/不是合法 IR/);
  });

  it('网络异常包装为 HttpAdapterError(status=0)', async () => {
    const adapter = createHttpAdapter({
      baseUrl: BASE,
      fetchImpl: async () => {
        throw new Error('boom');
      },
    });
    await expect(adapter.load('b1')).rejects.toMatchObject({ status: 0 });
  });

  it('静态与动态请求头合并', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({
      baseUrl: BASE,
      fetchImpl: server.fetchImpl,
      headers: { Authorization: 'Bearer base' },
      resolveHeaders: () => ({ 'X-Trace': 'abc' }),
    });
    await adapter.save('b1', sampleDocument());
    expect(server.calls[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer base',
      'X-Trace': 'abc',
      'Content-Type': 'application/json',
    });
  });

  it('close 后仍可继续使用', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    await adapter.close();
    await adapter.save('b1', sampleDocument());
    expect(server.documents.has('b1')).toBe(true);
  });
});

describe('资产端口', () => {
  it('实现 isAssetStore 守卫', () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    expect(isAssetStore(adapter)).toBe(true);
    expect(adapter.name).toBe('http');
  });

  it('写入 / 读取 / 列出 / 删除资产', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    const data = new Uint8Array([1, 2, 3, 4]);
    const ref = await adapter.putAsset('a1', { mediaType: 'image/png', data, name: 'a.png' });
    expect(ref.kind).toBe('image');
    expect(ref.byteLength).toBe(4);
    expect(typeof ref.hash).toBe('string');

    const loaded = await adapter.getAsset('a1');
    expect(loaded?.mediaType).toBe('image/png');
    expect(Array.from(loaded?.data ?? [])).toEqual([1, 2, 3, 4]);

    const list = await adapter.listAssets();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('a1');

    expect(await adapter.deleteAsset('a1')).toBe(true);
    expect(await adapter.deleteAsset('a1')).toBe(false);
    expect(await adapter.getAsset('a1')).toBeUndefined();
  });

  it('资产写入失败抛错', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: server.fetchImpl });
    server.forcedStatus = 413;
    await expect(
      adapter.putAsset('a1', { mediaType: 'image/png', data: new Uint8Array([1]) }),
    ).rejects.toThrow(/写入资产失败/);
  });

  it('列资产返回结构非法时抛错', async () => {
    const adapter = createHttpAdapter({
      baseUrl: BASE,
      fetchImpl: async () => jsonResponse(200, { items: [] }),
    });
    await expect(adapter.listAssets()).rejects.toThrow(/列出资产失败/);
  });
});

describe('baseUrl 规范化', () => {
  it('末尾斜杠不产生双斜杠', async () => {
    const server = createFakeServer();
    const adapter = createHttpAdapter({ baseUrl: `${BASE}/`, fetchImpl: server.fetchImpl });
    await adapter.save('b1', sampleDocument());
    expect(server.calls[0]?.url).toBe(`${BASE}/documents/b1`);
    expect(vi.isMockFunction(server.fetchImpl)).toBe(false);
  });
});
