/**
 * 编辑桥（useEditorBinding）与编辑画布（BtEditor）测试
 *
 * 覆盖：EditorView 挂载 / 卸载、命令执行与版本自增、标记激活态、
 * undo / redo 可用性、组件挂载与插槽 binding 透传。
 */
import { describe, expect, it, vi } from 'vitest';
import { effectScope, h } from 'vue';
import { mount } from '@vue/test-utils';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import {
  BookEditor,
  buildEditorSchema,
  createBookEditorPlugins,
  insertTable,
  toggleMarkOfType,
} from '@bibliotype/editor';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
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

  it('syncView 返回 false：命令更新模型与版本但跳过视图同步（paged 防隐藏视图乱滚）', () => {
    const editor = createEditor();
    let paged = true;
    const binding = useEditorBinding(editor, { syncView: () => !paged });
    const container = createContainer();
    binding.attach(container);
    const view = binding.view.value;
    expect(view).toBeInstanceOf(EditorView);

    const { from, to } = firstTextRange(editor);
    setSelection(editor, from, to - from);
    const strong = editor.bookSchema.marks[MARK_TYPES.STRONG];
    expect(strong).toBeDefined();

    // paged（syncView=false）：模型已加粗，但隐藏视图不重建（无 updateState → 无 scrollIntoView 乱滚）
    paged = true;
    expect(binding.execute(toggleMarkOfType(strong!))).toBe(true);
    expect(editor.editorState.doc.rangeHasMark(from, to, strong!)).toBe(true);
    expect(view!.state.doc.rangeHasMark(from, to, strong!)).toBe(false);

    // 非 paged（syncView=true）：命令走完整视图同步 → 视图与模型一致
    paged = false;
    const range = firstTextRange(editor);
    setSelection(editor, range.from, 0);
    binding.execute((state, dispatch) => {
      dispatch?.(state.tr.insertText('X'));
      return true;
    });
    expect(view!.state.doc.textContent).toContain('X');

    binding.detach();
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

  it('goToNode：按 id / 树路径解析节点并设选区，未命中返回 null', () => {
    const editor = createEditor();
    const binding = useEditorBinding(editor);
    const container = createContainer();
    binding.attach(container);

    // 真实 id 命中：返回 PM 位置，且选区落在该章节点上
    const pos = binding.goToNode('chap-1');
    expect(pos).not.toBeNull();
    expect(editor.editorState.doc.nodeAt(pos!)).not.toBeNull();
    expect(editor.editorState.doc.nodeAt(pos!)!.type.name).toBe(NODE_TYPES.CHAPTER);

    // 树路径（导入文档回退口径）：/0 = 根下首个元素子节点（章），落在章内
    const pathPos = binding.goToNode('/0');
    expect(pathPos).not.toBeNull();
    expect(editor.editorState.doc.resolve(pathPos!).node(1).type.name).toBe(NODE_TYPES.CHAPTER);

    // 未命中：返回 null，且不改动文档
    const before = editor.editorState.doc;
    expect(binding.goToNode('不存在的节点')).toBeNull();
    expect(editor.editorState.doc).toBe(before);

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

  it('选定开本驱动页面盒尺寸变量（--bt-page-w / --bt-page-h）', () => {
    const editor = createEditor();
    const wrapper = mount(BtEditor, {
      props: {
        editor,
        options: {
          ...DEFAULT_LAYOUT_OPTIONS,
          pageSize: { name: 'A4', width: 794, height: 1123 },
        },
      },
    });

    const style = wrapper.find('.bt-editor__canvas').attributes('style') ?? '';
    expect(style).toContain('--bt-page-w: 794px');
    expect(style).toContain('--bt-page-h: 1123px');

    wrapper.unmount();
  });

  it('pagination 开关控制分页渲染（缺省连续画布，不分页）', () => {
    const editor = createEditor();
    const plain = mount(BtEditor, { props: { editor } });
    expect(plain.find('.bt-paged').exists()).toBe(false);
    expect(plain.find('.bt-editor__canvas').exists()).toBe(true);
    plain.unmount();

    // 旧「叠层纸张」形态已删除：不再产出 .bt-editor__overlay
    const paginated = mount(BtEditor, { props: { editor, pagination: true } });
    expect(paginated.find('.bt-editor__overlay').exists()).toBe(false);
    paginated.unmount();
  });

  it('pagination 开启：去抖重排后渲染真实书页（paged 缺省模式）', async () => {
    vi.useFakeTimers();
    const editor = createEditor();
    const wrapper = mount(BtEditor, { props: { editor, pagination: true } });
    // usePagedLayout：120ms 去抖 → relayout（happy-dom 估算回退仍产页）→ pagedActive
    await vi.advanceTimersByTimeAsync(150);
    vi.useRealTimers();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.bt-paged').exists()).toBe(true);
    expect(wrapper.findAll('.bt-paged-page').length).toBeGreaterThanOrEqual(1);
    // 片段格存在且携块定位
    const frag = wrapper.find('.bt-paged-frag');
    expect(frag.exists()).toBe(true);
    expect(frag.attributes('data-block-id')).toBeTruthy();
    wrapper.unmount();
  });

  it('loading 开启：首次分页就绪前显示遮罩，就绪后消失；缺省不显示', async () => {
    vi.useFakeTimers();
    const editor = createEditor();
    const wrapper = mount(BtEditor, { props: { editor, pagination: true, loading: true } });
    // 去抖未触发前：首轮重排未产出 → loading 遮罩覆盖，不暴露未分页内容
    expect(wrapper.find('.bt-editor__loading').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(150);
    vi.useRealTimers();
    await wrapper.vm.$nextTick();

    // 首轮产出后遮罩消失，书页已就绪
    expect(wrapper.find('.bt-editor__loading').exists()).toBe(false);
    expect(wrapper.find('.bt-paged').exists()).toBe(true);
    wrapper.unmount();

    // 缺省（未传 loading）维持现行为：无遮罩
    vi.useFakeTimers();
    const plain = mount(BtEditor, { props: { editor: createEditor(), pagination: true } });
    expect(plain.find('.bt-editor__loading').exists()).toBe(false);
    plain.unmount();
    vi.useRealTimers();
  });

  it('插入表格后画布渲染真实 table / tr / td（不是嵌套 div）', async () => {
    const editor = createEditor();
    // 走插槽 binding.execute（与工具条同一路径）：它会在派发后同步 PM 视图
    let binding: EditorBinding | undefined;
    const wrapper = mount(BtEditor, {
      props: { editor },
      slots: {
        default: (slotProps: Record<string, unknown>) => {
          binding = slotProps as unknown as EditorBinding;
          return h('span');
        },
      },
    });
    const { from } = firstTextRange(editor);
    setSelection(editor, from, 0);
    expect(binding?.execute(insertTable(2, 2))).toBe(true);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.ProseMirror table.bt-table').exists()).toBe(true);
    expect(wrapper.findAll('.ProseMirror tr.bt-table-row')).toHaveLength(2);
    expect(wrapper.findAll('.ProseMirror td.bt-table-cell')).toHaveLength(4);
    wrapper.unmount();
  });
});
