<script setup lang="ts">
/**
 * 编辑工具条（Demo 层）
 *
 * 接收 BtEditor 作用域插槽透传的 EditorBinding（binding）：
 * 撤销 / 重做｜正文与标题级别｜引用 / 无序 / 有序列表｜粗 / 斜 / 下划线 / 高亮 /
 * 删除线 / 行内代码 / 链接 / 注音｜专名号 / 书名号 / 圈点 / 异体 / 注Ref / 避讳 /
 * 夹注 / 异体载体 / 避讳载体｜插入双行注 / 眉批 / 校勘记 / 出校符号 / 跋文 / 牌记 /
 * 题记 / 版框 / 鱼尾 / 印章 / 图片 / 表格 / 脚注 / 尾注 / 边注｜下一页｜还原样册。
 * 激活态由 binding.version 驱动（每次事务后重算 isMarkActive / isNodeActive）。
 *
 * ## 使用说明的落点分工（勿重复也勿遗漏）
 *
 * - **插件包**（`@bibliotype/editor` commands.ts、`@bibliotype/classical/editor`
 *   editor-commands.ts）承载「命令契约」：前置条件、生效落点、返回 false 的原因、
 *   attrs 结构。那是跨 UI 复用的权威口径，改命令语义必须同步那里。
 * - **本组件**承载「交互说明」：每个入口的 `usage` 字段（可插拔）——点了做什么、
 *   需要什么选区、快捷键、插入后去右侧属性栏补什么、为什么点了没反应。
 *   这些是 demo 的交互决策（如印章走 prompt 录入），不属于插件包 API。
 * - 呈现方式是**鼠标悬浮卡片**（`ToolbarUsageTip`，Vue 组件），不用原生 `title`：
 *   原生提示延迟约 1s、长文案被截断，也装不下「前提 / 落点 / 属性 / 限制」四类信息。
 * - `usage` 传了才有悬浮说明，没传则整块跳过 —— 工具条抽成公共组件后，
 *   由使用方决定是否带说明体系。
 * - 全量表格另见 `docs/19-editor-toolbar-usage.md`（不读代码时的速查页）。
 *
 * 行内标记的通用前提：`toggleMark` 在空光标下写 storedMarks（下次输入继承），
 * 因此「B / I / U / 高亮 / 注音 / 古籍标记」空光标可用；而删除线、行内代码显式传
 * `requireSelection=true`，空光标不执行（避免误清空待输入标记）。
 */
import { computed, ref } from 'vue';
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import type { EditorBinding } from '@bibliotype/vue';
import {
  insertBlockOfType,
  insertImage,
  insertPageBreak,
  insertTable,
  redoCommand,
  setHeadingLevel,
  setLink,
  setParagraph,
  toggleBulletList,
  toggleMarkByName,
  toggleMarkOfType,
  toggleOrderedList,
  toggleQuote,
  undoCommand,
  unsetLink,
} from '@bibliotype/editor';
import { CLASSICAL_MARK_TYPES } from '@bibliotype/classical';
import {
  insertBorderFrame,
  insertCollationNote,
  insertCollationSymbol,
  insertColophon,
  insertDoubleNote,
  insertFishTail,
  insertHeadNote,
  insertImprint,
  insertSeal,
  insertTailNote,
  toggleBookTitle,
  toggleCircleEmphasis,
  toggleInlineNote,
  toggleNoteRef,
  toggleProperName,
  toggleTaboo,
  toggleTabooChar,
  toggleVariant,
  toggleVariantChar,
} from '@bibliotype/classical/editor';
import ReplacePanel from './ReplacePanel.vue';
import ToolbarUsageTip from './ToolbarUsageTip.vue';
import type { ToolbarUsage } from './toolbar-usage.js';

const props = defineProps<{ binding: EditorBinding; readonly?: boolean }>();
const emit = defineEmits<{ reset: []; 'toggle-readonly': [] }>();

/** 查找替换面板开关（仅编辑态工具条内部状态） */
const searchOpen = ref(false);

/** 只读：禁用全部写操作命令（保留面板展开 / 只读切换自身） */
const isReadonly = computed(() => props.readonly === true);

