---
'@bibliotype/layout': patch
'@bibliotype/vue': patch
---

跨页续排顶格 + 书排对齐基线 + 换书渲染修复（真实书籍逐页校验）

**背景**：以《少有人走的路》全书（2236 页）逐页校验发现两处缺陷——跨页续排的
后继片段被当新段落缩进两字符（同一句话视觉断裂），页底出现空行带；导入新书后
阅读区仍显示旧书。

- **续排片段顶格**（layout）：序列化器新增 `continued` 选项（根元素输出
  `data-continued="true"`），book-css 据此置零首行缩进（令牌 / data-indent 低格 /
  data-lift 挪抬一并压过，两条规则按特异性分层、排于缩进规则之后）。续片是
  同一句话的中段，首行缩进属原段首行；带缩进渲染还会使片段实际行数超出分页
  记账（页底空行带 / 尾行被裁）。预览 / 编辑画布 / PDF 打印三端按分页 items
  的 `fromLine > 0` 统一传入。
- **书排两端对齐**（layout）：根容器补 `text-align: justify`（仅横排——直排行内
  流里断列标记留下的短列是容器中间行，justify 会把它拉伸到整列高、字距脱
  界行网格，故直排保持自然列高）。不影响换行点与行数，分页几何不变。
- **标题 margin 显式化**（layout）：`.bt-heading` 补 `margin: 0.83em 0`——UA 对
  h1~h6 的缺省外边距逐级不同且跨引擎不确定，估算路径与打印稿随之漂移。
- **换书渲染修复**（vue）：`BtBookView` 的页面内容 computed 曾只依赖
  `currentPage`，取内容走**非响应式** reader 方法调用——同一页码下换文档
  （0→0）computed 不失效，旧书 HTML 常驻（导入后阅读区停在旧书的根因，
  也是 e2e 冒烟长期失败的原因）。现 `renderPageParts` / `earHtml` 显式依赖
  pagination 引用，与 gutterHtml / pageNotesHtmlOf 同款口径。
- **useReaderBinding 响应式来源**（vue）：来源扩展为 `Reader | Ref | getter`，
  宿主运行期替换 Reader 实例（换书 / 换主题 / 导入重建）时事件自动改绑新
  实例、状态整体刷新——曾只在 setup 时捕获一次实例。`reader` 字段改为
  `ComputedRef<Reader>`；BtBookView / BtPager 改以 getter 传源。
- **导入后重挂**（demo）：导入完成自增 readerEpoch 强制重挂阅读视图——
  新文档即新阅读会话，翻页态 / 片段缓存 / 页转场快照全量重置。
