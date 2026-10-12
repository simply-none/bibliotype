/**
 * 核心实例测试（门面组装 + 插件生命周期）
 */
import { describe, expect, it, vi } from 'vitest';
import { createBibliotype } from '../instance.js';
import { definePlugin } from '../plugin/types.js';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument, isBookDocument } from '../ir/document.js';

describe('createBibliotype', () => {
  it('预置 core 节点定义', () => {
    const bt = createBibliotype();
    expect(bt.nodeTypes.has(NODE_TYPES.BOOK)).toBe(true);
    expect(bt.nodeTypes.has(NODE_TYPES.PARAGRAPH)).toBe(true);
    expect(bt.nodeTypes.listByNamespace('core').length).toBeGreaterThan(5);
  });

  it('主题令牌可读可覆盖且可还原', () => {
    const bt = createBibliotype();
    const original = bt.theme.get('color-text');
    const restore = bt.theme.set('color-text', '#000');
    expect(bt.theme.get('color-text')).toBe('#000');
    restore();
    expect(bt.theme.get('color-text')).toBe(original);
  });

  it('插件安装触发事件、卸载执行 dispose', () => {
    const bt = createBibliotype();
    const dispose = vi.fn();
    const onInstalled = vi.fn();
    bt.events.on('plugin:installed', onInstalled);

    const plugin = definePlugin({
      name: 'test-plugin',
      version: '1.0.0',
      install: () => dispose,
    });

    bt.plugins.install(plugin);
    expect(onInstalled).toHaveBeenCalledWith({ name: 'test-plugin', version: '1.0.0' });
    expect(bt.plugins.has('test-plugin')).toBe(true);

    bt.plugins.uninstall('test-plugin');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(bt.plugins.has('test-plugin')).toBe(false);
  });

  it('dispose 后插件全部卸载且事件清空', () => {
    const bt = createBibliotype();
    bt.plugins.install(definePlugin({ name: 'p1', install: () => undefined }));
    bt.dispose();
    expect(bt.plugins.list()).toHaveLength(0);
    expect(bt.events.hasListeners('page:change')).toBe(false);
  });

  it('空文档工厂产出合法文档', () => {
    const doc = createEmptyDocument({ title: '论语注疏' });
    expect(isBookDocument(doc)).toBe(true);
    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    expect(doc.metadata.title).toBe('论语注疏');
  });
});