/** 编辑命令（editor / classical 命令工厂的产物） */
type EditorCommand = ReturnType<typeof setParagraph>;

/** 工具条按钮描述 */
interface ToolbarAction {
  /** 按钮文字 */
  label: string;
  /** 点击执行 */
  run: () => void;
  /** 激活态（缺省不判定） */
  active?: () => boolean;
  /** 禁用态（缺省不禁用） */
  disabled?: () => boolean;
  /** 悬停提示（短：快捷键 + 关键前提） */
  title?: string;
  /**
   * 使用说明（可插拔）
   *
   * 传入即表示「该入口需要向用户解释」，工具条据此渲染「功能说明」面板。
   * 不传则该入口不出现在面板里（面板无任何内容时入口按钮本身也不渲染）。
   * 字段含义见 `toolbar-usage.ts`；语义口径以插件包命令的 JSDoc 为准。
   */
  usage?: ToolbarUsage;
}

/** 执行命令（未生效时静默） */
function execute(command: EditorCommand): void {
  void props.binding.execute(command);
}

/** 行内标记切换（未注册的标记类型不可用） */
function toggleMark(name: string): void {
  const markType = props.binding.editor.bookSchema.marks[name];
  if (markType !== undefined) {
    execute(toggleMarkOfType(markType));
  }
}

/** 标记激活态 */
function markOn(name: string): boolean {
  return props.binding.isMarkActive(name);
}

/** 节点激活态（可按属性过滤，如 heading 的 level） */
function nodeOn(name: string, attrs?: Record<string, unknown>): boolean {
  return props.binding.isNodeActive(name, attrs);
}

/**
 * 撤销 / 重做（可用性随历史深度联动）
 *
 * 快捷键由插件包 keymap 统一绑定（`createBookEditorKeymap`），工具条只是入口；
 * 两个命令都带 `addToHistory` 默认值，因此自身也会进入历史栈。
 */
const historyActions: readonly ToolbarAction[] = [
  {
    label: '撤销',
    run: () => execute(undoCommand),
    disabled: () => !props.binding.canUndo(),
    title: '撤销（Mod-Z）',
    usage: {
      use: '回退最近一次编辑事务（命令与键入一视同仁）',
      where: '就地生效，选区回到事务前位置',
      key: 'Mod-Z',
      limit: '无历史时按钮置灰（canUndo 为 false）',
    },
  },
  {
    label: '重做',
    run: () => execute(redoCommand),
    disabled: () => !props.binding.canRedo(),
    title: '重做（Shift-Mod-Z）',
    usage: {
      use: '重新应用被撤销的事务',
      where: '就地生效',
      key: 'Shift-Mod-Z / Mod-Y',
      limit: '撤销后一旦继续编辑，重做栈即被清空',
    },
  },
];

/**
 * 段落级别与块形态
 *
 * 这三类（标题 / 引用 / 列表）都是「块级改写」，作用于光标所在块；跨块选区会逐块处理。
 * 块的 `id` 由 `setBlockTypeKeepingId` 显式保留（原生 setBlockType 会清空，见包层注释）。
 */
