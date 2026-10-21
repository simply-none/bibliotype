# 11 主题与令牌

> 涉及包：`@bibliotype/core`、`@bibliotype/classical`、`@bibliotype/layout`　·　相关：[03 古籍排版](03-classical-layout.md)、[05 版式与 HTML](05-layout-and-html.md)

主题采用**双层结构**：

```text
Token 层（语义令牌，kebab-case）         CSS Variables 层（--bt-*）
font-family-body  ──────────────▶  --bt-font-family-body
color-text        ──────────────▶  --bt-color-text
```

Token 层描述「是什么」（core 定义，插件可扩展键）；CSS Variables 层由渲染层
（`buildCssVariables` / `buildBookCss`）生成，供样式消费。

## 内置令牌（core）

### 字体族 FONT_TOKENS

| 常量 | 键 | 默认值（DEFAULT_THEME） |
| --- | --- | --- |
| `BODY` | `font-family-body` | `'Noto Serif SC', 'Source Han Serif SC', <拉丁衬线>, <系统兜底>` |
| `HEADING` | `font-family-heading` | `'Noto Sans SC', 'Source Han Sans SC', <系统兜底>` |
| `CLASSICAL_BODY` | `font-family-classical-body` | 同 BODY（classical 插件覆盖为楷体系） |
| `MONO` | `font-family-mono` | `'JetBrains Mono', 'Cascadia Code', Consolas, monospace` |

### 字号 FONT_SIZE_TOKENS

| 常量 | 键 | 默认值 |
| --- | --- | --- |
| `BODY` | `font-size-body` | `16px` |
| `NOTE` | `font-size-note` | `0.75em` |
| `HEADING` | `font-size-heading` | `1.75em` |

### 版式 LAYOUT_TOKENS

| 常量 | 键 | 默认值 |
| --- | --- | --- |
| `LINE_HEIGHT` | `line-height-body` | `1.9` |
| `LETTER_SPACING` | `letter-spacing-body` | `0.02em` |
| `TEXT_INDENT` | `text-indent-body` | `2em`（古籍覆盖为 `0`） |
| `PAGE_MARGIN` | `page-margin` | `48px 56px`（上下 左右） |
| `COLUMN_GAP` | `column-gap` | `2.5em` |

### 颜色 COLOR_TOKENS

| 常量 | 键 | 默认值 |
| --- | --- | --- |
| `TEXT` | `color-text` | `#2c2c2c` |
| `BACKGROUND` | `color-background` | `#faf8f4` |
| `NOTE_TEXT` | `color-note-text` | `#6b6b6b` |
| `ACCENT` | `color-accent` | `#8c5a2b`（赭石） |

`DEFAULT_THEME` 为全部令牌的默认值表（`Readonly<Record<ThemeToken, string>>`）。

## ThemeAccessor —— 运行时主题读写

```ts
import { createThemeAccessor } from '@bibliotype/core';

const theme = createThemeAccessor({ 'font-size-body': '18px' });  // 可选初始覆盖

theme.get('color-text');                       // 读取令牌
const restore = theme.set('color-text', '#111'); // 写入并返回还原函数
restore();                                     // 还原到写入前（或删除新增键）
theme.all();                                   // 快照（只读，无法绕过 setter 修改）
```

- 基线为 `DEFAULT_THEME`，支持逐令牌覆盖；
- 允许任意字符串键（插件扩展令牌，如 classical 的 `writing-mode`）；
- 在 `createBibliotype()` 实例中经 `instance.theme` 访问，插件安装上下文即暴露它。

## 自定义主题

```ts
import { createBibliotype } from '@bibliotype/core';
import { DEFAULT_THEME, FONT_TOKENS } from '@bibliotype/core';

const instance = createBibliotype();

/* 直接覆盖 */
instance.theme.set('color-background', '#1e1e1e');   // 夜间模式
instance.theme.set('color-text', '#d6d6d6');

/* 或以插件形态打包主题（可卸载，restore 自动回滚） */
import { definePlugin } from '@bibliotype/core';

const nightTheme = definePlugin({
  name: '@example/night-theme',
  install(context) {
    const restores = [
      context.theme.set('color-background', '#1e1e1e'),
      context.theme.set('color-text', '#d6d6d6'),
    ];
    return () => restores.reverse().forEach((restore) => restore());
  },
});

instance.plugins.install(nightTheme);
```

