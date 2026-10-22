# @bibliotype/e2e

端到端冒烟（I1）与直排像素回归（B3），**独立工作区、不发布**。

## 运行

```bash
pnpm install                    # 仓库根
pnpm build                      # 必须先构建：webServer 用 vite preview 消费 dist
pnpm e2e:install                # 首次：下载 Playwright Chromium

pnpm e2e                        # 全部（冒烟 + 像素）
pnpm e2e:smoke                  # 仅 I1 主链路（CI 第一步）
pnpm e2e:pixel                  # 仅 B3 直排像素回归
pnpm e2e:update                 # 更新像素 / 结构基线（人工核对后提交）
```

失败产物在 `e2e/test-results/`（trace / video / screenshot）与
`e2e/playwright-report/`；本地执行 `pnpm --filter @bibliotype/e2e report` 查看。

## 用例分层

| Tag | 文件 | 覆盖 |
| --- | --- | --- |
| `@smoke` | `tests/smoke.spec.ts` | Markdown 导入 → 翻页 → 编辑落字 → 导出 EPUB 并解包校验；TXT 导入 → 直排切换；宿主 PDF 桥 → 导出 PDF 字节 |
| `@pixel` | `tests/vertical-pixel.spec.ts` | 三组直排 fixture（单栏 / 仿真版框 / 竖排左起）的列数、每栏行数、逐行断行 + 几何截图 |

## 两档视口（桌面 / H5）

| 项目 | 设备 | 跑什么 |
| --- | --- | --- |
| `chromium` | Desktop Chrome 1280×900 | 冒烟 + 像素（像素基线**只出在桌面档**，快照按 `projectName` 分目录） |
| `chromium-mobile` | iPhone 13（390×664，触屏） | 只跑 `smoke.spec.ts`（`testMatch` 限定），验 H5 壳层主链路 |

两档入口不同（H5 顶栏只留书名与「更多」，全局动作在 sheet 里），差异由
`tests/utils/demo.ts` 的 `clickGlobalAction(page, 名称)` 吸收：窄屏先开「更多」再点行项。
另两点 H5 专属处理：

- 面板装在模态抽屉里，遮罩会盖住底栏 → `importBook` 导入后按 Esc 收起抽屉再继续；
- 底栏翻页在 H5 只显图标（文案 `font-size: 0`），可访问名靠 `BtPager` 自带的
  `aria-label="上一页 / 下一页"`，因此按名点击在两档都成立。

## 基线口径（B3）

- **结构基线**（`tests/__snapshots__/**/*.txt`）：用 Range 逐字测行盒，
  记录列数、每栏行数、逐行文本（JSON 序列化后存 `.txt`——Playwright 对 `.json`
  扩展按二进制快照处理，会期望 Buffer）。fixture 只用等宽 CJK 字符（无比例宽度标点 /
  拉丁文），断行对字体不敏感，可跨平台比较；字体替换导致断行变化时 CI 失败。
- **像素基线**（`tests/__snapshots__/**/*.png`）：截图前注入「文字透明」样式，
  只比对页框 / 界行等几何。字形不进像素图，基线可跨平台复用；几何变化（列宽、
  版框、页边距）仍会失败并可查看 diff。

## 稳定性约定

- 单 worker 串行（demo 的 IndexedDB / 设置作用域是浏览器态，串行避免互相污染）；
- 视口按项目固定（桌面 1280×900 / H5 390×664）、locale `zh-CN`、时区 `Asia/Shanghai`、截图 `scale: 'css'`；
- 等分页落定统一走 `waitForPagingIdle`：设置面板保存后的重测有 120ms 去抖
  （`scheduleRemeasure`），立即读数会拿到重排前的旧页，因此先跨去抖窗口再等字体与两帧 rAF；
- 每次用例新 context，启动时从空 IndexedDB 走默认《论语》样章；
- 等待用「用户可见结果」（页码文本、正文片段）而非固定 sleep。

## 依赖边界

e2e 只消费 demo 的**产物**（`apps/demo/dist` + 各包 dist）与 Playwright，
不 import 任何 `@bibliotype/*` 源码；产物校验用 `fflate` 解包（与导出包同族的
zip 实现），避免测试与被测实现共享解析代码。
