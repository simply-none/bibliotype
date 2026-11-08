# 仿真翻页引擎 npm 包抽取方案

> 状态：**待确认（尚未执行任何迁移）** · 日期：2026-11-08
> 来源：apps/pageflip-demo 的 `src/engine`（仿真翻页 Page Curl 引擎，55 测试全绿）

---

## 一、目标

1. 把 `apps/pageflip-demo/src/engine` 的仿真翻页引擎抽成仓库内 npm 包
   （`packages/page-flip`，包名 `@bibliotype/page-flip`），与
   `@bibliotype/typography-cjk` 等现有包同构：tsup 构建 + 日期版本发布流程；
2. `apps/pageflip-demo` 改为引用该包（行为回归一致），引擎代码从此单一来源；
3. 后续 `apps/demo`（阅读闭环 Demo）引入该包接入真实翻页（第二阶段，另行确认）。

## 二、现状盘点

| 项 | 现状 |
| --- | --- |
| 引擎代码 | `apps/pageflip-demo/src/engine/*.ts` 共 11 个文件（约 2.4k 行）：types / curl-model / flip-decisions / deform / shaders / mat4 / gl-renderer / page-provider / texture-store / input / flip-controller |
| 测试 | 4 个测试文件共 55 例，全部围绕引擎；其中 `flip-controller.test.ts` 依赖 demo 的 `createHorizontalTextProvider`（需处理，见 §五.4） |
| Demo 壳 | `App.vue`、`use-pageflip.ts`（Vue 组合式）、`providers/*`（三套样张内容层） |
| 运行时依赖 | 引擎**零 npm 依赖**——纯浏览器 API（WebGL / Pointer Events / OffscreenCanvas 类离屏 2D）；`use-pageflip` 依赖 vue |
| 仓库惯例 | pnpm workspace（`packages/*`、`apps/*`）+ turbo（build/test/typecheck/clean）+ tsup（esm/cjs/dts）+ `.changeset` 日期版本脚本（`scripts/version.mjs`，不使用 changeset version/publish） |

## 三、包设计

- **包名**：`@bibliotype/page-flip`（备选：`pageflip-engine` / `page-curl`，待确认）
- **位置**：`packages/page-flip`
- **定位**：框架无关的仿真翻页引擎（WebGL 圆柱卷曲 + 手势状态机），**零运行时依赖**；
  Vue 组合式作为可选子入口（与 `@bibliotype/vue` 的 peer 依赖做法一致）
- **依赖**：`devDependencies` 仅 tsup / typescript / vitest / vue（类型用）；
  `peerDependencies`：`vue ^3.4.0`（仅 `./vue` 子入口需要）
- **构建**：tsup，`entry: { index: 'src/index.ts', vue: 'src/vue.ts' }`，esm + cjs + dts，
  `target: es2020`，`sideEffects: false`（与 typography-cjk 同模板）

### 导出面

```jsonc
"exports": {
  ".":     { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
  "./vue": { "types": "./dist/vue.d.ts",   "import": "./dist/vue.js",   "require": "./dist/vue.cjs"  }
}
```

- `.`（主入口）：`FlipController`、`GlRenderer`、`InputSource`、`PageBitmapSource`、
  `TextureStore`、`deformPoint`、`solveFoldPose` / `solveFoldPoseAtProgress` /
  `createFoldSession` / `clampCornerTouch` / `clampTouch`、`resolveGrabZone` /
  `decideRelease` / `snapDurationFor`、`DEFAULT_FLIP_CONFIG` 及全部类型
  （`FlipConfig` / `FoldPose` / `PageSize` / `Point` / `PageProvider` / `FlipSceneState` /
  `FlipRenderAdapter` / `GrabMode` / `FlipAction` / `FlipOrientation`）
- `./vue`：`usePageflip(canvasRef, stageRef, options)` —— 组合式（生命周期 / 视口自适应 /
  状态与 FPS / 自动演示），**provider 由调用方注入**（与内容层解耦）
- **不随包**：`providers/*` 三套样张（横排 / 直排 / 画册）属于 demo 内容层，留在应用侧

## 四、目标目录结构

```
packages/page-flip/
├── package.json          # @bibliotype/page-flip，exports: . 与 ./vue
├── tsup.config.ts        # 双入口 esm+cjs+dts
├── tsconfig.json         # extends ../../tsconfig.base.json
├── README.md             # 用法 / API 摘要（从现 README 引擎章节改写）
└── src/
    ├── index.ts          # 公共导出面（新写）
    ├── types.ts          ┐
    ├── curl-model.ts     │
    ├── flip-decisions.ts │ 11 个引擎文件
    ├── deform.ts         │  git mv 原样迁入（仅改无）
    ├── shaders.ts        │
    ├── mat4.ts           │
    ├── gl-renderer.ts    │
    ├── page-provider.ts  │
    ├── texture-store.ts  │
    ├── input.ts          ┘
    ├── flip-controller.ts
    └── vue.ts            # usePageflip（自 demo 迁入，provider 参数化）
└── __tests__/            # curl-model / deform / flip-decisions / flip-controller 测试随迁
```

