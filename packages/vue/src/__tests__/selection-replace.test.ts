/**
 * 选区「替换为」浮动菜单测试
 *
 * - placeFloating：上/下翻转、水平夹紧、视口边界；
 * - BtSelectionReplaceMenu：非空选区显示、标题/分组、点击执行并关闭、
 *   禁用态、Esc 关闭、只读不显示。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick, ref, shallowRef } from 'vue';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import { BookEditor, buildEditorSchema, setParagraph } from '@bibliotype/editor';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import BtSelectionReplaceMenu from '../components/BtSelectionReplaceMenu.vue';
import { placeFloating } from '../floating-position.js';
import type { EditorBinding } from '../use-editor.js';
import type { ReplaceTargetGroup } from '../use-selection-replace.js';

/** 简易 binding：view 用桩对象，coordsAtPos 提供固定坐标 */
function makeBinding(): { binding: EditorBinding; editor: BookEditor } {
  const doc = createEmptyDocument({ title: 't' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'c-1',
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '甲乙丙丁' }],
        },
      ],
    },
  ];
  const schema = buildEditorSchema();
  const editor = new BookEditor({ schema, document: doc });

  const dom = document.createElement('div');
  dom.className = 'bt-editor';
  document.body.appendChild(dom);

  const view = {
    dom,
    coordsAtPos: () => ({ top: 120, left: 160, bottom: 140, right: 161 }),
  };

  const execute = (command: Command): boolean =>
    command(editor.editorState, (tr) => editor.dispatch(tr));

  const binding = {
    editor,
    view: shallowRef(view),
    version: ref(0),
    attach: vi.fn(),
    detach: vi.fn(),
    isMarkActive: () => false,
    isNodeActive: () => false,
    canUndo: () => false,
    canRedo: () => false,
    execute,
    undo: () => false,
    redo: () => false,
    refresh: vi.fn(),
    goToNode: () => null,
  } as unknown as EditorBinding;

  return { binding, editor };
}

/** 选中首个文本节点全部内容 */
function selectFirstText(editor: BookEditor): void {
  // 用对象属性承载查找结果：避免 TS 把闭包内赋值的局部变量窄化为 never
  const found: { range: { from: number; to: number } | null } = { range: null };
  editor.editorState.doc.descendants((node, pos) => {
    if (found.range === null && node.isText) {
      found.range = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (found.range === null) {
    throw new Error('文档中没有文本节点');
  }
  const state = editor.editorState;
  editor.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, found.range.from, found.range.to)),
  );
}

/** 推进去抖计时器并等待渲染 */
async function flushMenu(): Promise<void> {
  vi.advanceTimersByTime(150);
  await nextTick();
  await nextTick();
  await nextTick();
}

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('placeFloating', () => {
  it('默认显示在选区上方并水平居中', () => {
    const placement = placeFloating(
      { top: 200, left: 100, width: 100, height: 20 },
      { width: 200, height: 60 },
      { width: 1000, height: 800 },
    );
    expect(placement.placement).toBe('top');
    expect(placement.top).toBe(132); // 200 - 8 - 60
    expect(placement.left).toBe(50); // 100 + 50 - 100
  });

  it('上方空间不足时翻到下方', () => {
    const placement = placeFloating(
      { top: 10, left: 100, width: 100, height: 20 },
      { width: 200, height: 60 },
      { width: 1000, height: 800 },
    );
    expect(placement.placement).toBe('bottom');
    expect(placement.top).toBe(38); // 10 + 20 + 8
  });

  it('水平方向夹紧到视口安全边距内', () => {
    const leftEdge = placeFloating(
      { top: 300, left: 0, width: 10, height: 20 },
      { width: 300, height: 60 },
      { width: 1000, height: 800 },
    );
    expect(leftEdge.left).toBe(8);

    const rightEdge = placeFloating(
      { top: 300, left: 990, width: 5, height: 20 },
      { width: 300, height: 60 },
      { width: 1000, height: 800 },
    );
    expect(rightEdge.left).toBe(692); // 1000 - 300 - 8
  });

  it('两侧都放不下时垂直方向也夹紧', () => {
    const placement = placeFloating(
      { top: 400, left: 100, width: 100, height: 20 },
      { width: 200, height: 900 },
      { width: 1000, height: 800 },
    );
    expect(placement.top).toBe(8);
  });
});