const blockActions: readonly ToolbarAction[] = [
  {
    label: '正文',
    run: () => execute(setParagraph()),
    active: () => nodeOn(NODE_TYPES.PARAGRAPH),
    usage: {
      use: '把当前文本块转为正文段落（如标题 → 正文）',
      where: '块类型替换，块 id 与内容保留',
      key: 'Mod-Alt-0',
      limit: '只改块类型，不清除行内标记（粗体等仍在）',
    },
  },
  {
    label: 'H1',
    run: () => execute(setHeadingLevel(1)),
    active: () => nodeOn(NODE_TYPES.HEADING, { level: 1 }),
    usage: {
      use: '把当前块转为一级标题',
      where: '块类型替换，块 id 与内容保留',
      key: 'Mod-Alt-1',
      limit: '命令支持 1~6 级，工具条只暴露 1~3',
    },
  },
  {
    label: 'H2',
    run: () => execute(setHeadingLevel(2)),
    active: () => nodeOn(NODE_TYPES.HEADING, { level: 2 }),
    usage: {
      use: '把当前块转为二级标题',
      where: '块类型替换，块 id 与内容保留',
      key: 'Mod-Alt-2',
      limit: '命令支持 1~6 级，工具条只暴露 1~3',
    },
  },
  {
    label: 'H3',
    run: () => execute(setHeadingLevel(3)),
    active: () => nodeOn(NODE_TYPES.HEADING, { level: 3 }),
    usage: {
      use: '把当前块转为三级标题',
      where: '块类型替换，块 id 与内容保留',
      key: 'Mod-Alt-3',
      limit: '命令支持 1~6 级，工具条只暴露 1~3',
    },
  },
  {
    label: '引用',
    run: () => execute(toggleQuote()),
    active: () => nodeOn(NODE_TYPES.QUOTE),
    usage: {
      use: '包裹为引用块；已在引用内时点击即退出',
      where: '块级包裹 / 提升，光标留在原文本处',
      limit: 'schema 未注册 quote 时静默不执行',
    },
  },
  {
    label: '无序',
    run: () => execute(toggleBulletList()),
    active: () => nodeOn(NODE_TYPES.LIST, { ordered: false }),
    title: '无序列表',
    usage: {
      use: '列表外包裹为无序列表；已在无序列表内点击即退出；在有序列表内点击改为无序',
      where: '块级包裹 / 提升 / 改 ordered 属性',
      limit: '列表内按 Enter 会拆分列表项（插件包 keymap）',
    },
  },
  {
    label: '有序',
    run: () => execute(toggleOrderedList()),
    active: () => nodeOn(NODE_TYPES.LIST, { ordered: true }),
    title: '有序列表',
    usage: {
      use: '列表外包裹为有序列表；已在有序列表内点击即退出；在无序列表内点击改为有序',
      where: '块级包裹 / 提升 / 改 ordered 属性',
      limit: '起始序号固定从 1 开始（无 start 属性入口）',
    },
  },
];

/**
 * 行内标记（核心）
 *
 * 统一语义：选区非空 → 对选区切换标记；空光标 → 写 storedMarks（只影响接下来输入的文本）。
 * 例外：删除线 / 行内代码显式 `requireSelection=true`，空光标点击不执行。
 */