渲染层消费：

```ts
import { DEFAULT_THEME } from '@bibliotype/core';
import { buildCssVariables } from '@bibliotype/layout';
import { buildBookCss } from '@bibliotype/layout/html';

const tokens = instance.theme.all();               // 或 DEFAULT_THEME
buildCssVariables(tokens);                         // 内联场景：--bt-* 声明对象
buildBookCss({ tokens, options: layoutOptions });  // 文本场景：:root 变量 + .bt-* 类样式
```

## 主题预设包（D10）

主题预设 = **只含令牌**的可分发产物（不含版式补丁 / 功能样式 / 命名样式），文件格式：

```json
{
  "kind": "bibliotype-theme-preset",
  "schemaVersion": 1,
  "preset": {
    "id": "night",
    "name": "夜间",
    "description": "深色底面 + 暖白文字，弱光环境下对比柔和",
    "tokens": {
      "color-text": "#E8E4DC",
      "color-background": "#1C1B19",
      "color-note-text": "#9A948A",
      "color-accent": "#C9A227"
    }
  }
}
```

- `id` 只允许小写字母 / 数字 / 连字符；`tokens` 按固定令牌顺序输出，**不含时间与随机值**，同一预设导出逐字节一致；
- `schemaVersion` 不匹配、`kind` 不符、未知令牌键、非法颜色 / 长度都会给出中文 issue 并**拒绝导入**；
- 校验口径「结构从严、语法从宽」：拦截 CSS 注入（`;` `{}` `<>` `url(`）与明显非法格式，不穷举 CSS 语法。

```ts
import {
  serializeThemePreset,
  parseThemePreset,
  validateThemePreset,
  applyThemePreset,
  ThemePresetError,
  createThemePresetCatalog,
  BUILTIN_THEME_PRESETS,
  DEFAULT_THEME,
} from '@bibliotype/core';

const json = serializeThemePreset(preset);
const parsed = parseThemePreset(json);            // 非法时抛 ThemePresetError（含 issues）
const check = validateThemePreset(JSON.parse(json)); // 不抛错，返回 { preset?, issues }

/* 应用：keep 中的令牌保留基线值（用户自定义字号不被主题覆盖） */
const next = applyThemePreset(DEFAULT_THEME, parsed, ['font-size-body']);

/* 目录：可注册 / 覆盖 / 移除，内置 night / eye-care / parchment */
const catalog = createThemePresetCatalog();
catalog.register(parsed);
catalog.list();  // 内置 + 已注册（按注册顺序）
```

| 导出 | 说明 |
| --- | --- |
| `THEME_PRESET_KIND` / `THEME_PRESET_SCHEMA_VERSION` | 文件类型标识与版本 |
| `ThemePreset` / `ThemePresetIssue` / `ThemePresetParseResult` | 预设、问题（`path` + 中文 `message`）、校验结果 |
| `serializeThemePreset` / `parseThemePreset` / `validateThemePreset` / `applyThemePreset` | 往返与合并 |
| `ThemePresetError` | 导入失败异常，`issues` 为全量问题清单 |
| `createThemePresetCatalog` / `BUILTIN_THEME_PRESETS` | 可实例化目录与三套内置预设 |
| `THEME_TOKEN_KEYS` / `isThemeToken` / `validateThemeTokenValue` / `validateThemeTokens` | 令牌层校验工具 |

### 主题与样式预设的边界

| 维度 | 主题预设（本节目） | 样式预设（`StylePreset`） |
| --- | --- | --- |
| 内容 | 仅令牌（建议只含颜色） | `layout` + `features` + `namedStyles` + `tokens` |
| 生效方式 | 合并进令牌链 | 整份写入样式快照 |
| 切换影响 | 不改字号 / 行距 / 页边距（`keep`） | 会整体替换排版 |

两者叠在不同层、互不覆盖；Demo 的合并顺序为
「主题 → 仿真模板 → 用户补丁（`tokenPatch`）→ 主题预设 → 夜间覆盖」：

- 主题预设压在用户补丁之上，避免「设置里改过颜色 → 主题预设看不见」；它默认只写颜色，
  字号 / 行距仍由 `tokenPatch` 主导；
- 「恢复默认」只清空主题预设差量，用户补丁里的颜色随即恢复；
- 夜间是临时预览，永远在最上层，应用主题预设时会自动关闭。

