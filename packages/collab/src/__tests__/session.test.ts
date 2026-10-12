/**
 * 协同会话与内存网络测试
 */
import { describe, expect, it, vi } from 'vitest';
import {
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
} from '@bibliotype/core';
import { InMemoryNetwork, InMemoryProvider } from '../in-memory-provider.js';
import { PROVIDER_STATUS } from '../provider.js';
import { CollabSession } from '../session.js';

/** 构造简单文档 */
function docWith(text: string): BookDocument {
  const doc = createEmptyDocument({ title: '校勘样本' });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text }] },
  ];
  return doc;
}

/** 读取首段首文本 */
function firstText(doc: BookDocument): string | undefined {
  return doc.root.children?.[0]?.children?.[0]?.text;
}

describe('CollabSession（无 Provider 的本地模式）', () => {
  it('loadDocument / snapshot 往返一致', () => {
    const session = new CollabSession({ autoConnect: false });
    session.loadDocument(docWith('子曰'));
    expect(firstText(session.snapshot())).toBe('子曰');
    session.destroy();
  });

  it('onDocumentChange 收到变更快照，可退订', () => {
    const session = new CollabSession({ autoConnect: false });
    const handler = vi.fn();
    const unsubscribe = session.onDocumentChange(handler);
    session.loadDocument(docWith('学而'));
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
    session.loadDocument(docWith('时习'));
    expect(handler).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it('默认用户身份可覆盖、可更新', () => {
    const session = new CollabSession({ user: { name: '钱大昕' } });
    expect(session.currentUser.name).toBe('钱大昕');
    expect(session.currentUser.color).toBeTruthy();
    session.updateUser({ color: '#000' });
    expect(session.currentUser.color).toBe('#000');
    session.destroy();
  });

  it('destroy 后操作抛出明确错误', () => {
    const session = new CollabSession();
    session.destroy();
    expect(() => session.loadDocument(docWith('x'))).toThrow('已销毁');
  });
});

describe('双端协同（InMemoryProvider）', () => {
  it('一端载入文档自动同步到另一端', () => {
    const network = new InMemoryNetwork();
    const sessionA = new CollabSession({ provider: new InMemoryProvider(network) });
    const sessionB = new CollabSession({ provider: new InMemoryProvider(network) });

    const changeOnB = vi.fn();
    sessionB.onDocumentChange(changeOnB);

    sessionA.loadDocument(docWith('子曰'));

    expect(firstText(sessionB.snapshot())).toBe('子曰');
    expect(changeOnB).toHaveBeenCalled();
  });

  it('后加入的端接收既有文档状态', () => {
    const network = new InMemoryNetwork();
    const sessionA = new CollabSession({ provider: new InMemoryProvider(network) });
    sessionA.loadDocument(docWith('学而'));

    const sessionB = new CollabSession({ provider: new InMemoryProvider(network) });
    expect(firstText(sessionB.snapshot())).toBe('学而');
  });

  it('变更双向流动且不产生回播环路', () => {
    const network = new InMemoryNetwork();
    const sessionA = new CollabSession({ provider: new InMemoryProvider(network) });
    const sessionB = new CollabSession({ provider: new InMemoryProvider(network) });

    const changeCountOnA = vi.fn();
    sessionA.onDocumentChange(changeCountOnA);

    sessionB.loadDocument(docWith('时习'));

    expect(firstText(sessionA.snapshot())).toBe('时习');
    // A 端仅因远端同步触发一次（无环路重复更新）
    expect(changeCountOnA).toHaveBeenCalledTimes(1);
  });

  it('断开后不再接收远端更新，重连后恢复同步', () => {
    const network = new InMemoryNetwork();
    const sessionA = new CollabSession({ provider: new InMemoryProvider(network) });
    const sessionB = new CollabSession({ provider: new InMemoryProvider(network) });

    sessionA.loadDocument(docWith('第一版'));
    expect(firstText(sessionB.snapshot())).toBe('第一版');

    sessionB.disconnect();
    sessionA.loadDocument(docWith('第二版'));
    // 已断开：B 端保持旧内容
    expect(firstText(sessionB.snapshot())).toBe('第一版');

    // 重连：补齐断线期间的增量
    sessionB.connect();
    expect(firstText(sessionB.snapshot())).toBe('第二版');
  });

  it('Provider 状态变更可订阅（disconnected → connecting → connected）', () => {
    const network = new InMemoryNetwork();
    const provider = new InMemoryProvider(network);
    const statuses: string[] = [];
    provider.onStatusChange((status) => statuses.push(status));

    const session = new CollabSession({ provider });
    expect(provider.status).toBe(PROVIDER_STATUS.CONNECTED);
    expect(statuses).toEqual([
      PROVIDER_STATUS.CONNECTING,
      PROVIDER_STATUS.CONNECTED,
    ]);
    session.destroy();
  });

  it('未绑定文档直接 connect 抛出错误', () => {
    const provider = new InMemoryProvider(new InMemoryNetwork());
    expect(() => provider.connect()).toThrow('未绑定');
  });

  it('destroy 后在线成员数归零', () => {
    const network = new InMemoryNetwork();
    const sessionA = new CollabSession({ provider: new InMemoryProvider(network) });
    const sessionB = new CollabSession({ provider: new InMemoryProvider(network) });
    expect(network.size).toBe(2);
    sessionA.destroy();
    sessionB.destroy();
    expect(network.size).toBe(0);
  });
});
