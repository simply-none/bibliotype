/**
 * 跨页续排片段顶格回归（横排书排规则）。
 *
 * 块按行拆分跨页后，后继片段是**同一句话的中段**：序列化器输出
 * `data-continued`，book-css 据此置零首行缩进——续行曾被当新段落缩进
 * 两字符（视觉上像另起一段），且带缩进渲染的行数超出分页记账、页底
 * 出现空行带。本测试在真浏览器里断言：
 * 1. 长段跨页后，续页上存在 `data-continued` 片段；
 * 2. 续排片段的 computed `text-indent` 为 0px（顶格）；
 * 3. 非续排段落仍保有缩进（规则确实生效，而非全书失去缩进）。
 */
import { expect, test } from '@playwright/test';
import { importBook, openDemo } from './utils/demo.js';

const CONTINUED_SELECTOR = '.bt-reader-page [data-continued="true"]';

test('跨页续排片段顶格（data-continued 置零首行缩进）', async ({ page }) => {
  await openDemo(page);
  await importBook(page, 'continued.md', '长段');

  /* 逐页扫描：找存在续排片段的页，同时记录非续排段落的缩进作对照 */
  let sawContinued = false;
  let sawIndentedPlain = false;
  for (let step = 0; step < 40; step += 1) {
    const state = (await page.evaluate(`
      (() => {
        const continued = Array.from(
          document.querySelectorAll('${CONTINUED_SELECTOR}'),
        );
        const plain = Array.from(
          document.querySelectorAll(
            '.bt-reader-page .bt-paragraph:not([data-continued])',
          ),
        );
        const indentOf = (el) => getComputedStyle(el).textIndent;
        return {
          continuedCount: continued.length,
          continuedIndents: continued.map(indentOf),
          plainIndents: plain.map(indentOf).filter((v) => v !== '0px'),
        };
      })()
    `)) as {
      continuedCount: number;
      continuedIndents: string[];
      plainIndents: string[];
    };
    if (state.continuedCount > 0) {
      sawContinued = true;
      for (const indent of state.continuedIndents) {
        expect(indent, '续排片段必须顶格').toBe('0px');
      }
    }
    if (state.plainIndents.length > 0) sawIndentedPlain = true;

    const next = page.getByRole('button', { name: '下一页' });
    if (!(await next.isEnabled())) break;
    await next.click();
    await page.waitForTimeout(250);
  }

  expect(sawContinued, '长段必然跨页：至少一页存在续排片段').toBe(true);
  expect(sawIndentedPlain, '非续排段落仍保有首行缩进（对照）').toBe(true);
});