### Vue 侧

```vue
<BtThemePanel
  :tokens="tokens"
  :base-tokens="themeBaseTokens"
  @update:tokens="onApplyThemeTokens"
/>
```

`useThemePresets({ base?, tokens?, onTokensChange?, catalog?, keep? })` 返回
`presets` / `activeId` / `issues` / `applyPreset` / `resetTheme` / `exportJson` / `importJson`。
`applyPreset` 保留排版令牌；`importJson` 全量应用（导出再导入视觉一致）。详见 [06 Vue 集成](06-vue-integration.md)。

## 字体回退链调试（D10）

「某字由哪款字体画出来」只有宿主知道，因此 `core` 只提供端口 + 纯函数：

```ts
import { analyzeGlyphCoverage, formatCodePoint, type GlyphProbe } from '@bibliotype/core';

const probe: GlyphProbe = (char, family) => document.fonts.check(`12px ${family}`, char);
const report = analyzeGlyphCoverage('子曰𠀋', ['Songti', 'Kaiti'], probe);
// entries: [{ char, codePoint, code: 'U+5B50', family, missing, privateUse }, …]
// missing / total / missingCount / families
```

- 按码位去重、保留首次出现顺序；空白与控制符跳过；
- 全链未命中 → `missing: true`；私用区（PUA）→ `privateUse: true`（换字体必错字）；
- Vue 侧 `createFontCheckProbe()` 用 `document.fonts.check` 实现，环境不支持时**降级为全部命中**（宁漏报不误报）；
- `splitFontFamilyList('"Songti SC", serif')` 把令牌拆成族名数组；
- `BtFontFallbackPanel` 逐字展示命中族与码位，缺字标红；`maxChars` 防超长文本卡顿。

## 扩展令牌（插件）

插件可注册新令牌键（如 classical 的 `writing-mode` / `text-orientation` /
`text-combine-upright` / `text-combine-limit`），`buildCssVariables` 会将其一并
输出为 `--bt-*` 变量，样式构建器按需消费。见 [03 古籍排版](03-classical-layout.md)。

古籍仿真直排另用 9 个扩展键（不扩 `ThemeToken` 联合，仅在模板令牌与样式层消费）：

| 扩展令牌 | 说明 |
| --- | --- |
| `page-frame-color` / `page-frame-width` | 版框颜色与线宽 |
| `page-frame-inner-gap` / `page-frame-inner-width` | 双边间距与内框线宽 |
| `page-rule-color` | 界行颜色（乌丝栏 / 朱丝栏） |
| `gutter-color` | 版心文字与鱼尾颜色 |
| `page-texture` | 纸纹（CSS `background-image` 值，渐变 / `url()`；缺省不输出图层） |
| `font-family-classical-song` / `-fangsong` | 宋体 / 仿宋族（`FACSIMILE_FONT_TOKENS`） |

其中只有两个字体族令牌进入度量签名（影响字宽），颜色 / 线宽 / 纸纹属纯绘制、不触发重排。
见 [22 古籍仿真直排](22-facsimile-vertical.md)。

## 命名样式继承与扁平化（C10）

- `NamedStyle.basedOn` 指向另一命名样式 id，声明按「祖先在前、后代覆盖」合并；`basedOn` 存在主题层，不写入 IR 节点。
- `resolveNamedStyleChain(set, id)` 返回根 → 叶链（UI 展示依据来源）；`resolveNamedStyleDeclarations(set, id)` 返回合并后的扁平声明。
- 断链 / 成环不抛异常：返回已收集部分；`validateNamedStyleSet(set)` 以 `duplicate-id` / `self-reference` / `missing-based-on` / `circular-based-on` 上报。
- `buildFeatureCss` 对每条命名样式先扁平化再输出 `[data-style-id]`，因此「只写 basedOn、自身无声明」的样式也能命中。
- 持久化：`normalizeStyleSnapshot` 保留 `basedOn`，自引用在落盘层直接丢弃。
- 已知边界：仓库无 `exporter-docx`，本层不做 Word `styles.xml` 映射。

## 相关

- 令牌消费方：[05 版式与 HTML](05-layout-and-html.md)（buildBookCss / buildRootStyle）
- 插件机制：[02 编辑器与插件](02-editor-and-plugins.md)
- 古籍覆盖：[03 古籍排版](03-classical-layout.md)