const inlineActions: readonly ToolbarAction[] = [
  {
    label: 'B',
    run: () => toggleMark(MARK_TYPES.STRONG),
    active: () => markOn(MARK_TYPES.STRONG),
    title: '粗体（Mod-B）',
    usage: {
      use: '切换粗体',
      where: '标记覆盖选区；空光标则作用于后续输入',
      key: 'Mod-B',
    },
  },
  {
    label: 'I',
    run: () => toggleMark(MARK_TYPES.EMPHASIS),
    active: () => markOn(MARK_TYPES.EMPHASIS),
    title: '斜体（Mod-I）',
    usage: {
      use: '切换斜体',
      where: '标记覆盖选区；空光标则作用于后续输入',
      key: 'Mod-I',
    },
  },
  {
    label: 'U',
    run: () => toggleMark(MARK_TYPES.UNDERLINE),
    active: () => markOn(MARK_TYPES.UNDERLINE),
    title: '下划线（Mod-U）',
    usage: {
      use: '切换下划线',
      where: '标记覆盖选区；空光标则作用于后续输入',
      key: 'Mod-U',
    },
  },
  {
    label: '高亮',
    run: () => toggleMark(MARK_TYPES.HIGHLIGHT),
    active: () => markOn(MARK_TYPES.HIGHLIGHT),
    title: '高亮',
    usage: {
      use: '切换高亮底色',
      where: '标记覆盖选区；空光标则作用于后续输入',
      attrs: '高亮颜色由样式表的高亮令牌决定，不在属性栏逐处设置',
    },
  },
  {
    label: '删除线',
    run: () => execute(toggleMarkByName(MARK_TYPES.STRIKETHROUGH, undefined, true)),
    active: () => markOn(MARK_TYPES.STRIKETHROUGH),
    title: '删除线（需选中文字）',
    usage: {
      use: '给选中文字加 / 去删除线',
      require: '必须先选中文字',
      where: '标记覆盖选区',
      limit: '空光标点击不执行（requireSelection，避免误清空待输入标记）',
    },
  },
  {
    label: '代码',
    run: () => execute(toggleMarkByName(MARK_TYPES.CODE, undefined, true)),
    active: () => markOn(MARK_TYPES.CODE),
    title: '行内代码（需选中文字）',
    usage: {
      use: '把选中文字标记为行内代码（等宽）',
      require: '必须先选中文字',
      where: '标记覆盖选区',
      limit: '空光标点击不执行；块级代码请用代码块节点',
    },
  },
  {
    label: '链接',
    run: () => toggleLink(),
    active: () => markOn(MARK_TYPES.LINK),
    title: '选中文字后输入地址；已有链接时点击移除',
    usage: {
      use: '选中文字后弹窗输入地址；光标已在链接上时点击即移除链接',
      require: '必须先选中文字（空光标无待输入 link 标记时不执行）',
      where: 'link 标记覆盖选区，href 记在 attrs',
      attrs: 'link.href（插入后可在属性栏改地址）',
      limit: '弹出的是浏览器 prompt，取消则不插入；导出时由序列化器输出 <a>',
    },
  },
  {
    label: '注音',
    run: () => toggleRuby(),
    active: () => markOn(MARK_TYPES.RUBY),
    title: '选中文字后输入注文（ruby）',
    usage: {
      use: '选中文字后弹窗输入注文，渲染为 <ruby>基字<rt>注文</rt></ruby>；已有注音时点击即移除',
      where: 'ruby 标记覆盖选区（空光标可用，标记待输入）',
      attrs: 'ruby.text（注文内容，改注文走属性栏）',
      limit: '注文计入 DOM 文本但不计入模型字符偏移（见 ruby-annotation 的跳过规则）',
    },
  },
];

/** 链接：选中文字输 href；已有链接时再次点击移除 */
function toggleLink(): void {
  if (markOn(MARK_TYPES.LINK)) {
    execute(unsetLink());
    return;
  }
  const href = window.prompt('链接地址（取消则不插入）');
  if (href) {
    execute(setLink(href));
  }
}

/** 注音：选中文字输注文；已有注音时再次点击移除标记 */
function toggleRuby(): void {
  if (markOn(MARK_TYPES.RUBY)) {
    execute(toggleMarkByName(MARK_TYPES.RUBY, undefined, true));
    return;
  }
  const text = window.prompt('注文内容（取消则不添加）');
  if (text !== null) {
    execute(toggleMarkByName(MARK_TYPES.RUBY, { text }));
  }
}

/**
 * 古籍标记（classical 编辑命令）
 *
 * 前 6 个是行内标记（空光标 = 设置待输入标记）；后 3 个是行内容器（需要选区包裹）。
 * 标记的渲染样式（专名线 / 圈点 / 避讳写法）全部由 `book-css.ts` 的 `.bt-mark-*` 与
 * `.bt-*` 类决定，工具条只负责打标记，不负责外观。
 */
