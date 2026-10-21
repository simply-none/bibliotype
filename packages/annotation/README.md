# @bibliotype/annotation

批注 / 高亮 / 书签 / 评论模型与容器：挂在 core 锚点之上，不改进正文。

四类语义共用一套结构，位置用「节点 id + 字符偏移」表达，重排、改字号、切直排都不会漂移。
纯数据与纯函数，无 DOM / 框架依赖。

## 安装

```bash
pnpm add @bibliotype/annotation @bibliotype/core
```

## 快速上手

```ts
import { createTextAnchor } from '@bibliotype/core';
import { AnnotationStore, createHighlight, createComment, resolveAnnotations } from '@bibliotype/annotation';

const anchor = createTextAnchor('p-1', 0, 4);
const store = new AnnotationStore();

store.add(createHighlight(anchor, { createdAt: '2026-10-20T00:00:00.000Z' }));
store.add(createComment(anchor, '底本作「悦」', { id: 'u1' }, { createdAt: '2026-10-20T00:00:00.000Z' }));

const { resolved, orphans } = resolveAnnotations(document.root, store.list());
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| 类型 | `Annotation` / `AnnotationKind` / `AnnotationAuthor` / `CommentEntry` / `AnnotationSet` / `AnnotationFilter` / `AnnotationStorage`、`ANNOTATION_KINDS` |
| 构造 | `createAnnotation` / `createHighlight` / `createBookmark` / `createNote` / `createComment`、`addComment` / `setCommentResolved`、`buildAnnotationId`、`DEFAULT_HIGHLIGHT_COLOR` |
| 容器 | `AnnotationStore`（`add` / `addMany` / `update` / `remove` / `list` / `subscribe` / `hydrate` / `persist`）、`AnnotationPatch` |
| 解析 | `resolveAnnotation` / `resolveAnnotations`、`groupAnnotationsByNode`、`countByKind` |
| 序列化 | `serializeAnnotationSet` / `deserializeAnnotationSet`、`isAnnotation` / `validateAnnotations`、`ANNOTATION_SCHEMA_VERSION` |
| 加密 | `createEncryptedAnnotationStorage`（独立密钥，`EncryptedAnnotationStorageOptions`） |

## 约定

- id 是内容哈希（`kind + 锚点 + 时间 + 作者 + 正文`），同一记录天然去重，不用随机数；
- 时间通过 `createdAt` / `clock` 注入，测试可断言确定性输出；
- 目标节点被删除时解析结果归入 `orphans`，文本变短时 `clamped = true`——不抛错；
- 标注建议**单独存储**（`AnnotationStorage`），不要塞回 `BookDocument`。

## 注记独立加密（H5）

```ts
import { createEncryptedAnnotationStorage } from '@bibliotype/annotation';
import { createStringCipher, deriveKeyPbkdf2 } from '@bibliotype/core';

const notesKey = await deriveKeyPbkdf2({ password, salt: notesSalt });   // 与正文密钥分开
const storage = createEncryptedAnnotationStorage({
  read, write, remove,                       // 宿主提供三个读写函数
  cipher: createStringCipher(notesKey),
});

await store.persist(storage, 'lunyu');       // 落盘为密文信封
```

- 只锁笔记与批注，正文可照常阅读（反之正文加密也可先不解锁注记）；
- 载荷是 JSON 信封，底层存储只见密文；历史明文 / 被改写的载荷抛
  `CryptoError(CORRUPT_PAYLOAD)`，口令错抛 `WRONG_KEY`，**不静默降级为明文**；
- 密钥只驻内存，会话结束失效；脱敏导出（`redactAnnotations`）是另一件事，不要混用。

## 相关

- 功能参考：[docs/24-annotation.md](../../docs/24-annotation.md)
- 锚点契约：[docs/23-ir-validation-and-migration.md](../../docs/23-ir-validation-and-migration.md)
- 仓库主页：[bibliotype](../../README.md)
