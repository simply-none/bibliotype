<script setup lang="ts">
/**
 * 属性检视器（Demo 层，编辑模式画布上方）
 *
 * 跟随选区（binding.version 驱动重算）展示光标祖先链节点与选区标记中
 * 「带可编辑属性」的分组，直接经 setNodeAttrs / setMarkAttrs 写回文档：
 * - 节点组：自内向外逐层（章 title、标题 level、列表 ordered、图片 src/alt 等），
 *   未声明属性（rawAttrs 兜底键，如异体字 standard）一并列出；
 * - 标记组：选区内出现的标记实例（注音 text、链接 href、圈点 style 等），
 *   空选区取光标处 storedMarks / marks；
 * - 控件按值类型推断：boolean → 勾选，number → 数字框（level 限 1~6），其余 → 文本框；
 * - 清空文本提交 null（声明属性回默认值 / 兜底键移除）。
 */
import { computed } from 'vue';
import {
  RAW_ATTRS_ATTR,
  declaredAttrNames,
  getBlockStyleId,
  setBlockStyleId,
  setMarkAttrs,
  setNodeAttrs,
} from '@bibliotype/editor';
import type { NamedStyle } from '@bibliotype/core';
import type { EditorBinding } from '@bibliotype/vue';

const props = defineProps<{
  binding: EditorBinding;
  /** 命名样式列表（Word 式具名样式；空数组则不显示选择器） */
  namedStyles?: NamedStyle[];
}>();

/** 光标所在块当前挂的命名样式 id（版本驱动重算） */
const currentStyleId = computed(() => {
  void props.binding.version.value;
  return getBlockStyleId(props.binding.editor.editorState);
});

/** 挂 / 清命名样式 */
function applyStyleId(raw: string): void {
  props.binding.execute(setBlockStyleId(raw === '' ? null : raw));
}

/** 单个可编辑属性字段 */
interface AttrField {
  /** 组内唯一键（属性名） */
  attr: string;
  /** 展示标签 */
  label: string;
  /** 控件类型 */
  kind: 'text' | 'number' | 'boolean';
  /** 当前值（null 显示为空串） */
  value: string | number | boolean;
  /** 数字下限（level 特判） */
  min?: number;
  /** 数字上限 */
  max?: number;
}

/** 一个节点 / 标记的属性分组 */
interface AttrGroup {
  /** 目标种类（决定走 setNodeAttrs 还是 setMarkAttrs） */
  kind: 'node' | 'mark';
  /** schema 类型名（命令定位用） */
  typeName: string;
  /** 分组标题（中文名） */
  title: string;
  fields: AttrField[];
}

/* ---------- 展示名映射（未命中回退原名） ---------- */

const NODE_LABELS: Readonly<Record<string, string>> = {
  book: '书籍',
  cover: '封面',
  'title-page': '扉页',
  'copyright-page': '版权页',
  'back-cover': '封底',
  volume: '卷',
  chapter: '章',
  section: '节',
  appendix: '附录',
  preface: '序言',
  postscript: '跋',
  toc: '目录',
  paragraph: '段落',
  heading: '标题',
  quote: '引用',
  list: '列表',
  'list-item': '列表项',
  image: '图片',
  caption: '题注',
  table: '表格',
  'table-row': '表格行',
  'table-cell': '单元格',
  'code-block': '代码块',
  'math-block': '公式块',
  'math-inline': '行内公式',
  break: '分页',
  footnote: '脚注',
  endnote: '尾注',
  'margin-note': '边注',
  'double-note': '双行小注',
  'inline-note': '夹注',
  'head-note': '眉批',
  'tail-note': '尾批',
  'collation-note': '校勘记',
  'collation-mark': '出校符号',
  'variant-char': '异体字',
  'taboo-char': '避讳字',
  imprint: '牌记',
  colophon: '题记',
  seal: '印章',
  'border-frame': '版框',
  'fish-tail': '鱼尾',
};

const MARK_LABELS: Readonly<Record<string, string>> = {
  emphasis: '强调',
  strong: '粗体',
  underline: '下划线',
  strikethrough: '删除线',
  code: '行内代码',
  link: '链接',
  ruby: '注音',
  highlight: '高亮',
  'proper-name': '专名号',
  'book-title': '书名号',
  'circle-emphasis': '圈点',
  'note-ref': '注引用',
  variant: '异体标记',
  taboo: '避讳标记',
};

/** 属性标签（type.attr 特优先于通用键） */
const ATTR_LABELS: Readonly<Record<string, string>> = {
  level: '级别',
  title: '标题',
  ordered: '有序',
  src: '地址',
  alt: '替代文本',
  language: '语言',
  tex: '公式',
  variant: '变体',
  symbol: '符号',
  text: '文本',
  href: '链接地址',
  style: '样式',
  noteId: '注目标',
  standard: '规范字形',
  kind: '类别',
  'ruby.text': '注文',
  'seal.text': '印文',
  'collation-mark.symbol': '符号',
};

function attrLabel(typeName: string, attr: string): string {
  return ATTR_LABELS[`${typeName}.${attr}`] ?? ATTR_LABELS[attr] ?? attr;
}

/* ---------- 选区上下文提取 ---------- */

/** 由当前值 / PM 属性推断控件类型与展示值 */
function toField(
  typeName: string,
  attr: string,
  value: unknown,
): AttrField {
  const base = { attr, label: attrLabel(typeName, attr) };
  if (typeof value === 'boolean') {
    return { ...base, kind: 'boolean', value };
  }
  if (typeof value === 'number') {
    const numeric = attr === 'level' ? { min: 1, max: 6 } : {};
    return { ...base, kind: 'number', value, ...numeric };
  }
  return { ...base, kind: 'text', value: value === null || value === undefined ? '' : String(value) };
}

