import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PROVIDER_STATUS } from '@bibliotype/collab';
import { BroadcastProvider } from '../broadcast-provider.js';

/** 频道名计数器：避免用例之间串台 */
let channelSeq = 0;

/** 生成唯一频道名 */
function nextChannel(): string {
  channelSeq += 1;
  return `bt-test-${channelSeq}-${Math.floor(Math.random() * 1e6)}`;
}

/** 轮询等待（BroadcastChannel 投递是异步的） */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待广播同步超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const providers: BroadcastProvider[] = [];

/** 建一个绑定新文档的 provider 并登记清理 */
function create(name: string, clientId: string): { provider: BroadcastProvider; doc: Y.Doc } {
  const provider = new BroadcastProvider({ channelName: name, clientId });
  const doc = new Y.Doc();
  provider.bind(doc);
  providers.push(provider);
  return { provider, doc };
}

describe('BroadcastProvider', () => {
  afterEach(() => {
    while (providers.length > 0) providers.pop()?.destroy();
  });

  it('同频道双端双向同步', async () => {
    const name = nextChannel();
    const a = create(name, 'a');
    const b = create(name, 'b');
    a.provider.connect();
    b.provider.connect();

    expect(a.provider.status).toBe(PROVIDER_STATUS.CONNECTED);

    a.doc.getText('body').insert(0, '甲');
    await waitFor(() => b.doc.getText('body').toString() === '甲');

    b.doc.getText('body').insert(1, '乙');
    await waitFor(() => a.doc.getText('body').toString() === '甲乙');
  });

  it('迟到加入者通过 hello/state 获取全量状态', async () => {
    const name = nextChannel();
    const a = create(name, 'a');
    a.provider.connect();
    a.doc.getText('body').insert(0, '已存在的正文');

    const late = create(name, 'late');
    late.provider.connect();
    await waitFor(() => late.doc.getText('body').toString() === '已存在的正文');
  });

  it('断开后不再接收更新', async () => {
    const name = nextChannel();
    const a = create(name, 'a');
    const b = create(name, 'b');
    a.provider.connect();
    b.provider.connect();

    b.provider.disconnect();
    expect(b.provider.status).toBe(PROVIDER_STATUS.DISCONNECTED);

    a.doc.getText('body').insert(0, '断开后的更新');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(b.doc.getText('body').toString()).toBe('');
  });

  it('没有 BroadcastChannel 且未注入工厂时 connect 抛错', () => {
    const provider = new BroadcastProvider({
      channelName: nextChannel(),
      channelFactory: () => {
        throw new Error('当前环境没有 BroadcastChannel');
      },
    });
    provider.bind(new Y.Doc());
    expect(() => provider.connect()).toThrow('BroadcastChannel');
    expect(provider.status).toBe(PROVIDER_STATUS.DISCONNECTED);
    expect(provider.lastError ?? '').toContain('BroadcastChannel');
    provider.destroy();
  });

  it('非法消息被忽略，不影响后续同步', async () => {
    const name = nextChannel();
    const raw = new BroadcastChannel(name);
    const a = create(name, 'a');
    a.provider.connect();

    raw.postMessage({ hello: 'world' });
    raw.postMessage({ bt: 1, from: 'x', kind: 'update', update: '***' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    /* 载荷非法：记录错误但不中断本地总线 */
    expect(a.provider.lastError ?? '').toContain('base64');
    expect(a.provider.status).toBe(PROVIDER_STATUS.CONNECTED);

    a.doc.getText('body').insert(0, '仍可同步');
    const b = create(name, 'b');
    b.provider.connect();
    await waitFor(() => b.doc.getText('body').toString() === '仍可同步');
    raw.close();
  });
});
