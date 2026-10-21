import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { PROVIDER_STATUS } from '@bibliotype/collab';
import { startReferenceServer, type ReferenceServerHandle } from '../server/reference-server.js';
import type { WebSocketLike } from '../socket.js';
import { WebSocketProvider } from '../websocket-provider.js';

/** 用 ws 提供的 WebSocket 作为真实客户端（浏览器可省略工厂用原生实现） */
const socketFactory = (url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike;

/** 轮询等待 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待真实 WebSocket 同步超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('参考服务端 e2e', () => {
  let server: ReferenceServerHandle;

  beforeAll(async () => {
    server = await startReferenceServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('真实连接：双向同步、断线 10 次编辑后重连不重复', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new WebSocketProvider({
      url: server.url,
      docId: 'e2e-book',
      clientId: 'a',
      socketFactory,
      backoff: { baseDelayMs: 100, jitterRatio: 0 },
    });
    const b = new WebSocketProvider({
      url: server.url,
      docId: 'e2e-book',
      clientId: 'b',
      socketFactory,
      backoff: { baseDelayMs: 100, jitterRatio: 0 },
    });

    try {
      a.bind(docA);
      a.connect();
      await waitFor(() => a.status === PROVIDER_STATUS.CONNECTED);

      b.bind(docB);
      b.connect();
      await waitFor(() => b.status === PROVIDER_STATUS.CONNECTED);
      expect(docB.getText('body').toString()).toBe('');

      /* A → B */
      docA.getText('body').insert(0, '甲');
      await waitFor(() => docB.getText('body').toString() === '甲');

      /* B 断线后连续 10 次编辑，重连一次补发 */
      b.disconnect();
      expect(b.status).toBe(PROVIDER_STATUS.DISCONNECTED);
      for (let i = 0; i < 10; i += 1) {
        docB.getText('body').insert(docB.getText('body').length, String(i));
      }
      expect(docA.getText('body').toString()).toBe('甲');

      b.connect();
      await waitFor(() => docA.getText('body').toString() === '甲0123456789');
      /* 无重复：长度 = 1 + 10 */
      expect(docA.getText('body').length).toBe(11);
      expect(docB.getText('body').toString()).toBe('甲0123456789');

      /* 迟到客户端拿到全量状态 */
      const docC = new Y.Doc();
      const c = new WebSocketProvider({
        url: server.url,
        docId: 'e2e-book',
        clientId: 'c',
        socketFactory,
      });
      c.bind(docC);
      c.connect();
      await waitFor(() => docC.getText('body').toString() === '甲0123456789');
      c.destroy();

      expect(server.roomCount).toBeGreaterThanOrEqual(1);
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  it('不同 docId 互相隔离', async () => {
    const roomOne = new Y.Doc();
    const roomTwo = new Y.Doc();
    const one = new WebSocketProvider({
      url: server.url,
      docId: 'room-one',
      clientId: 'one',
      socketFactory,
    });
    const two = new WebSocketProvider({
      url: server.url,
      docId: 'room-two',
      clientId: 'two',
      socketFactory,
    });

    try {
      one.bind(roomOne);
      two.bind(roomTwo);
      one.connect();
      two.connect();
      await waitFor(
        () =>
          one.status === PROVIDER_STATUS.CONNECTED && two.status === PROVIDER_STATUS.CONNECTED,
      );

      roomOne.getText('body').insert(0, '只应出现在一房间');
      await waitFor(() => roomOne.getText('body').length > 0);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(roomTwo.getText('body').toString()).toBe('');
    } finally {
      one.destroy();
      two.destroy();
    }
  });
});
