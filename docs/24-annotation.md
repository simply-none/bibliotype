# 24 标注（高亮 / 书签 / 笔记 / 评论）

> 涉及包：`@bibliotype/annotation`（依赖 `@bibliotype/core`）
> 相关篇目：[23 IR 校验与锚点](23-ir-validation-and-migration.md) · [01 数据模型](01-document-model.md)

标注是**不改进正文的旁注数据**：正文仍是唯一事实源，标注挂在核心锚点之上。
四类语义共用一套结构，避免为每种类型各造模型。

---

## 一、数据结构

```ts
interface Annotation {
  id: string;                 // 确定性内容哈希（kind + 锚点 + 时间 + 作者 + 正文）
  kind: 'highlight' | 'bookmark' | 'note' | 'comment';
  anchor: Anchor;             // core 锚点（block / text）
  color?: string;             // 高亮颜色
  body?: string;              // 笔记正文 / 书签标题
  comments?: CommentEntry[];  // 评论线程
  resolved?: boolean;         // 评论是否已解决
  author?: { id: string; name?: string; color?: string };
  attrs?: Record<string, string | number | boolean>;
  createdAt: string;          // ISO 8601
  updatedAt: string;
}
```

## 二、创建

```ts
import { createTextAnchor } from '@bibliotype/core';
import { createHighlight, createNote, createComment } from '@bibliotype/annotation';

const anchor = createTextAnchor('p-1', 0, 4);

const highlight = createHighlight(anchor, { createdAt: '2026-10-20T00:00:00.000Z' });
const note = createNote(anchor, '此处当为「说」', { createdAt: '2026-10-20T00:00:00.000Z' });
const comment = createComment(anchor, '底本作「悦」，待核', { id: 'u1' }, {
  createdAt: '2026-10-20T00:00:00.000Z',
});
```

约定：

- **时间通过 `createdAt` 或 `clock` 注入**，测试因此可断言确定 id；
- id 由内容哈希生成：同一区间 + 同一作者 + 同一时间 = 同一条记录，天然去重；
- `addComment` / `setCommentResolved` 返回**新对象**，不修改入参。

## 三、容器

`AnnotationStore` 是库层唯一标注容器，UI 与持久化都通过它：

```ts
import { AnnotationStore, createBookmark, resolveAnnotations } from '@bibliotype/annotation';

const store = new AnnotationStore();
store.add(createBookmark(createTextAnchor('p-2', 0, 0), { createdAt: '2026-10-20T00:00:00.000Z' }));

store.list({ kind: 'bookmark' });            // 拷贝 + 稳定排序（createdAt, id）
store.list({ nodeId: 'p-2' });               // 按目标节点过滤
store.list({ includeResolved: false });      // 隐藏已解决评论
store.update(id, { body: '改过', updatedAt: '2026-10-21T00:00:00.000Z' });
store.remove(id);
store.subscribe((snapshot) => render(snapshot));   // 返回取消函数
```

- 重复 id 抛 `RangeError`（不静默覆盖）；`addMany` 失败整体不写入；
- 对外返回浅拷贝，外部改动不会污染内部状态；
- `update` 不隐式取当前时间，`updatedAt` 由调用方给。

### 持久化

```ts
interface AnnotationStorage {
  readonly name: string;
  loadAnnotations(bookId: string): Promise<AnnotationSet | undefined>;
  saveAnnotations(bookId: string, set: AnnotationSet): Promise<void>;
  clearAnnotations(bookId: string): Promise<void>;
}

await store.persist(storage, 'book-1');       // 整体覆盖
await store.hydrate(storage, 'book-1');       // 未命中返回 0，保持现状
```

适配器侧建议把标注**单独存键**（不要塞回 `BookDocument`）：标注读写频率远高于正文，
混存会让每次高亮都触发整本文档重写。

## 四、解析与孤儿

```ts
const { resolved, orphans } = resolveAnnotations(document.root, store.list());
// resolved: [{ annotation, node, text, clamped }]

groupAnnotationsByNode({ resolved, orphans });   // Map<nodeId, ResolvedAnnotation[]>（键升序）
countByKind({ resolved, orphans });              // { highlight: 12, bookmark: 3 }
```

`clamped === true` 表示原文变短、偏移被裁剪——UI 应提示「标注位置已调整」；
`orphans` 是目标节点已删除的标注，建议提供「批量清理 / 重新定位」入口。

## 五、序列化

```ts
import { serializeAnnotationSet, deserializeAnnotationSet } from '@bibliotype/annotation';

const json = serializeAnnotationSet(store.list());   // 按 createdAt + id 排序，输出确定
const set = deserializeAnnotationSet(json);          // 非法输入抛 TypeError
```

## 六、常见错误

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 重排后高亮错位 | 用了页码 / DOM 路径记录位置 | 改用 `Anchor`（节点 id + 字符偏移） |
| 标注随正文一起丢失 | 把标注塞进了 `BookDocument` 又被整体覆盖 | 标注单独存储，与正文解耦 |
| 同一处高亮出现两条 | 手工生成 id（随机 / 时间戳） | 用 `createHighlight` 的内容哈希 id |
| 评论无法标记已解决 | 直接改 `resolved` 字段 | 用 `setCommentResolved(annotation, true)` 返回新对象 |
