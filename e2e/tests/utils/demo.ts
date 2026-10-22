/**
 * Demo 页面操作封装（I1 冒烟用例共用）
 *
 * 只经用户可见入口（按钮 / 文件选择 / 下拉框）操作，不注入内部状态钩子，
 * 保证 e2e 验的是真实交互链路。
 */
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 测试样例目录（本文件位于 e2e/tests/utils/） */
export const FIXTURES_DIR = path.resolve(HERE, '../../fixtures');

/** 取 fixture 绝对路径 */
export function fixture(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/** 打开 demo 并等待首屏分页就绪 */
export async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.bt-book-view--paged')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.bt-pager__status')).toContainText('共', { timeout: 60_000 });
}

/**
 * 等分页落定：去抖窗口 + 字体就绪 + 两帧渲染
 *
 * Demo 的重测走 120ms 去抖（`scheduleRemeasure`），设置面板保存后立即读数
 * 会拿到重排前的旧页；故先跨过该窗口再等字体与两帧 rAF。
 */
export async function waitForPagingIdle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/** 经「导入」面板导入 fixture 文件；可选等待正文片段出现 */
export async function importBook(
  page: Page,
  name: string,
  expectText?: string,
): Promise<void> {
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.locator('.panel__file-input').setInputFiles(fixture(name));
  await expect(page.locator('.panel__status')).toContainText('已导入', { timeout: 30_000 });
  if (expectText !== undefined) {
    await expect(page.locator('.bt-reader-page').first()).toContainText(expectText, {
      timeout: 30_000,
    });
  }
  await waitForPagingIdle(page);
}

/** 页码文本（形如「第 1 页 / 共 12 页」） */
export async function pagerText(page: Page): Promise<string> {
  return (await page.locator('.bt-pager__status').innerText()).trim();
}

/** 点「下一页」并等待页码变化 */
export async function gotoNextPage(page: Page): Promise<void> {
  const before = await pagerText(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => pagerText(page), { timeout: 15_000 }).not.toBe(before);
  await waitForPagingIdle(page);
}

/** 点「上一页」并等待页码变化 */
export async function gotoPrevPage(page: Page): Promise<void> {
  const before = await pagerText(page);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect.poll(() => pagerText(page), { timeout: 15_000 }).not.toBe(before);
  await waitForPagingIdle(page);
}

/** 切主题（顶栏主题按钮，标签即主题名） */
export async function switchTheme(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
  await waitForPagingIdle(page);
}

/**
 * 打开「设置 → 版面与页面」切换书写方向
 *
 * 设置面板是草稿模式：改动先存草稿，点底部「保存」才烘焙生效并关闭。
 *
 * @param label 书写方向按钮标签（横排 / 竖排右起 / 竖排左起）
 */
export async function setWritingMode(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '版面与页面', exact: true }).click();
  const field = page.locator('.panel__field').filter({ hasText: '书写方向' });
  await field.getByRole('button', { name: label, exact: true }).click();
  await page.locator('.panel__actions .panel__primary').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await waitForPagingIdle(page);
}

/** 当前阅读页正文文本（单页模式第一页） */
export async function currentPageText(page: Page): Promise<string> {
  return (await page.locator('.bt-reader-page').first().innerText()).trim();
}
