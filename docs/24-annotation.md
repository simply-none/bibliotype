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

## 七、注记独立加密（H5）

注记可以用**独立密钥**加密：只锁笔记与批注，正文照常阅读；反之正文加密时也可以先不解锁注记。

```ts
import { createEncryptedAnnotationStorage } from '@bibliotype/annotation';
import { createStringCipher, deriveKeyPbkdf2 } from '@bibliotype/core';

/* 与正文密钥分开派生：不同 salt 或不同口令 */
const notesKey = await deriveKeyPbkdf2({ password: notesPassword, salt: notesSalt });
const notesCipher = createStringCipher(notesKey);

const storage = createEncryptedAnnotationStorage({
  read: (bookId) => idb.readPayload(`ann:${bookId}`),
  write: (bookId, payload) => idb.writePayload(`ann:${bookId}`, payload),
  remove: (bookId) => idb.removePayload(`ann:${bookId}`),
  cipher: notesCipher,
});

await store.persist(storage, 'lunyu');   // 落盘的是密文信封
await store.hydrate(storage, 'lunyu');   // 口令错 → CryptoError(WRONG_KEY)
```

- 载荷是 JSON 信封字符串（`isEncryptedEnvelope` 判定），底层存储只见密文；
- **不静默降级**：历史明文标注、被改写的载荷、解密后非合法集合一律抛
  `CryptoError`（`CORRUPT_PAYLOAD`），提示「关闭注记加密或从备份恢复」；
- 口令错抛 `WRONG_KEY`，不删除、不覆盖原记录，重试即可；
- 密钥只驻内存，会话结束即失效；「本次会话已解锁」由宿主记录，不落盘；
- 与正文加密的分工：正文加密解决「库里读不出书」，注记加密解决「库里读不出笔记」，
  两者可单独开关。

导出侧脱敏（`redactAnnotations` / `redactDocument`）解决另一个问题：导出物里
**不含**批注、作者与阅读进度。目录下 [10 存储适配器](10-storage-adapters.md#存储层加密h5) 记了正文侧装饰器，
两者不要混用——加密只管存储，脱敏只管导出。

## 在 Vue 中消费（C6 / D2）

标注包只管数据；视图侧由 `@bibliotype/vue` 提供：

- `useAnnotations({ bookId, document, store, getSelectionAnchor, locate })`：选区 → `Anchor` → `createBookmark/createHighlight/createNote/createComment`，经 `AnnotationStorage`（indexedDB / http / localStorage 适配器）持久化；
- `buildAnnotationSidebarModel(document.root, annotations)`：`resolveAnnotations` 解析锚点后归入最近章节，产出侧栏视图模型（纯函数，可单测）；
- `BtAnnotationSidebar`：书签 / 高亮 / 笔记 / 评论四个 tab，按章分组，emit `locate` / `remove` / `resolve` / `reply`；正文内高亮装饰留给 D9；
- `annotationsToMarkdown(document.root, annotations)`：按章节导出 Markdown 摘要（`# 标注导出` + 每章列表）；
- 依赖方向：`vue → annotation → core`；导出器不依赖 annotation，评论经 `core` 的 `ExportComment` 契约传入（见 [07](07-export-epub.md)）。
