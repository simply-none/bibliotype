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
