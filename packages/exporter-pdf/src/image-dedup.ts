/**
 * 书档内联图片去重与还原（桌面宿主流式导出的传输瘦身）
 *
 * 动机：EPUB / docx 导入把图片（尤其缺字替代图）以 data URI **逐处内联**进书档——
 * 同一缺字图每出现一次就带一份完整 base64，千页级书籍的书档因此膨胀到数百 MB，
 * 整本过 IPC（contextBridge 深拷贝 + structured clone）会撞
 * 「Array buffer allocation failed」。
 *
 * `dedupeInlineImages`：写时复制遍历，把 `attrs.src` 的 `data:image/…` 收敛为唯一
 * 令牌（同图只留一份、按首现顺序编号）——同一张图在书档里只出现一次，令牌化后的
 * 书档体积 = 文本 + 结构。未触及子树**复用原引用**（不整树深拷贝、不改入参）。
 *
 * `rehydrateInlineImages`：宿主收到瘦身书档后，就地把令牌 src 还原为真实 URL
 * （通常已由宿主逐张落盘为相对路径）。原地修改——操作对象应为宿主私有的副本。
 */
import { isTextNode, type BookDocument, type BookNode } from '@bibliotype/core';

/** 内联图片资源（按首现顺序） */
export interface InlineImageAsset {
  /** 令牌（替换后的 src，形如 `__bibliotype_asset_0__`） */
  token: string;
  /** 原 data URI（`data:image/…`） */
  dataUri: string;
}

/** 令牌前缀（含双下划线包裹，避免与真实 src 冲突） */
export const INLINE_IMAGE_TOKEN_PREFIX = '__bibliotype_asset_';

/** 缺省令牌前缀 */
const DEFAULT_TOKEN_PREFIX = INLINE_IMAGE_TOKEN_PREFIX;

/** 是否为需收敛的内联图片 src */
function isInlineImageDataUri(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/** 去重选项 */
export interface DedupeInlineImagesOptions {
  /** 令牌前缀（缺省 `__bibliotype_asset_`） */
  tokenPrefix?: string;
}

/** 去重结果：瘦身书档 + 唯一内联图片（按首现顺序） */
export interface DedupeInlineImagesResult {
  /**
   * 瘦身书档：内联图片 src 已替换为令牌；未触及子树与入参共享引用（消费方
   * 不得原地修改与原档共享的部分，序列化 / 结构化克隆不受影响）
   */
  document: BookDocument;
  /** 唯一内联图片（data URI 只出现一次） */
  assets: InlineImageAsset[];
}

/** 写时复制遍历：收敛 `attrs.src` 的内联图片 */
function dedupeNode(
  node: BookNode,
  uriToToken: Map<string, string>,
  assets: InlineImageAsset[],
  counter: { next: number },
  prefix: string,
): BookNode {
  let next = node;
  let changed = false;

  const children = node.children;
  if (children !== undefined) {
    let mapped: BookNode[] | undefined;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (isTextNode(child)) continue;
      const replaced = dedupeNode(child, uriToToken, assets, counter, prefix);
      if (replaced !== child) {
        mapped ??= children.slice();
        mapped[index] = replaced;
      }
    }
    if (mapped !== undefined) {
      next = { ...next, children: mapped };
      changed = true;
    }
  }

  const src = next.attrs?.['src'];
  if (isInlineImageDataUri(src)) {
    let token = uriToToken.get(src);
    if (token === undefined) {
      token = `${prefix}${counter.next}__`;
      counter.next += 1;
      uriToToken.set(src, token);
      assets.push({ token, dataUri: src });
    }
    next = { ...next, attrs: { ...next.attrs, src: token } };
    changed = true;
  }

  return changed ? next : node;
}

/**
 * 收敛书档中的内联图片（data URI 去重 → 令牌）
 *
 * @example
 * const { document, assets } = dedupeInlineImages(book);
 * // assets: [{ token: '__bibliotype_asset_0__', dataUri: 'data:image/png;base64,…' }]
 */
export function dedupeInlineImages(
  document: BookDocument,
  options?: DedupeInlineImagesOptions,
): DedupeInlineImagesResult {
  const prefix = options?.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
  const uriToToken = new Map<string, string>();
  const assets: InlineImageAsset[] = [];
  const counter = { next: 0 };

  const root = document.root;
  const nextRoot = dedupeNode(root, uriToToken, assets, counter, prefix);
  return {
    document: nextRoot === root ? document : { ...document, root: nextRoot },
    assets,
  };
}

/**
 * 就地把令牌 src 还原为真实 URL
 *
 * @param node 书档节点（原地修改——操作对象应为宿主收到的私有副本）
 * @param resolve 令牌 → URL；返回 undefined 时保持原 src（未知令牌不误伤）
 */
export function rehydrateInlineImages(
  node: BookNode,
  resolve: (token: string) => string | undefined,
): void {
  const src = node.attrs?.['src'];
  if (typeof src === 'string' && src.startsWith(DEFAULT_TOKEN_PREFIX)) {
    const resolved = resolve(src);
    if (resolved !== undefined) {
      node.attrs = { ...node.attrs, src: resolved };
    }
  }
  for (const child of node.children ?? []) {
    if (!isTextNode(child)) rehydrateInlineImages(child, resolve);
  }
}