## 五、迁移步骤（确认后执行，分步提交）

1. **建包骨架**：`packages/page-flip` 的 package.json / tsup.config / tsconfig / README；
2. **`git mv` 引擎**：11 个 `src/engine/*.ts` → `packages/page-flip/src/`（保留 git 历史）；
   新写 `src/index.ts` 统一导出；
3. **迁移 Vue 组合式**：`use-pageflip.ts` → `packages/page-flip/src/vue.ts`，
   provider 改为必传参数（去除对 demo providers 的 import）；
4. **测试桩**：包内新增最小 `PageProvider` 测试桩（stubProvider），`flip-controller.test.ts`
   改用桩替代 `createHorizontalTextProvider`；其余 3 个测试文件原样随迁；
5. **改造 pageflip-demo**：`dependencies` 增 `@bibliotype/page-flip: workspace:*`；
   删除 `src/engine/`；`use-pageflip` 改为薄壳（转发包内 `./vue`）；`providers/*` 保留；
6. **文档**：根 README（如有提及）与包 README 更新；
7. **版本**：新增 `.changeset/*.md` 条目（新包首次发布）；版本号走日期版本脚本
   （初版形如 `26.11.8-rc.0`，正式发布按 `docs/12-release-and-ci.md` 流程）；
8. **全仓验证**：`pnpm verify`（turbo build + test + typecheck）+ 浏览器回归
   pageflip-demo（横排 / 直排 / 画册、深拉 / 快甩 / 回弹）；
9. **提交**：按上述步骤分 2~3 个 commit（建包迁移 / demo 改造 / changeset）。

## 六、apps/demo 接入（第二阶段，另行确认后再执行）

现状：`apps/demo` 阅读主区为 `BtBookView`（`pageTransition: 'slide' | 'fade' | 'none'`，CSS 转场）。
两个接入路线：

- **路线 A（全局升级）**：`packages/vue` 的 `BtBookView` 新增 `pageTransition: 'curl'` 档，
  内部用 `@bibliotype/page-flip` 渲染，页面位图经 `createDomPageCapture(reader)` 桥接
  （`packages/vue/src/image-export.ts` 已有能力）。工作量大、收益全局。
- **路线 B（闭环验证）**：`apps/demo` 内新增独立翻页阅读视图：`usePageflip` +
  一个把 reader 输出（DOM/DOM 页）光栅化为 `PageProvider` 的适配器。不动 BtBookView。

**建议**：先 B 后 A；B 可作为 A 的适配层原型。注意：foreignObject 光栅化要求 CJK
web 字体 data-URI 内嵌，接入前需评估字体子集化体积。

## 七、风险与注意点

- `git mv` 保历史；Windows 下 LF→CRLF warning 无碍；
- turbo 自动纳入新包（`packages/*` 通配），`test/typecheck` 依赖 `^build`，无需改 turbo.json；
- vitest node 环境无 WebGL：现有测试已用假 GL / 桩渲染适配器，随包可用；
- tsup dts 解析 `vue.ts` 的 vue 类型需包内 devDeps 安装 vue；
- 包体积小（引擎 gzip 约 15KB 级），`size-limit` 可选接入；
- `apps/pageflip-demo` 为 private 包，发布面只有 `@bibliotype/page-flip`。

## 八、验收标准

- [ ] `pnpm verify` 全仓绿（build / test / typecheck）；
- [ ] 55 个测试在包内全绿；`apps/pageflip-demo` 无残留 `src/engine`；
- [ ] pageflip-demo 浏览器回归与改造前行为一致（三种行款、深拉锚定、快甩、回弹、演示）；
- [ ] `dist` 的 exports / types 正确，可被 apps/demo 以 `@bibliotype/page-flip` 引入编译通过；
- [ ] changeset 条目就位，`pnpm changeset:status` 正常。

## 九、待确认问题（回复后即执行）

1. 包名用 `@bibliotype/page-flip` 可以吗？
2. Vue 组合式随包做 `./vue` 子入口（推荐），还是留在应用侧？
3. `apps/demo` 接入路线：先 B 后 A（推荐）/ 直接 A / 仅 B？
4. 初版版本号按日期版本从 `26.11.x-rc` 起步，可以吗？
5. 三套样张 providers 确认不随包（留在 pageflip-demo）？
