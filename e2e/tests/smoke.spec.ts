/**
 * I1 e2e 冒烟：导入 → 阅读 → 编辑 → 导出主链路
 *
 * 三条链路（验收口径）：
 * 1. Markdown 导入 → 翻页 → 编辑落字 → 保存并预览 → 导出 EPUB 并校验产物；
 * 2. TXT 导入 → 章节阅读 → 直排切换（古籍版式可分页）；
 * 3. 宿主 PDF 桥（模拟 Electron preload）→ 导出 PDF 字节 + 打印 HTML 校验。
 *
 * 所有操作走用户可见入口；产物在 Node 侧解析（fflate），不依赖 demo 内部状态。
 * 桌面顶栏与 H5「更多」sheet 的入口差异由 `clickGlobalAction` 吸收，
 * 同一份用例在 `chromium` / `chromium-mobile` 两档都能跑。
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  clickGlobalAction,
  currentPageText,
  gotoNextPage,
  importBook,
  openDemo,
  pagerText,
  switchTheme,
  waitForPagingIdle,
} from './utils/demo.js';
import { readEpub } from './utils/epub.js';

test.describe('I1 主链路冒烟 @smoke', () => {
  test('Markdown 导入 → 翻页 → 编辑落字 → 导出 EPUB', async ({ page }) => {
    await openDemo(page);

    /* ---------- 导入 ---------- */
    await importBook(page, 'smoke.md', '学而时习之');
    await expect(page.locator('.toolbar__book strong')).toHaveText('smoke');
    await expect(page.locator('.bt-pager__status')).toContainText('共');

    /* ---------- 翻页 ---------- */
    const first = await pagerText(page);
    const pageOneText = await currentPageText(page);
    expect(pageOneText).toContain('学而时习之');
    await gotoNextPage(page);
    expect(await pagerText(page)).not.toBe(first);

    /* ---------- 编辑落字（回到第 1 页，在首块开头插入） ---------- */
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await expect.poll(() => pagerText(page), { timeout: 15_000 }).toBe(first);
    await waitForPagingIdle(page);

    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const frag = page.locator('.bt-paged-frag[contenteditable="true"]').first();
    await expect(frag).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.bt-editor__loading')).toBeHidden({ timeout: 60_000 });
    await frag.click({ position: { x: 10, y: 10 } });
    await page.keyboard.type('E2E落字');
    await expect(frag).toContainText('E2E落字');

    await page.getByRole('button', { name: '保存并预览', exact: true }).click();
    await expect(page.locator('.bt-book-view--paged')).toBeVisible({ timeout: 60_000 });
    await waitForPagingIdle(page);
    await expect(page.locator('.bt-reader-page').first()).toContainText('E2E落字', {
      timeout: 30_000,
    });

    /* ---------- 导出 EPUB 并校验产物 ---------- */
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      clickGlobalAction(page, '导出 EPUB'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.epub$/);
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = new Uint8Array(await readFile(path!));
    expect(bytes.byteLength).toBeGreaterThan(0);

    const epub = readEpub(bytes);
    expect(epub.text('mimetype')).toBe('application/epub+zip');
    expect(Object.keys(epub.entries)).toContain('META-INF/container.xml');
    expect(epub.opf()).toContain('smoke');
    // 导出所见即所得：编辑落字必须进入章节 XHTML
    expect(epub.findXhtmlContaining('E2E落字')).toBeDefined();
    // 正文原句仍在（未被编辑破坏）
    expect(epub.findXhtmlContaining('学而时习之')).toBeDefined();
  });

  test('TXT 导入 → 章节阅读 → 古籍直排版式', async ({ page }) => {
    await openDemo(page);
    await importBook(page, 'smoke.txt', '学而时习之');
    await expect(page.locator('.toolbar__book strong')).toHaveText('smoke');

    /* TXT 章节切分：第二章应可在后续页到达（翻页链路可用） */
    await gotoNextPage(page);

    /* 直排：外壳转竖排，正文流按古籍版式分页 */
    await switchTheme(page, '古籍直排');
    await expect(page.locator('.bt-book-view.is-vertical')).toBeVisible({ timeout: 30_000 });
    const flow = page.locator('.bt-reader-page__flow').first();
    await expect(flow).toBeVisible();
    const writingMode = await flow.evaluate((el) => getComputedStyle(el).writingMode);
    expect(writingMode.startsWith('vertical')).toBe(true);
    await expect(page.locator('.bt-pager__status')).toContainText('共');

    /* 直排翻页后仍有正文（分页链路在竖排下同样可用） */
    await gotoNextPage(page);
    expect((await currentPageText(page)).length).toBeGreaterThan(0);

    /* 回横排，避免影响同 worker 的后续用例展示 */
    await switchTheme(page, '现代横排');
  });

  test('宿主 PDF 桥 → 导出 PDF 字节', async ({ page }) => {
    /* 模拟 Electron preload 注入的宿主桥：记录打印 HTML 并回传 PDF 字节 */
    await page.addInitScript(() => {
      const host = window as unknown as {
        electronPdf?: { exportPdf: (html: string, options?: unknown) => Promise<Uint8Array> };
        __btPdfHtml?: string;
      };
      host.electronPdf = {
        exportPdf: async (html: string) => {
          host.__btPdfHtml = html;
          return new TextEncoder().encode('%PDF-1.7\n% e2e stub\n');
        },
      };
    });

    await openDemo(page);
    await importBook(page, 'smoke.md', '学而时习之');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      clickGlobalAction(page, '导出 PDF'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = new Uint8Array(await readFile(path!));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    /* 传给宿主的自包含 HTML：含正文与打印分页 CSS（@page） */
    const html = await page.evaluate(
      () => (window as unknown as { __btPdfHtml?: string }).__btPdfHtml,
    );
    expect(html).toBeDefined();
    expect(html).toContain('学而时习之');
    expect(html).toContain('@page');
  });
});
