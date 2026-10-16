# @bibliotype/demo

bibliotype 全链路示例（**私有包，不发布**）：《论语》样章 + 分页阅读 / 目录 / 书签 /
现代横排 ⇄ 古籍直排切换 / 字号行距 / 夜间模式 / 编辑（保存并预览）/ EPUB 导出 / 打印 PDF。

## 运行

```bash
pnpm install                    # 仓库根目录安装依赖
pnpm build                      # 先构建全部包（demo 消费各包的 dist 产物）

pnpm --dir apps/demo dev        # 开发服务器（Vite，默认 http://localhost:5173）
pnpm --dir apps/demo build      # 生产构建
pnpm --dir apps/demo preview    # 预览构建产物
pnpm --dir apps/demo typecheck  # 类型检查（vue-tsc）
```

## 功能清单

| 分组 | 功能 |
| --- | --- |
| 阅读 | 分页渲染（BtBookView）、翻页、目录跳转、书签定位 |
| 版式 | 现代横排 / 古籍直排切换、字号加减、行距调整、夜间模式 |
| 编辑 | 打开编辑器修改样章；草稿自动保存（节流合并 + 空闲落盘，`Ctrl`/`Cmd`+`S` 立即保存），「保存并预览」写回文档并重新分页 |
| 导出 | EPUB 下载（exporter-epub）、打印 PDF（exporter-pdf + `window.print`） |
| 检索 | 书籍信息面板、全文搜索（命中跳页） |

## 实现要点

- 演示数据（《论语》等）为内置 IR 文档，无后端依赖；
- 编辑保存后的文档与首次进入共用同一条「IR → 分块 → 分页 → HTML 序列化」链路，
  保证「编辑前后样式一致」（注释容器恒为原子叶块，样式与稳定 id 一并保留）；
- 草稿持久化（IndexedDB）走 `src/composables/use-draft-autosave.ts`：**节流合并 + 空闲时段 +
  单飞去重 + 上限兜底**，快照用 `getSharedDocument()`（共享 IR）并与 `markSaved()` 同一同步帧对齐
  —— 大文档（上万块 / 百万字）编辑时序列化与整本写入都不落在输入帧上（见 [docs/14](../../docs/14-faq.md) 第 6 条）；
- 工具栏为单行布局，窗口过窄时支持鼠标横向滚动（滚轮 / 按住拖动平移）；
- 各包均以 `workspace:*` 引用，demo 直接从 `dist` 消费，修改包后需先 `pnpm build`。

## 相关

- 仓库主页：[bibliotype](../../README.md)
- 功能参考：[docs/](../../docs/README.md)
