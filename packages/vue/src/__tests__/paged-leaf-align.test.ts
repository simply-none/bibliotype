/**
 * 分页块索引对齐回归测试（容器型叶块 contentStart 定位）
 *
 * 背景：TEXT_CONTAINER 叶块（脚注 / 尾注 / 边注 / 双行注…，schema 均为 `content: 'block+'`）
 * 在 extractBlocks 中整体成块、不下钻，collectPmLeafPositions 同样只取容器自身位置。
 * 若 buildPagedIndex 直接把 contentStart 记为 `docStart + 1`，该位置落在「容器开 ↔ 首个内层段落」
 * 之间，其 `$pos.parent` 是容器（块内容，非 inline），既不是合法文本光标位，也不等于可见片段
 * 的首字符——分页编辑态下注文 / 双行注「点很多次进不去、打不进字、命令落空」即源于此。
 *
 * 本测试以真实 BookEditor（含脚注容器与引用块）断言：每个 IR 块映射到的 contentStart 必须
 * ① 落在 inline 文本位（parent.inlineContent === true）；② 其后块内文本与 IR 块文本一致。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { BookEditor, buildEditorSchema } from '@bibliotype/editor';
import { collectNodeText, extractBlocks, findNodeById } from '@bibliotype/reader';
import { collectPmLeafPositions } from '../paged-editor/use-paged-layout.js';
import { buildPagedIndex } from '../paged-editor/selection-bridge.js';

function para(id: string, text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: 'text', text }] };
}

/** 含结构容器 + 段落 + 脚注（block+ 容器）+ 引用（block+ 复合块）的代表文档 */
function docWithContainerLeaves(): BookDocument {
  const doc = createEmptyDocument({ title: '对齐测试' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      children: [
        { type: NODE_TYPES.HEADING, id: 'h-1', children: [{ type: 'text', text: '第一章' }] },
        para('p-1', '子曰学而时习之'),
        {
          type: NODE_TYPES.FOOTNOTE,
          id: 'fn-1',
          children: [para('fn-1-p', '脚注注文内容')],
        },
        {
          type: NODE_TYPES.QUOTE,
          id: 'q-1',
          children: [para('q-1-p', '引用内的段落')],
        },
        para('p-2', '不亦说乎'),
      ],
    },
  ];
  return doc;
}

describe('分页块索引：容器型叶块 contentStart 定位', () => {
  const editor = new BookEditor({
    schema: buildEditorSchema(),
    document: docWithContainerLeaves(),
  });
  const pmDoc = editor.editorState.doc;
  const blocks = extractBlocks(editor.getDocument(), {});
  const index = buildPagedIndex(blocks, collectPmLeafPositions(pmDoc), new Map());

  it('IR 块序列含脚注整体成块（不下钻其内段落）', () => {
    const ids = blocks.map((b) => b.id);
    expect(ids).toContain('fn-1');
    expect(ids).not.toContain('fn-1-p');
    // 引用为复合块：自身不成块，内层段落成块
    expect(ids).not.toContain('q-1');
    expect(ids).toContain('q-1-p');
  });

  it('每个块 contentStart 均落在合法 inline 文本位', () => {
    for (const block of blocks) {
      const loc = index.byId.get(block.id);
      expect(loc, `块 ${block.id} 未入索引`).toBeDefined();
      if (loc === undefined) continue;
      const $pos = pmDoc.resolve(loc.contentStart);
      expect(
        $pos.parent.inlineContent,
        `块 ${block.id} 的 contentStart(${loc.contentStart}) 落在非 inline 位置（parent=${$pos.parent.type.name}）`,
      ).toBe(true);
    }
  });

  it('每个块 contentStart 起读取的 PM 文本与 IR 块文本一致', () => {
    for (const block of blocks) {
      const loc = index.byId.get(block.id);
      if (loc === undefined) continue;
      const irText = (() => {
        const node = findNodeById(editor.getDocument().root, block.id);
        return node === null || node === undefined ? '' : collectNodeText(node);
      })();
      const pmText = pmDoc.textBetween(
        loc.contentStart,
        loc.contentStart + irText.length,
        '',
        '',
      );
      expect(pmText, `块 ${block.id} contentStart 起文本不匹配 IR`).toBe(irText);
    }
  });

  it('脚注块可成功落选区（TextSelection 命中其内段落文本）', () => {
    const loc = index.byId.get('fn-1');
    expect(loc).toBeDefined();
    if (loc === undefined) return;
    const $pos = pmDoc.resolve(loc.contentStart);
    expect($pos.parent.type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect($pos.parent.inlineContent).toBe(true);
  });
});