const classicalActions: readonly ToolbarAction[] = [
  {
    label: '专名号',
    run: () => execute(toggleProperName()),
    active: () => markOn(CLASSICAL_MARK_TYPES.PROPER_NAME),
    title: '专名号（人名 / 地名等）',
    usage: {
      use: '给选中文字加专名号（人名、地名、朝代等）',
      where: '标记覆盖选区；空光标则作用于后续输入',
      limit: '纯语义标记，样式由样式表的专名号令牌决定',
    },
  },
  {
    label: '书名号',
    run: () => execute(toggleBookTitle()),
    active: () => markOn(CLASSICAL_MARK_TYPES.BOOK_TITLE),
    title: '书名号',
    usage: {
      use: '给选中文字加书名号标记',
      where: '标记覆盖选区；空光标则作用于后续输入',
      limit: '输出的是标记而非文字「《》」，导出样式与古籍版式一致',
    },
  },
  {
    label: '圈点',
    run: () => execute(toggleCircleEmphasis()),
    active: () => markOn(CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS),
    title: '圈点（着重点）',
    usage: {
      use: '给选中文字加圈点（着重点 / 侧圈）',
      where: '标记覆盖选区；空光标则作用于后续输入',
      attrs:
        'circle-emphasis.style（缺省 circle；可选 open-circle / dot / open-dot / double-circle / triangle / sesame）',
      limit: '直排下圈点位置由样式表按书写方向调整',
    },
  },
  {
    label: '异体',
    run: () => execute(toggleVariant()),
    active: () => markOn(CLASSICAL_MARK_TYPES.VARIANT),
    title: '异体字标记',
    usage: {
      use: '标记选中文字为异体字',
      where: '标记覆盖选区；空光标则作用于后续输入',
      limit: '与「异体载体」不同：这是标记（不改变节点结构），载体是行内容器',
    },
  },
  {
    label: '注Ref',
    run: () => execute(toggleNoteRef()),
    active: () => markOn(CLASSICAL_MARK_TYPES.NOTE_REF),
    title: '注Ref标记（noteId 在属性栏录入）',
    usage: {
      use: '把选中文字标为指向某条注释的引点',
      where: '标记覆盖选区',
      attrs: 'note-ref.noteId（必填，工具条不弹窗录入）',
      limit: '只打标记不建链接：noteId 未补录时导出无锚点跳转',
    },
  },
  {
    label: '避讳',
    run: () => execute(toggleTaboo()),
    active: () => markOn(CLASSICAL_MARK_TYPES.TABOO),
    title: '避讳字标记',
    usage: {
      use: '标记选中文字为避讳字',
      where: '标记覆盖选区；空光标则作用于后续输入',
      limit: '与「避讳载体」不同：标记不改结构，载体是行内容器',
    },
  },
  {
    label: '夹注',
    run: () => execute(toggleInlineNote()),
    title: '选中文字包裹为夹注（空光标插入容器）',
    usage: {
      use: '选中文字 → 包裹成夹注；空光标 → 插入空夹注容器并进入其中',
      where: '行内容器包裹选区（结果替代原选区）',
      limit: '跨段落选区静默不执行（单个行内片段无法表达跨块内容）',
    },
  },
  {
    label: '异体载体',
    run: () => execute(toggleVariantChar()),
    title: '选中文字包裹为异体字载体',
    usage: {
      use: '选中文字 → 包裹成异体字载体；空光标 → 插入空载体',
      where: '行内容器包裹选区',
      limit: '跨段落选区静默不执行',
    },
  },
  {
    label: '避讳载体',
    run: () => execute(toggleTabooChar()),
    title: '选中文字包裹为避讳字载体',
    usage: {
      use: '选中文字 → 包裹成避讳字载体；空光标 → 插入空载体',
      where: '行内容器包裹选区',
      limit: '跨段落选区静默不执行',
    },
  },
];

/**
 * 块插入与符号
 *
 * 两类落点，别混：
 * - **段后插入容器**（双行注 / 眉批 / 校勘记 / 跋文 / 牌记 / 题记 / 版框 / 鱼尾 / 表格 /
 *   脚注 / 尾注 / 边注）：以「当前叶块之后」为插入点，光标随即进入新容器；
 * - **光标处插入**（出校符号 / 印章 / 图片）：按 `replaceSelectionWith` 替换当前选区。
 * 另有「下一页」：在光标处插分页符（段中则一分为二），靠分页器的 breakAfter 断页（非容器插入）。
 * 容器类内容的可编辑性、样式全在 `book-css.ts`；`rawAttrs` 兜底保证未知属性往返无损。
 */
