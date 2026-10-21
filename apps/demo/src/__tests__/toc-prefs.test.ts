/**
 * 目录偏好测试：快照解析容错、宽度夹取、折叠集合节流落盘。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@bibliotype/vue';
import { TOC_PREFS_KEY, parseTocPrefs, useTocPrefs } from '../composables/use-toc-prefs.js';

describe('parseTocPrefs', () => {
  it('未存过 / 坏 JSON / 非对象一律返回 null', () => {
    expect(parseTocPrefs(null)).toBeNull();
    expect(parseTocPrefs('{')).toBeNull();
    expect(parseTocPrefs('42')).toBeNull();
    expect(parseTocPrefs('null')).toBeNull();
  });

  it('宽度缺失或越界时夹取到合法范围', () => {
    expect(parseTocPrefs('{}')).toEqual({ width: SIDEBAR_DEFAULT_WIDTH });
    expect(parseTocPrefs('{"width":10}')).toEqual({ width: SIDEBAR_MIN_WIDTH });
    expect(parseTocPrefs('{"width":9999}')).toEqual({ width: SIDEBAR_MAX_WIDTH });
    expect(parseTocPrefs('{"width":320.4}')).toEqual({ width: 320 });
  });

  it('折叠集合非法时丢弃该字段，宽度仍保留', () => {
    expect(parseTocPrefs('{"width":300,"expandedKeys":[1,2]}')).toEqual({ width: 300 });
    expect(parseTocPrefs('{"width":300,"expandedKeys":"vol-1"}')).toEqual({ width: 300 });
  });

  it('合法折叠集合原样保留', () => {
    expect(parseTocPrefs('{"width":300,"expandedKeys":["vol-1","chap-2"]}')).toEqual({
      width: 300,
      expandedKeys: ['vol-1', 'chap-2'],
    });
  });
});

describe('useTocPrefs', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('首次运行取默认宽度，展开集合为 undefined（目录全展开）', () => {
    const prefs = useTocPrefs('test:toc');
    expect(prefs.width.value).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(prefs.expandedKeys.value).toBeUndefined();
  });

  it('读取已存快照并节流写回', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      'test:toc',
      JSON.stringify({ width: 340, expandedKeys: ['vol-1'] }),
    );

    const prefs = useTocPrefs('test:toc');
    expect(prefs.width.value).toBe(340);
    expect(prefs.expandedKeys.value).toEqual(['vol-1']);

    prefs.setExpandedKeys(['chap-1']);
    expect(prefs.expandedKeys.value).toEqual(['chap-1']);
    // 等 watch 回调排入调度队列后再推进定时器
    await nextTick();
    // 节流期间尚未落盘
    expect(JSON.parse(window.localStorage.getItem('test:toc') ?? '{}').expandedKeys).toEqual([
      'vol-1',
    ]);

    vi.advanceTimersByTime(200);
    expect(JSON.parse(window.localStorage.getItem('test:toc') ?? '{}')).toEqual({
      width: 340,
      expandedKeys: ['chap-1'],
    });
  });

  it('双击复位把宽度写回默认值', async () => {
    const prefs = useTocPrefs('test:toc');
    prefs.width.value = 420;
    await nextTick();
    prefs.resetWidth();
    expect(prefs.width.value).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('默认键常量为 demo 私有命名空间', () => {
    expect(TOC_PREFS_KEY.startsWith('bibliotype-demo:')).toBe(true);
  });
});
