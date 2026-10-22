/**
 * B3 直排列级像素回归
 *
 * 三组固定 fixture 覆盖直排的关键分支：
 * 1. 古籍直排（单栏竖行）——列级拆分的基线；
 * 2. 古籍仿真直排（版框 / 界行绘制层）——几何截图的主要对象；
 * 3. 竖排左起——书写方向反转后列序 / 断行与分桶仍稳定。
 *
 * 多栏直排不在本批：分栏数取自 IR 章节属性（`attrs.columns`），导入链路
 * 不写该属性且预览侧无写入 UI；分页容量 `pageMainSize × columns` 亦只对
 * 横排成立（直排分栏不增加主轴容量），引擎支持前不设伪场景（见 docs/18）。
 *
 * 双层断言：
 * - **结构**（toMatchSnapshot）：列数、每栏行数、逐行文本（断行位置）。
 *   字体替换 / 字号变化会改变断行，CI 直接失败；
 * - **几何**（toHaveScreenshot）：截图前把文字置透明，只比对页框 / 界行 / 分栏，
 *   字形差异不参与像素比对，基线可跨平台复用（取舍见 docs/18）。
 *
 * 基线更新：`pnpm e2e:update`（仅 @pixel，人工核对后提交）。
 */
import { expect, test } from '@playwright/test';
import {
  gotoNextPage,
  importBook,
  openDemo,
  setWritingMode,
  switchTheme,
  waitForPagingIdle,
} from './utils/demo.js';
import { maskTextForGeometryShot, measureVerticalPage } from './utils/vertical.js';

interface VerticalCase {
  /** 用例键（快照文件名前缀） */
  key: string;
  /** fixture 文件 */
  file: string;
  /** 主题按钮标签 */
  theme: string;
  /** 设置面板改写的书写方向（缺省跟随主题） */
  writingMode?: string;
  /** 正文首句（等待渲染的锚点） */
  anchor: string;
}

const CASES: readonly VerticalCase[] = [
  { key: 'c1-classical-1col', file: 'vertical-01.md', theme: '古籍直排', anchor: '学而时习之' },
  { key: 'c2-facsimile-1col', file: 'vertical-02.md', theme: '古籍仿真直排', anchor: '为政以德' },
  {
    key: 'c3-classical-lr',
    file: 'vertical-03.md',
    theme: '古籍直排',
    writingMode: '竖排左起',
    anchor: '里仁为美',
  },
];

for (const item of CASES) {
  test(`直排列级版式 · ${item.key} @pixel`, async ({ page }) => {
    await openDemo(page);
    await importBook(page, item.file, item.anchor);
    await switchTheme(page, item.theme);
    if (item.writingMode !== undefined) await setWritingMode(page, item.writingMode);
    await waitForPagingIdle(page);

    /* ---------- 第 1 页：列数 / 每栏行数 / 断行 ---------- */
    const first = await measureVerticalPage(page);
    expect(first.columnCount).toBe(1);
    expect(first.lines.length).toBeGreaterThan(0);
    // 每栏行数之和 = 总行数（分桶不丢行）
    expect(first.rowsPerColumn.reduce((sum, count) => sum + count, 0)).toBe(first.lines.length);
    expect(
      JSON.stringify(
        {
          columnCount: first.columnCount,
          rowsPerColumn: first.rowsPerColumn,
          lines: first.lines,
        },
        null,
        2,
      ),
    ).toMatchSnapshot(`${item.key}-page1.txt`);

    /* ---------- 第 2 页（若存在）：跨页断行同样锁基线 ---------- */
    if (await page.getByRole('button', { name: '下一页', exact: true }).isEnabled()) {
      await gotoNextPage(page);
      const second = await measureVerticalPage(page);
      expect(second.columnCount).toBe(1);
      expect(second.rowsPerColumn.reduce((sum, count) => sum + count, 0)).toBe(
        second.lines.length,
      );
      expect(
        JSON.stringify(
          {
            columnCount: second.columnCount,
            rowsPerColumn: second.rowsPerColumn,
            lines: second.lines,
          },
          null,
          2,
        ),
      ).toMatchSnapshot(`${item.key}-page2.txt`);
      // 回到第 1 页再截图（与结构基线同页）
      await page.getByRole('button', { name: '上一页', exact: true }).click();
      await waitForPagingIdle(page);
    }

    /* ---------- 几何截图：文字透明，只比版式框线 ---------- */
    await maskTextForGeometryShot(page);
    await expect(page.locator('.bt-reader-page').first()).toHaveScreenshot(`${item.key}.png`);
  });
}