describe('BtSelectionReplaceMenu', () => {
  it('非空选区去抖后显示，标题为「替换为」，点击目标执行命令并关闭', async () => {
    vi.useFakeTimers();
    const { binding, editor } = makeBinding();
    selectFirstText(editor);
    binding.version.value += 1;

    const command = vi.fn(() => setParagraph());
    const groups: ReplaceTargetGroup[] = [
      { key: 'block', label: '块类型', items: [{ key: 'paragraph', label: '正文', command }] },
    ];

    wrapper = mount(BtSelectionReplaceMenu, {
      props: { binding, groups },
      attachTo: document.body,
    });
    await flushMenu();

    const menu = document.body.querySelector('.bt-replace-menu');
    expect(menu).not.toBeNull();
    expect(menu?.querySelector('.bt-replace-menu__title')?.textContent?.trim()).toBe('替换为');
    expect(menu?.querySelector('.bt-replace-menu__label')?.textContent?.trim()).toBe('块类型');

    const button = menu?.querySelector('.bt-replace-menu__item') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('正文');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(command).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.bt-replace-menu')).toBeNull();
  });

  it('禁用项渲染为 disabled，点击不执行', async () => {
    vi.useFakeTimers();
    const { binding, editor } = makeBinding();
    selectFirstText(editor);
    binding.version.value += 1;

    const command = vi.fn(() => setParagraph());
    const groups: ReplaceTargetGroup[] = [
      {
        key: 'g',
        label: '分组',
        items: [{ key: 'x', label: '不可用', command, disabled: () => true }],
      },
    ];

    wrapper = mount(BtSelectionReplaceMenu, {
      props: { binding, groups },
      attachTo: document.body,
    });
    await flushMenu();

    const button = document.body.querySelector('.bt-replace-menu__item') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // 原生 disabled 按钮不会触发 click 回调；命令不得执行
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(command).not.toHaveBeenCalled();
  });

  it('Esc 关闭菜单', async () => {
    vi.useFakeTimers();
    const { binding, editor } = makeBinding();
    selectFirstText(editor);
    binding.version.value += 1;

    const groups: ReplaceTargetGroup[] = [
      { key: 'g', label: '分组', items: [{ key: 'x', label: '正文', command: () => setParagraph() }] },
    ];

    wrapper = mount(BtSelectionReplaceMenu, {
      props: { binding, groups },
      attachTo: document.body,
    });
    await flushMenu();
    expect(document.body.querySelector('.bt-replace-menu')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(document.body.querySelector('.bt-replace-menu')).toBeNull();
  });

  it('只读时不显示', async () => {
    vi.useFakeTimers();
    const { binding, editor } = makeBinding();
    selectFirstText(editor);
    binding.version.value += 1;

    const groups: ReplaceTargetGroup[] = [
      { key: 'g', label: '分组', items: [{ key: 'x', label: '正文', command: () => setParagraph() }] },
    ];

    wrapper = mount(BtSelectionReplaceMenu, {
      props: { binding, groups, readonly: true },
      attachTo: document.body,
    });
    await flushMenu();

    expect(document.body.querySelector('.bt-replace-menu')).toBeNull();
  });

  it('空选区不显示', async () => {
    vi.useFakeTimers();
    const { binding, editor } = makeBinding();
    // 不设选区，仅触发版本变化
    binding.version.value += 1;

    const groups: ReplaceTargetGroup[] = [
      { key: 'g', label: '分组', items: [{ key: 'x', label: '正文', command: () => setParagraph() }] },
    ];

    wrapper = mount(BtSelectionReplaceMenu, {
      props: { binding, groups },
      attachTo: document.body,
    });
    await flushMenu();

    expect(document.body.querySelector('.bt-replace-menu')).toBeNull();
  });
});