const insertActions: readonly ToolbarAction[] = [
  {
    label: '下一页',
    run: () => execute(insertPageBreak()),
    title: '在光标处插入分页符：光标后的内容另起一页，光标落在新页首位',
    usage: {
      use: '从光标处强行断页：新增一页，光标落到新页第一个可输入位置',
      where:
        '光标在段中 / 段尾 → 该段一分为二，后半起新页；光标在段首 → 整段移到新页（均不留空白段）',
      attrs: 'break.variant = page（分页符，不是普通分隔线 hr / dashed）',
      limit:
        '横排 / 直排同一逻辑；分页符在页内渲染为一条分隔线（横排横线、直排竖线），点错可整笔撤销（Mod-Z）',
    },
  },
  {
    label: '双行注',
    run: () => execute(insertDoubleNote()),
    title: '在当前段落之后插入双行小注',
    usage: {
      use: '插入双行小注容器（内嵌空段落）',
      where: '当前叶块之后；光标进入新容器',
      attrs: '容器属性与注文内容均直接在块内编辑',
      limit: '插入位置跟随光标所在最内层块，不是文档末尾',
    },
  },
  {
    label: '眉批',
    run: () => execute(insertHeadNote()),
    title: '在当前段落之后插入眉批',
    usage: {
      use: '插入眉批容器（页眉上方批注位）',
      where: '当前叶块之后；光标进入新容器',
      limit: '版心外的落位由分页与样式表决定，编辑态按块顺序显示',
    },
  },
  {
    label: '校勘记',
    run: () => execute(insertCollationNote()),
    title: '在当前段落之后插入校勘记',
    usage: {
      use: '插入校勘记容器',
      where: '当前叶块之后；光标进入新容器',
      limit: '与「出校符号」配合使用：符号在正文，记文在此容器',
    },
  },
  {
    label: '出校符号',
    run: () => execute(insertCollationSymbol()),
    title: '在光标处插入出校符号（○）',
    usage: {
      use: '在光标处插入出校符号 ○',
      where: '光标处（替换选区）',
      attrs: 'collation-mark.symbol（可改为 □ / △ 等）',
      limit: '符号渲染依赖 `.bt-collation-mark::after{content:attr(data-symbol)}`',
    },
  },
  {
    label: '跋文',
    run: () => execute(insertTailNote()),
    title: '在当前段落之后插入跋文',
    usage: {
      use: '插入跋文容器',
      where: '当前叶块之后；光标进入新容器',
      limit: '多用于书末，节点本身没有位置约束',
    },
  },
  {
    label: '牌记',
    run: () => execute(insertImprint()),
    title: '在当前段落之后插入牌记',
    usage: {
      use: '插入牌记容器（刊刻信息）',
      where: '当前叶块之后；光标进入新容器',
    },
  },
  {
    label: '题记',
    run: () => execute(insertColophon()),
    title: '在当前段落之后插入题记',
    usage: {
      use: '插入题记容器（跋语 / 题识）',
      where: '当前叶块之后；光标进入新容器',
    },
  },
  {
    label: '版框',
    run: () => execute(insertBorderFrame()),
    title: '在当前段落之后插入版框',
    usage: {
      use: '插入版框容器（四周界线）',
      where: '当前叶块之后；光标进入新容器',
      limit: '版框的边线样式由样式表控制，容器本身只是语义块',
    },
  },
  {
    label: '鱼尾',
    run: () => execute(insertFishTail()),
    title: '在当前段落之后插入鱼尾',
    usage: {
      use: '插入鱼尾（版心中缝的鱼形装饰）',
      where: '当前叶块之后',
      limit: '无内容原子块：不可在块内输入，外观由 `.bt-fish-tail::after` 提供',
    },
  },
  {
    label: '印章',
    run: () => {
      const text = window.prompt('印文（取消则不插入，确定留空用占位）');
      if (text !== null) {
        execute(insertSeal(text || undefined));
      }
    },
    title: '在光标处插入印章',
    usage: {
      use: '在光标处插入印章，弹窗录入印文（取消则不插入）',
      where: '光标处（替换选区）',
      attrs: 'seal.text（印文；留空确定则用「印章」占位，之后可在属性栏改）',
      limit: '印文只存在 attrs，元素本身无文本 —— 显示依赖 `.bt-seal::after`',
    },
  },
  {
    label: '图片',
    run: () => {
      const src = window.prompt('图片地址（留空用占位图）', '');
      if (src !== null) {
        execute(insertImage({ src: src || undefined, alt: '' }));
      }
    },
    title: '在光标处插入图片（src / alt 可在属性栏修改）',
    usage: {
      use: '在光标处插入图片，弹窗录入图片地址（取消则不插入）',
      where: '光标处（替换选区）',
      attrs: 'image.src / image.alt（alt 默认空串，插入后补）',
      limit: '地址留空则用 1×1 占位图；外链地址不会随 EPUB 导出打包',
    },
  },
  {
    label: '表格',
    run: () => execute(insertTable(3, 3)),
    title: '在当前段落之后插入 3×3 表格',
    usage: {
      use: '插入 3×3 表格（单元格内嵌空段落）',
      where: '当前叶块之后',
      limit: '简化表格模型：无跨行 / 跨列 / 表头属性',
    },
  },
  {
    label: '脚注',
    run: () => execute(insertBlockOfType(NODE_TYPES.FOOTNOTE)),
    title: '在当前段落之后插入脚注',
    usage: {
      use: '插入脚注容器',
      where: '当前叶块之后；光标进入新容器',
      limit: '与正文的关联靠「注Ref」标记，二者需手动配对',
    },
  },
  {
    label: '尾注',
    run: () => execute(insertBlockOfType(NODE_TYPES.ENDNOTE)),
    title: '在当前段落之后插入尾注',
    usage: {
      use: '插入尾注容器',
      where: '当前叶块之后；光标进入新容器',
      limit: '导出 EPUB 时按块顺序输出，不做自动编号',
    },
  },
  {
    label: '边注',
    run: () => execute(insertBlockOfType(NODE_TYPES.MARGIN_NOTE)),
    title: '在当前段落之后插入边注',
    usage: {
      use: '插入边注（页边小字）容器',
      where: '当前叶块之后；光标进入新容器',
      limit: '直排 / 横排的边注落位不同，由样式表与分页决定',
    },
  },
];

