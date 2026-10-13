/**
 * 粘贴处理插件（Markdown 纯文本 → PM 结构）
 *
 * 依赖方向：editor 内部。ProseMirror 的 `transformPastedText` 仅能改写字符串，
 * 无法注入结构化 Fragment，故改用 `handlePaste` 钩子接管纯文本粘贴，
 * 并把决策逻辑抽成纯函数 `buildPasteSlice`（无 DOM，可在 node 环境直接断言）。
 *
 * 行为约定：
 * - 剪贴板已带 HTML → 交回 ProseMirror 原生解析（由 parseDOM 规则映射）；
 * - 纯文本命中 Markdown 特征 → 经 markdown 转换层生成 Slice 落位；
 * - 其余纯文本 → 返回 null，保持 ProseMirror 默认插入行为，不做激进改写。
 */
import { Fragment, type Schema, Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { looksLikeMarkdown, markdownToFragment } from './markdown.js';

/**
 * 依据剪贴板内容构造粘贴 Slice
 *
 * @param text 剪贴板纯文本
 * @param html 剪贴板 HTML（存在则不接管，返回 null）
 * @param schema 编辑器 schema
 * @returns 需接管的 Slice；不满足接管条件时返回 null
 */
export function buildPasteSlice(
  text: string,
  html: string | null | undefined,
  schema: Schema,
): Slice | null {
  if (typeof html === 'string' && html !== '') {
    return null;
  }
  if (!looksLikeMarkdown(text)) {
    return null;
  }
  const fragment: Fragment = markdownToFragment(text, schema);
  return fragment.size > 0 ? new Slice(fragment, 0, 0) : null;
}

/** 创建粘贴增强插件（handlePaste 接管 Markdown 纯文本粘贴） */
export function createPasteMarkdownPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        const text = clipboard?.getData('text/plain') ?? '';
        const html = clipboard?.getData('text/html');
        const slice = buildPasteSlice(text, html, view.state.schema);
        if (slice === null) {
          return false; // 交回默认处理
        }
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}
