/**
 * ruby 注文识别（DOM 文本轴与模型文本轴同口径的前提）
 *
 * `html-serializer` 把 ruby 标记渲染为 `<ruby>基字<rt>注文</rt></ruby>`，其中
 * 注文（`<rt>` 注音 / `<rp>` 回退括号）是**渲染期注释**，不是模型文本——模型轴
 * 口径（`reader.collectNodeText` / `layout` 的 `nodeTextLength`）只拼文本子节点，
 * 不含 mark 的 `attrs.text`。
 *
 * 因此凡把 DOM 文本折算为「模型字符偏移」的地方都必须排除注文子树，否则 DOM
 * 字符轴会比模型轴多出注文长度，使得同一可视字符在两轴索引不同：选区 / 光标
 * 换算与行首字符偏移（`lineOffsets`）整体右移。已知使用点：
 * - `paged-editor/input-router.ts`：片段 DOM ⇄ 片段内字符偏移；
 * - `pagination-measure.ts`：实测每行起始字符偏移（供切片与选区映射）。
 */

/** 注文容器标签（小写 localName）：`<rt>` 注音 / `<rp>` 回退括号 */
const RUBY_ANNOTATION_TAGS: ReadonlySet<string> = new Set(['rt', 'rp']);

/** 元素是否为 ruby 注文容器（`<rt>` / `<rp>`） */
export function isRubyAnnotationElement(el: Element): boolean {
  return RUBY_ANNOTATION_TAGS.has(el.localName.toLowerCase());
}

/**
 * 文本节点是否位于注文子树内。
 *
 * 自文本节点向 root 上溯（不越过 root）：途中命中注文容器即为注文文本。
 * root 之外的节点一律返回 false（调用方的采集范围即 root）。
 *
 * @param node 待判定的文本节点
 * @param root 采集范围根元素（通常即遍历起点）
 */
export function isRubyAnnotationText(node: Node, root: Element): boolean {
  if (!root.contains(node)) return false;
  let parent: Node | null = node.parentNode;
  while (parent !== null && parent !== root) {
    if (parent.nodeType === 1 && isRubyAnnotationElement(parent as Element)) return true;
    parent = parent.parentNode;
  }
  return false;
}