/**
 * 两行功能区（参照 Word / Sigil 二级工具条：按使用频率分层，避免单行超长溢出）
 *
 * 第一行：撤销 / 重做 + 块形态 + 行内标记（高频编辑）；
 * 第二行：古籍标记 + 块插入（低频专题）+ 右端实用区。
 * 组间以分隔线区分，行内按钮去边框（ghost 制式，激活才现底色）。
 */
const TOOLBAR_ROWS: ReadonlyArray<{ key: string; actions: readonly ToolbarAction[] }> = [
  { key: 'doc', actions: [...historyActions, ...blockActions, ...inlineActions] },
  { key: 'classical', actions: classicalActions },
  { key: 'insert', actions: insertActions },
];

/**
 * 右端三个手写按钮的悬浮说明
 *
 * 它们在模板中直接写（带 emit / 内部开关状态），不是 ToolbarAction，
 * 故按按钮文字索引，模板里取 `UTILITY_USAGES['只读']` 传给 ToolbarUsageTip。
 */
const UTILITY_USAGES: Readonly<Record<string, ToolbarUsage>> = {
  查找替换: {
    use: '展开编辑画布内的查找替换面板',
    where: '命中处即选中并滚动到视口；替换直接改写文档',
    limit: '作用于 ProseMirror 文档，与阅读态 SearchPanel 的检索结果互不影响',
  },
  只读: {
    use: '切换只读 / 可编辑',
    where: '只读下所有写操作按钮置灰、输入与粘贴被拒，工具条与查找面板仍可展开',
    limit: '只读仅是视图层 editable=false，程序化事务（含自动保存恢复）仍可派发',
  },
  还原样册: {
    use: '把编辑器内容重置为内置样册',
    require: '非只读态可用',
    where: '整篇文档替换，光标回到篇首',
    limit: '丢弃当前修改且不保留撤销栈，执行前请确认已保存',
  },
};