/** 节点的可编辑字段（声明属性 + rawAttrs 兜底键） */
function nodeFields(node: { type: { name: string; spec: { attrs?: Record<string, unknown> } }; attrs: Record<string, unknown> }): AttrField[] {
  const typeName = node.type.name;
  const fields: AttrField[] = [];
  for (const name of declaredAttrNames(node.type.spec.attrs)) {
    fields.push(toField(typeName, name, node.attrs[name]));
  }
  const raw = node.attrs[RAW_ATTRS_ATTR];
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      fields.push(toField(typeName, key, value));
    }
  }
  return fields;
}

const groups = computed<AttrGroup[]>(() => {
  // 版本驱动：每次事务（含选区移动）后重算
  void props.binding.version.value;
  const state = props.binding.editor.editorState;
  const result: AttrGroup[] = [];

  /* 祖先链节点（自内向外） */
  const { $from, empty, from, to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const fields = nodeFields(node);
    if (fields.length > 0) {
      result.push({
        kind: 'node',
        typeName: node.type.name,
        title: NODE_LABELS[node.type.name] ?? node.type.name,
        fields,
      });
    }
  }

  /* 选区 / 光标处标记实例（按类型去重） */
  const seen = new Set<string>();
  const marks: Array<{ name: string; spec: { attrs?: Record<string, unknown> }; attrs: Record<string, unknown> }> = [];
  if (empty) {
    const stored = state.storedMarks ?? $from.marks();
    for (const mark of stored) {
      if (!seen.has(mark.type.name)) {
        seen.add(mark.type.name);
        marks.push({ name: mark.type.name, spec: mark.type.spec, attrs: mark.attrs });
      }
    }
  } else {
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return true;
      for (const mark of node.marks) {
        if (!seen.has(mark.type.name)) {
          seen.add(mark.type.name);
          marks.push({ name: mark.type.name, spec: mark.type.spec, attrs: mark.attrs });
        }
      }
      return false;
    });
  }
  for (const mark of marks) {
    const fields: AttrField[] = [];
    for (const name of declaredAttrNames(mark.spec.attrs)) {
      fields.push(toField(mark.name, name, mark.attrs[name]));
    }
    const raw = mark.attrs[RAW_ATTRS_ATTR];
    if (typeof raw === 'object' && raw !== null) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        fields.push(toField(mark.name, key, value));
      }
    }
    if (fields.length > 0) {
      result.push({
        kind: 'mark',
        typeName: mark.name,
        title: MARK_LABELS[mark.name] ?? mark.name,
        fields,
      });
    }
  }

  return result;
});

/* ---------- 写回 ---------- */

function commit(group: AttrGroup, field: AttrField, raw: string | boolean): void {
  let value: unknown;
  if (field.kind === 'boolean') {
    value = raw;
  } else if (raw === '') {
    value = null;
  } else if (field.kind === 'number') {
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed)) return;
    value = field.min !== undefined ? Math.min(field.max ?? parsed, Math.max(field.min, parsed)) : parsed;
  } else {
    value = String(raw);
  }
  const patch: Record<string, unknown> = { [field.attr]: value };
  const command =
    group.kind === 'node' ? setNodeAttrs(group.typeName, patch) : setMarkAttrs(group.typeName, patch);
  props.binding.execute(command);
}
</script>

<template>
  <section class="inspector">
    <span class="inspector__title">属性</span>
    <label v-if="namedStyles !== undefined && namedStyles.length > 0" class="inspector__field">
      <span class="inspector__label">命名样式</span>
      <select
        class="inspector__input"
        :value="currentStyleId ?? ''"
        @change="applyStyleId(($event.target as HTMLSelectElement).value)"
      >
        <option value="">（无）</option>
        <option v-for="style in namedStyles" :key="style.id" :value="style.id">
          {{ style.name }}
        </option>
      </select>
    </label>
    <template v-if="groups.length > 0">
      <div v-for="group in groups" :key="`${group.kind}-${group.typeName}`" class="inspector__group">
        <span class="inspector__tag">{{ group.title }}</span>
        <label v-for="field in group.fields" :key="field.attr" class="inspector__field">
          <span class="inspector__label">{{ field.label }}</span>
          <input
            v-if="field.kind === 'boolean'"
            type="checkbox"
            :checked="field.value === true"
            @change="commit(group, field, ($event.target as HTMLInputElement).checked)"
          />
          <input
            v-else
            class="inspector__input"
            :class="{ 'inspector__input--num': field.kind === 'number' }"
            :type="field.kind === 'number' ? 'number' : 'text'"
            :min="field.min"
            :max="field.max"
            :value="field.value"
            @change="commit(group, field, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </template>
    <span v-else class="inspector__empty">当前选区与光标祖先均无可编辑属性</span>
  </section>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 6px 10px;
  margin-top: 8px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  background: var(--demo-panel);
  color: var(--demo-text);
  font-size: 12px;
}

.inspector__title {
  color: var(--demo-muted);
  letter-spacing: 0.08em;
}

.inspector__group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline-end: 12px;
  border-inline-end: 1px dashed var(--demo-border);
}

.inspector__group:last-child {
  border-inline-end: none;
  padding-inline-end: 0;
}

.inspector__tag {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--demo-accent);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
}

.inspector__field {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.inspector__label {
  color: var(--demo-muted);
}

.inspector__input {
  width: 110px;
  padding: 3px 6px;
  font-size: 12px;
  color: var(--demo-text);
  background: var(--demo-control);
  border: 1px solid var(--demo-control-border);
  border-radius: 4px;
}

.inspector__input--num {
  width: 64px;
}

.inspector__empty {
  color: var(--demo-muted);
}
</style>
