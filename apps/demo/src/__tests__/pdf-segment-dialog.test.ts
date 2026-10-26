/**
 * 分段导出弹窗测试
 *
 * 覆盖：确认后按会话协议逐段执行（begin → asset×N → prepare → segment×M）、
 * 分段文件名 `书名_00x.pdf`、段状态实时展示（done / failed + 失败即停）、
 * 停止后剩余分段跳过（已完成分段保留）。挂载走 createApp（demo 无
 * @vue/test-utils），交互用原生事件 + setTimeout 冲刷异步链。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import PdfSegmentDialog from '../components/export/PdfSegmentDialog.vue';
import { createSegmentedPdfRunner } from '../composables/use-export.js';

/** 书档：一张内联缺字图（验证去重令牌化与逐张上传） */
function makeBook(): BookDocument {
  const doc = createEmptyDocument({ title: '测试书' });
  (doc.root.children ??= []).push({
    type: NODE_TYPES.GLYPH_IMAGE,
    attrs: { src: 'data:image/png;base64,AAAA' },
  });
  return doc;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 当前挂载实例（每个用例结束统一卸载） */
let mounted: { app: App; container: HTMLElement } | null = null;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.container.remove();
  mounted = null;
});

/** 挂载弹窗（确认后由测试通过 resolvers 控制逐段完成时机） */
function mountDialog(
  runner: ReturnType<typeof createSegmentedPdfRunner>,
): HTMLElement {
  const Host = defineComponent({
    render: () =>
      h(PdfSegmentDialog, {
        open: true,
        title: '测试书',
        totalPages: 200,
        runner,
        defaultSegmentPages: 100,
      }),
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  mounted = { app, container };
  return container;
}

function query<T extends HTMLElement>(selector: string): T {
  const el = mounted?.container.querySelector(selector);
  if (el === null) throw new Error(`未找到 ${selector}`);
  return el as T;
}

function queryAll(selector: string): HTMLElement[] {
  return Array.from(mounted?.container.querySelectorAll(selector) ?? []);
}

describe('PdfSegmentDialog 分段导出', () => {
  it('确认后按会话协议逐段导出：begin → asset → prepare → segment×N，文件名 _00x', async () => {
    const channels: string[] = [];
    const segmentPayloads: Array<{ from?: number; to?: number; filename?: string }> = [];
    const assetTokens: Array<string | undefined> = [];
    const handlePromise = async (channel: string, args?: unknown) => {
      channels.push(channel);
      if (channel === 'bibliotype:export-begin') return { exportId: 'exp-1' };
      if (channel === 'bibliotype:export-asset') {
        assetTokens.push((args as { token?: string }).token);
        return { success: true };
      }
      if (channel === 'bibliotype:export-prepare') return { pageCount: 200 };
      if (channel === 'bibliotype:export-segment') {
        segmentPayloads.push(args as { from?: number; to?: number; filename?: string });
        return { success: true, path: `C:/cache/${(args as { filename?: string }).filename}` };
      }
      return { success: false, error: `未知通道 ${channel}` };
    };
    const runner = createSegmentedPdfRunner({
      channel: handlePromise,
      book: makeBook(),
      options: { mode: 'paged' },
      title: '测试书',
    });

    const container = mountDialog(runner);

    /* 设置态：分段区域预览（4 页 / 每卷 2 页 → 2 段），展示目标文件名（含日期时间后缀） */
    expect(queryAll('.seg-dialog__plan-row')).toHaveLength(2);
    expect(container.textContent).toMatch(/测试书_001_\d{8}_\d{6}\.pdf/);

    query<HTMLButtonElement>('.seg-dialog__confirm').click();
    await flush();
    await nextTick();

    /* 会话顺序：begin → asset → prepare → segment×2 */
    expect(channels).toEqual([
      'bibliotype:export-begin',
      'bibliotype:export-asset',
      'bibliotype:export-prepare',
      'bibliotype:export-segment',
      'bibliotype:export-segment',
    ]);
    expect(assetTokens).toEqual(['__bibliotype_asset_0__']);
    expect(segmentPayloads.map((p) => p.filename)).toEqual([
      expect.stringMatching(/^测试书_001_\d{8}_\d{6}\.pdf$/),
      expect.stringMatching(/^测试书_002_\d{8}_\d{6}\.pdf$/),
    ]);
    expect(segmentPayloads[0]?.from).toBe(0);
    expect(segmentPayloads[0]?.to).toBe(99);
    expect(segmentPayloads[1]?.from).toBe(100);
    expect(segmentPayloads[1]?.to).toBe(199);
    /* 段状态实时展示 */
    const statuses = queryAll('.seg-dialog__segment').map((el) => el.getAttribute('data-status'));
    expect(statuses).toEqual(['done', 'done']);
    expect(container.textContent).toContain('全部分段导出完成');
  });

  it('某段失败即停止：该段标记失败，后续分段保持未导出', async () => {
    const handlePromise = async (channel: string) => {
      if (channel === 'bibliotype:export-begin') return { exportId: 'exp-1' };
      if (channel === 'bibliotype:export-prepare') return { pageCount: 200 };

      if (channel === 'bibliotype:export-segment') {
        return { success: false, error: 'printToPDF 超时' };
      }
      return { success: true };
    };
    const runner = createSegmentedPdfRunner({
      channel: handlePromise,
      book: makeBook(),
      options: { mode: 'paged' },
      title: '测试书',
    });

    const container = mountDialog(runner);
    query<HTMLButtonElement>('.seg-dialog__confirm').click();
    await flush();
    await nextTick();

    const statuses = queryAll('.seg-dialog__segment').map((el) => el.getAttribute('data-status'));
    expect(statuses).toEqual(['failed', 'pending']);
    expect(container.textContent).toContain('有 1 段导出失败');
  });

  it('停止导出：当前段完成后剩余分段跳过，已完成分段保留', async () => {
    const resolvers: Array<(value: { success: boolean; path?: string }) => void> = [];
    const handlePromise = async (channel: string) => {
      if (channel === 'bibliotype:export-begin') return { exportId: 'exp-1' };
      if (channel === 'bibliotype:export-prepare') return { pageCount: 300 };
      if (channel === 'bibliotype:export-segment') {
        return new Promise((resolve) => {
          resolvers.push(resolve);
        });
      }
      return { success: true };
    };
    const runner = createSegmentedPdfRunner({
      channel: handlePromise,
      book: makeBook(),
      options: { mode: 'paged' },
      title: '测试书',
    });

    const container = mountDialog(runner);
    query<HTMLButtonElement>('.seg-dialog__confirm').click();
    await flush();

    /* 第一段完成后点击停止：第二段完成后剩余分段跳过 */
    resolvers[0]?.({ success: true, path: 'C:/cache/测试书_001.pdf' });
    await flush();
    query<HTMLButtonElement>('.seg-dialog__stop').click();
    resolvers[1]?.({ success: true, path: 'C:/cache/测试书_002.pdf' });
    await flush();
    await nextTick();

    const statuses = queryAll('.seg-dialog__segment').map((el) => el.getAttribute('data-status'));
    expect(statuses).toEqual(['done', 'done', 'skipped']);
  });

  it('勾选分卷：取消某卷后仅导出勾选的分卷', async () => {
    const segmentPayloads: Array<{ from?: number; to?: number; filename?: string }> = [];
    const handlePromise = async (channel: string, args?: unknown) => {
      if (channel === 'bibliotype:export-begin') return { exportId: 'exp-1' };
      if (channel === 'bibliotype:export-prepare') return { pageCount: 200 };
      if (channel === 'bibliotype:export-segment') {
        segmentPayloads.push(args as { from?: number; to?: number; filename?: string });
        return { success: true, path: `C:/cache/${(args as { filename?: string }).filename}` };
      }
      return { success: true };
    };
    const runner = createSegmentedPdfRunner({
      channel: handlePromise,
      book: makeBook(),
      options: { mode: 'paged' },
      title: '测试书',
    });

    const container = mountDialog(runner);
    /* 2 个分卷默认全选 */
    const checks = queryAll<HTMLInputElement>('.seg-dialog__plan-check');
    expect(checks).toHaveLength(2);
    expect(container.textContent).toContain('已选 2 / 2 卷');

    /* 取消第 2 卷 */
    checks[1]!.checked = false;
    checks[1]!.dispatchEvent(new Event('change'));
    await nextTick();
    expect(container.textContent).toContain('已选 1 / 2 卷');

    query<HTMLButtonElement>('.seg-dialog__confirm').click();
    await flush();
    await nextTick();

    /* 仅第 1 卷被导出，第 2 卷（取消）不出现 */
    expect(segmentPayloads).toHaveLength(1);
    expect(segmentPayloads[0]?.filename).toMatch(/^测试书_001_\d{8}_\d{6}\.pdf$/);
    expect(queryAll('.seg-dialog__segment')).toHaveLength(1);
    expect(container.textContent).toContain('全部分段导出完成');
  });
});