/** 鼠标滚轮（纵向）映射为所在工具行的横向滚动；触控板横向手势保持原生行为 */
function onWheel(event: WheelEvent): void {
  const bar = event.currentTarget as HTMLElement | null;
  if (bar === null) return;
  // 仅当存在横向溢出、且以纵向滚量为主时接管
  const canScrollX = bar.scrollWidth - bar.clientWidth > 1;
  if (!canScrollX || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  event.preventDefault();
  bar.scrollLeft += event.deltaY;
}
</script>

<template>
  <div class="editor-toolbar">
    <div
      v-for="row in TOOLBAR_ROWS"
      :key="row.key"
      class="editor-toolbar__row"
      :class="{ 'editor-toolbar__row--readonly': isReadonly }"
      @wheel="onWheel"
    >
      <ToolbarUsageTip v-for="action in row.actions" :key="action.label" :usage="action.usage">
        <button
          type="button"
          class="editor-toolbar__button"
          :class="{ 'editor-toolbar__button--active': action.active?.() === true }"
          :title="action.usage === undefined ? action.title : undefined"
          :disabled="isReadonly || action.disabled?.() === true"
          @mousedown.prevent
          @click="action.run()"
        >
          {{ action.label }}
        </button>
      </ToolbarUsageTip>
      <!-- 实用区固定第二行右端 -->
      <div v-if="row.key === 'insert'" class="editor-toolbar__group editor-toolbar__group--end">
        <ToolbarUsageTip :usage="UTILITY_USAGES['查找替换']">
          <button
            type="button"
            class="editor-toolbar__button"
            :class="{ 'editor-toolbar__button--active': searchOpen }"
            @mousedown.prevent
            @click="searchOpen = !searchOpen"
          >
            查找替换
          </button>
        </ToolbarUsageTip>
        <ToolbarUsageTip :usage="UTILITY_USAGES['只读']">
          <button
            type="button"
            class="editor-toolbar__button"
            :class="{ 'editor-toolbar__button--active': isReadonly }"
            @mousedown.prevent
            @click="emit('toggle-readonly')"
          >
            {{ isReadonly ? '可编辑' : '只读' }}
          </button>
        </ToolbarUsageTip>
        <ToolbarUsageTip :usage="UTILITY_USAGES['还原样册']">
          <button
            type="button"
            class="editor-toolbar__button"
            :disabled="isReadonly"
            @mousedown.prevent
            @click="emit('reset')"
          >
            还原样册
          </button>
        </ToolbarUsageTip>
      </div>
    </div>
  </div>
  <ReplacePanel
    v-if="searchOpen"
    :binding="binding"
    :readonly="isReadonly"
    @close="searchOpen = false"
  />
</template>

<style scoped>
/* 二级功能区：整块扁平行条，不再是在画布上飘着的圆角卡片 */
.editor-toolbar {
  display: flex;
  flex: none;
  flex-direction: column;
  border-block-end: 1px solid var(--demo-border);
  background: var(--demo-panel);
  color: var(--demo-text);
}

.editor-toolbar__row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  padding: 3px 10px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.editor-toolbar__row + .editor-toolbar__row {
  border-block-start: 1px solid var(--demo-border);
}

.editor-toolbar__row::-webkit-scrollbar {
  height: 6px;
}

.editor-toolbar__row::-webkit-scrollbar-thumb {
  background: var(--demo-border);
  border-radius: 3px;
}

.editor-toolbar__group {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

.editor-toolbar__group--end {
  margin-inline-start: auto;
  padding-inline-start: 12px;
  border-inline-start: 1px solid var(--demo-control-border);
}

.editor-toolbar__row--readonly {
  opacity: 0.75;
}

/* ghost 按钮制式：平时无边框，悬停现浅底，激活现轻色块 */
.editor-toolbar__button {
  flex: none;
  padding: 3px 9px;
  font-size: 12.5px;
  white-space: nowrap;
  color: var(--demo-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}

.editor-toolbar__button:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.12);
  border-color: transparent;
  color: var(--demo-text);
}

.editor-toolbar__button:disabled {
  opacity: 0.4;
  cursor: default;
}

.editor-toolbar__button--active {
  color: var(--demo-accent);
  background: rgba(140, 90, 43, 0.14);
  font-weight: 600;
}

.editor-toolbar__button--active:hover:not(:disabled) {
  color: var(--demo-accent);
}
</style>
