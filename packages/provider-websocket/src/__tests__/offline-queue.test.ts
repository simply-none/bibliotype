import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { OfflineUpdateQueue } from '../offline-queue.js';

/** 把一段文本编辑编码成独立的 Yjs 更新 */
function editUpdate(doc: Y.Doc, text: string): Uint8Array {
  let captured: Uint8Array | undefined;
  const observer = (update: Uint8Array): void => {
    captured = update;
  };
  doc.on('update', observer);
  doc.getText('body').insert(doc.getText('body').length, text);
  doc.off('update', observer);
  if (captured === undefined) throw new Error('没有捕获到更新');
  return captured;
}

describe('离线更新队列', () => {
  it('多条更新合并为一条并保持内容', () => {
    const source = new Y.Doc();
    const queue = new OfflineUpdateQueue();
    queue.push(editUpdate(source, '甲'));
    queue.push(editUpdate(source, '乙'));
    queue.push(editUpdate(source, '丙'));

    const merged = queue.drain();
    expect(merged).toBeInstanceOf(Uint8Array);
    expect(queue.size).toBe(0);
    expect(queue.bytes).toBe(0);

    const target = new Y.Doc();
    Y.applyUpdate(target, merged as Uint8Array);
    expect(target.getText('body').toString()).toBe('甲乙丙');
  });

  it('超过体积上限时切换为全量同步（不保留载荷）', () => {
    const source = new Y.Doc();
    const queue = new OfflineUpdateQueue({ maxQueueBytes: 32 });
    queue.push(editUpdate(source, '很长的一段文字'.repeat(10)));

    expect(queue.needsFullSync).toBe(true);
    expect(queue.drain()).toBeUndefined();
    expect(queue.isEmpty).toBe(false);

    /* 兜底状态下继续编辑不再入队（本地文档已含全部改动） */
    queue.push(editUpdate(source, '后续'));
    expect(queue.bytes).toBe(0);
  });

  it('clear 同时重置载荷与全量标记', () => {
    const source = new Y.Doc();
    const queue = new OfflineUpdateQueue({ maxQueueBytes: 8 });
    queue.push(editUpdate(source, '超出上限的内容'));
    expect(queue.needsFullSync).toBe(true);

    queue.clear();
    expect(queue.needsFullSync).toBe(false);
    expect(queue.isEmpty).toBe(true);
  });

  it('空更新不进入队列', () => {
    const queue = new OfflineUpdateQueue();
    queue.push(new Uint8Array());
    expect(queue.isEmpty).toBe(true);
  });
});
