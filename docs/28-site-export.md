# 28 静态站点导出

> 涉及包：`@bibliotype/exporter-site`（依赖 `@bibliotype/core` + `@bibliotype/layout`）
> 相关篇目：[05 版式与 HTML](05-layout-and-html.md) · [07 EPUB 导出](07-export-epub.md) · [26 交叉引用](26-cross-reference.md)

把一本书导出成**可直接上传静态托管**的站点：目录页 + 每节一页 + 样式 + 搜索索引 + IR 原文。
纯函数、无 IO、输出确定（无时间戳、按节序编号）。

## 一、快速上手

```ts
import { exportSite } from '@bibliotype/exporter-site';

const { files, sections, warnings } = exportSite(document, {
  siteTitle: '论语译注',
  language: 'zh-Hans',
  searchIndex: true,       // 缺省 true
  includeBookJson: true,   // 缺省 true
});

// files: [{ path: 'index.html', mediaType: 'text/html', text: '…' }, …]
```

写入磁盘（Node）：

```ts
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

for (const file of files) {
  const target = join('dist-site', file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.text, 'utf8');
}
```

## 二、产物

| 文件 | 说明 |
| --- | --- |
| `index.html` | 目录页（按节序链接，带层级缩进） |
| `section-N.html` | 每节一页，含上/下一节导航 |
| `style.css` | `buildBookCss` 书册样式（作用域 `.bt-reader-page`）+ 站点框架样式 |
| `search-index.json` | `{ version, entries: [{ id, title, path, text }] }`（按 id 升序） |
| `book.json` | IR 原文，便于二次加工（可关） |

## 三、分节规则

规划逻辑在 `planSections`，刻意做得「简单可预期」：

1. **有内容的结构节点各成一页**（卷 / 章 / 节 / 附录 / 序 / 跋 / 目录 / 封面 / 扉页 / 版权页）；
2. **只有子结构、自身无内容**的容器（常见于「卷」）不单独成页，向下递归；
3. 直接挂在根下的零散内容块合并为一页「正文」，不丢内容；
4. 节点 id 重复时自动加后缀（`dup`、`dup-2`）；
5. 空结构节点（占位章）仍成页，标题显示「（空）」。

标题优先级：`attrs.title` → 首个 `heading` 文本 → 节点纯文本前 24 字 → 兜底。

```ts
import { planSections, resolveSectionTitle } from '@bibliotype/exporter-site';

const { sections, warnings } = planSections(document);
sections.map((item) => `${item.section.path} ${item.section.title}`);
```

## 四、安全与样式

- 所有来自 IR 的文本都经 `escapeHtml` 转义；正文 HTML 只能由 `serializeNode` 产出；
- 样式全部限定在 `.bt-reader-page` / `.bt-site-*`，**不产生全局选择器**
  （避免与宿主页面互相污染，规则见 [14 FAQ](14-faq.md)）；
- 图片 `src` 原样透传：data URI 直接可用；本地路径需调用方在导出前替换为站点相对路径。

## 五、搜索索引

站点是静态的，检索在浏览器侧做：

```ts
import { buildSearchEntry, serializeSearchIndex } from '@bibliotype/exporter-site';

buildSearchEntry('ch-1', '学而篇', 'section-1.html', node);   // 文本已归一化空白
serializeSearchIndex(entries);                                // 确定性 JSON
```

前端拿到 `search-index.json` 后自行做子串 / 分词匹配（本包不绑定检索实现）。

## 六、边界

| 限制 | 说明 |
| --- | --- |
| 节数上限 | 缺省 `maxSections = 2000`，超限抛 `RangeError`（不静默截断） |
| 图片 | 不做媒体收集与去重（那是 `exporter-epub` 的 `MediaCollector` 职责） |
| 交叉引用 | 导出前自行 `resolveReferences`（见 [26](26-cross-reference.md)） |
| 分页 | 站点是连续流（不分页），页码类引用需另配索引 |

## 七、常见错误

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 目录页空白 | 文档没有结构节点且根下无内容块 | 检查 `planSections().warnings` |
| 标题显示「（空）」 | 结构节点没有子内容 | 补内容或删掉占位章 |
| 页面没有版式 | `style.css` 未随文件一起部署 | 确保同目录相对路径可用 |
| 输出两次不一致 | 调用了导出后又改了 IR | 导出是纯快照；改 IR 后重新导出 |
