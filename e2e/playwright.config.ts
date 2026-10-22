/**
 * Playwright 端到端配置（I1 冒烟 / B3 直排像素回归）
 *
 * 运行前提：仓库已 `pnpm build`（webServer 用 `vite preview` 消费
 * `apps/demo/dist` 与各包 dist，不再跑 dev server，避免 HMR 抖动影响截图）。
 *
 * 分级：用例 tag `@smoke`（I1 主链路）/ `@pixel`（B3 直排像素回归），
 * 由 `--grep` 选择；CI 分两个 job 跑，见 .github/workflows/ci.yml。
 *
 * 稳定性约定：
 * - 单 worker 串行：demo 的 IndexedDB / 设置作用域是进程内共享的浏览器态；
 * - 视口与 locale / 时区固定，截图 `scale: 'css'`（不受 DPR 影响）；
 * - 失败留存 trace / video / screenshot（CI artifact 可下载复查）。
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // 快照按工程分目录：项目名 / 测试文件 / 名称
  snapshotPathTemplate: '{testDir}/__snapshots__/{projectName}/{testFilePath}/{arg}{ext}',
  timeout: 120_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      // 截图前注入「文字透明」样式，只比对版式几何：跨平台字形差异不影响像素图，
      // 断行 / 列数变化由 toMatchSnapshot 的结构断言负责。
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 2 : 0,
  forbidOnly: CI,
  reporter: CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm --dir apps/demo preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    // cwd 相对本配置文件所在目录 → 仓库根
    cwd: '..',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
