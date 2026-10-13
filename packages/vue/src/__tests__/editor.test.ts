/**
 * 编辑桥（useEditorBinding）与编辑画布（BtEditor）测试
 *
 * 覆盖：EditorView 挂载 / 卸载、命令执行与版本自增、标记激活态、
 * undo / redo 可用性、组件挂载与插槽 binding 透传。
 */
import { describe, expect, it } from 'vitest';
import { effectScope, h } from 'vue';
import { mount } from '@vue/test-utils';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import {
  BookEditor,
  buildEditorSchema,
  createBookEditorPlugins,
  toggleMarkOfType,
} from '@bibliotype/editor';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import BtEditor from '../components/BtEditor.vue';
import { useEditorBinding, type EditorBinding } from '../use-editor.js';

/** 构造样本文档：章 > 段落 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '子曰学而时习之' }],
        },
      ],
    },
  ];
  return doc;
}

/** 创建编辑器（withPlugins 时携带 history + keymap） */
function createEditor(withPlugins = false): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    document: sampleDoc(),
    ...(withPlugins ? { plugins: createBookEditorPlugins(schema) } : {}),
  });
}

/** 首个文本节点的区间（from 含、to 不含） */
function firstTextRange(editor: BookEditor): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  editor.editorState.doc.descendants((node, pos) => {
    if (range === null && node.isText) {
      range = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (range === null) {
    throw new Error('文档中没有文本节点');
  }
  return range;
}

/** 设置选区（length 为 0 即光标） */
function setSelection(editor: BookEditor, from: number, length: number): void {
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, from + length)));
}

/** 创建挂载容器 */
function createContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

describe('useEditorBinding', () => {
  it('attach 创建 EditorView 并渲染文档，scope 销毁自动 detach', () => {
    const editor = createEditor();
    const scope = effectScope();
    const binding = scope.run(() => useEditorBinding(editor));
    expect(binding).toBeDefined();

    const container = createContainer();
    binding!.attach(container);
    expect(binding!.view.value).toBeInstanceOf(EditorView);
    expect(container.querySelector('.ProseMirror')).not.toBeNull();
    expect(container.textContent).toContain('子曰学而时习之');

    scope.stop();
    expect(binding!.view.value).toBeNull();
  });

  it('execute：命令派发、版本自增与标记激活态', () => {
    const editor = createEditor();
    const binding = useEditorBinding(editor);
    const container = createContainer();
    binding.attach(container);
    const versionBefore = binding.version.value;

    const { from, to } = firstTextRange(editor);
    setSelection(editor, from, to - from);

    const strong = editor.bookSchema.marks[MARK_TYPES.STRONG];
    expect(strong).toBeDefined();
    expect(binding.execute(toggleMarkOfType(strong!))).toBe(true);
    expect(binding.version.value).toBeGreaterThan(versionBefore);
    expect(binding.isMarkActive(MARK_TYPES.STRONG)).toBe(true);
    expect(binding.isMarkActive(MARK_TYPES.EMPHASIS)).toBe(false);

    binding.detach();
    expect(binding.view.value).toBeNull();
  });

  it('undo / redo：历史可用性与文档回退', () => {
    const editor = createEditor(true);
    const binding = useEditorBinding(editor);
    const container = createContainer();
    binding.attach(container);

    const { from } = firstTextRange(editor);
    setSelection(editor, from, 0);
    expect(
      binding.execute((state, dispatch) => {
        dispatch?.(state.tr.insertText('注'));
        return true;
      }),
    ).toBe(true);
    expect(editor.editorState.doc.textContent).toContain('注子');

    expect(binding.canUndo()).toBe(true);
    expect(binding.canRedo()).toBe(false);
    expect(binding.undo()).toBe(true);
    expect(binding.canRedo()).toBe(true);
    expect(binding.redo()).toBe(true);
    expect(editor.editorState.doc.textContent).toContain('注子');

    binding.detach();
  });
});

describe('BtEditor', () => {
  it('挂载后渲染编辑画布并通过插槽透传 binding', () => {
    const editor = createEditor();
    let captured: EditorBinding | undefined;
    const wrapper = mount(BtEditor, {
      props: { editor },
      slots: {
        default: (slotProps: Record<string, unknown>) => {
          captured = slotProps as unknown as EditorBinding;
          // 透传的 editor 保持原始实例（useEditorBinding 已 markRaw，防响应式深代理）
          return h('span', { class: 'binding-probe' }, String(slotProps.editor === editor));
        },
      },
    });

    expect(wrapper.find('.bt-editor__canvas').exists()).toBe(true);
    expect(wrapper.find('.ProseMirror').exists()).toBe(true);
    expect(wrapper.find('.bt-editor__toolbar').exists()).toBe(true);
    expect(wrapper.find('.binding-probe').text()).toBe('true');

    // 插槽 binding 具备工具条所需能力（视图、版本与命令接口）
    expect(captured?.view.value).toBeInstanceOf(EditorView);
    expect(captured?.version.value).toBeGreaterThan(0);
    expect(captured?.isMarkActive(MARK_TYPES.STRONG)).toBe(false);

    wrapper.unmount();
  });

  it('注入与阅读同源的书册样式表（容器限定在编辑画布，卸载时移除）', () => {
    const editor = createEditor();
    const wrapper = mount(BtEditor, { props: { editor } });

    const styleElement = document.getElementById('bt-editor-book-css');
    expect(styleElement).not.toBeNull();
    expect(styleElement!.textContent).toContain('.bt-editor__canvas .ProseMirror');
    expect(styleElement!.textContent).toContain('.bt-paragraph');

    wrapper.unmount();
    expect(document.getElementById('bt-editor-book-css')).toBeNull();
  });
});
