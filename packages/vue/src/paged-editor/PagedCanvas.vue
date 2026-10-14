<script setup lang="ts">
/**
 * 编辑态分页渲染外壳（真实书页盒 · 虚拟化 · 可编辑桥）
 *
 * 把 `buildPagedLayout` 产出的「逐页行片段」渲染为一张张真实书页：
 * - 每页固定开本尺寸 + 版心内缩（页眉 / 页脚空白）+ 页间 gap（台面色）；
 * - 页内每个片段独立 `div.bt-paged-frag[data-block-id][data-from-line]`，
 *   内容 = `sliceNodeByCharRange` 切片节点经 `serializeNode` 的 HTML；
 * - 片段是「预裁到页容量」的，页框 overflow 仅作安全网 → 结构上杜绝文字漏进页缝 / 纸外；
 * - 窗口化虚拟化：仅序列化 / 挂载视口 ± OVERSCAN 页，大部头不卡。
 *
 * 编辑面（3A 固化方案 S）：paged 下 PM 整文档视图无法塞进单页格（窗口化即回
 * 旧叠层漂移老路），故编辑交互由片段 contenteditable 承载：beforeinput /
 * composition / paste / keydown 经 selection-bridge 映射为 BookEditor 事务，
 * 真相在模型；重排（pages 变化）后按模型选区还原 caret 与焦点页。
 * 输入完整性：IME 组合期间不落事务、compositionend 快照差分一次提交；
 * 粘贴归一纯文本；跨块边界退格/删除走 PM join；纯导航键跨页片段边界跳转。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { isTextNode, type BookNode } from '@bibliotype/core';
import { buildPageStyle, buildRootStyle, type LayoutOptions } from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import { formatPageNumber, type PageNumberStyle } from '@bibliotype/reader';
import type { BookEditor } from '@bibliotype/editor';
import {
  fragmentCharToBlockChar,
  locatePmPosition,
  type PagedIndex,
} from './selection-bridge.js';
import { applyFragmentEdit, applyFragmentSelection, applyFragmentSplit } from './edit-applier.js';
import {
  blockFragments,
  diffTextReplace,
  domPosInFrag,
  fragPlainText,
  fragSelection,
  fragStartChar,
  resolveCaretTarget,
} from './input-router.js';
import type { PagedFragment, PagedPage } from './use-paged-layout.js';

const props = withDefaults(
  defineProps<{
    /** 逐页片段（来自 buildPagedLayout / usePagedLayout） */
    pages: PagedPage[];
    /** 布局选项 */
    options: LayoutOptions;
    /** 主题令牌值表 */
    tokens: Readonly<Record<string, string | undefined>>;
    /** 正文字体族令牌键 */
    fontToken?: string;
    /** 是否可编辑（片段格承载 contenteditable + 输入路由） */
    editable?: boolean;
    /** 缩放（按容器宽等比适配，缺省开启） */
    fit?: boolean;
    /** 模型编辑器（可编辑态必填：事务真相源） */
    editor?: BookEditor | null;
    /** 块 ⇄ PM 位置索引（可编辑态必填：usePagedLayout.pagedIndex） */
    index?: PagedIndex | null;
    /** 每行字符估算（回退口径，须与分页构建同源） */
    charsPerLine?: number;
  }>(),
  { editable: false, fit: true, editor: null, index: null, charsPerLine: 40 },
);

const emit = defineEmits<{
  /** 视口页变化（供外部页态 / 滚动定位同步） */
  'update:visiblePage': [index: number];
  /** 一次模型编辑落模（携带块 id 供增量重排；父级需 refresh + scheduleRelayout(id)） */
  edited: [blockId: string];
  /** 选区同步落模（父级 refresh 即可；纯选区不触发重排） */
  sync: [];
  /** 历史命令请求（模型历史在 PM 插件栈，父级经 binding.undo/redo 执行） */
  history: [dir: 'undo' | 'redo'];
}>();

const CONTAINER_SELECTOR = '.bt-paged-page';
const STYLE_ELEMENT_ID = 'bt-paged-editor-css';
const FRAG_SELECTOR = '.bt-paged-frag';

/* ---------- 书册样式注入（与 BtBookView 同源，容器选择器限定编辑外壳） ---------- */

function syncStyle(): void {
  if (typeof document === 'undefined') return;
  const css = buildBookCss({
    tokens: props.tokens,
    options: props.options,
    fontToken: props.fontToken,
    containerSelector: CONTAINER_SELECTOR,
  });
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (el === null) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

function removeStyle(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
}

onMounted(syncStyle);
watch(() => [props.tokens, props.options, props.fontToken], syncStyle);
onBeforeUnmount(removeStyle);

/* ---------- 页框样式（固定开本 + 页边距 + 排版规则） ---------- */

const pageSize = computed(() => props.options.pageSize);
const pageNumberStyle = computed(() => props.options.pageNumberStyle as PageNumberStyle);

const pageFrameStyle = computed(() => ({
  ...buildPageStyle(pageSize.value, props.tokens),
  ...buildRootStyle({
    tokens: props.tokens,
    options: props.options,
    fontToken: props.fontToken,
  }),
}));

/* ---------- 虚拟化窗口 ---------- */

const SCROLL_PADDING = 16;
const SCROLL_GAP = 28;
const OVERSCAN = 2;

const rootRef = ref<HTMLElement | null>(null);
const scrollerRef = ref<HTMLElement | null>(null);
const viewport = ref({ top: 0, height: 0 });
const scrollScale = ref(1);

const slotHeight = computed(() => pageSize.value.height * scrollScale.value);
const stride = computed(() => slotHeight.value + SCROLL_GAP);

const pageCount = computed(() => props.pages.length);

const contentStyle = computed(() => {
  const count = pageCount.value;
  const height = count > 0 ? SCROLL_PADDING * 2 + count * stride.value - SCROLL_GAP : 0;
  return { height: `${height}px` };
});

const range = computed(() => {
  const count = pageCount.value;
  if (count === 0) return { start: 0, end: -1 };
  const step = stride.value > 0 ? stride.value : 1;
  const firstVisible = Math.floor(viewport.value.top / step);
  const lastVisible = Math.floor((viewport.value.top + viewport.value.height) / step);
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(count - 1, lastVisible + OVERSCAN);
  return { start, end };
});

interface RenderedFrag {
  key: string;
  blockId: string;
  fromLine: number;
  lineCount: number;
  html: string;
}

interface RenderedPage {
  index: number;
  top: number;
  frags: RenderedFrag[];
  numberText: string;
}

function fragHtml(frag: PagedFragment): string {
  const node: BookNode = frag.node;
  return isTextNode(node) ? '' : serializeNode(node);
}

const renderedPages = computed<RenderedPage[]>(() => {
  const { start, end } = range.value;
  const list: RenderedPage[] = [];
  for (let i = start; i <= end; i += 1) {
    const page = props.pages[i];
    if (page === undefined) continue;
    list.push({
      index: i,
      top: SCROLL_PADDING + i * stride.value,
      frags: page.fragments.map((frag) => ({
        key: `${frag.blockId}@${frag.fromLine}`,
        blockId: frag.blockId,
        fromLine: frag.fromLine,
        lineCount: frag.lineCount,
        html: fragHtml(frag),
      })),
      numberText: formatPageNumber(i + 1, pageNumberStyle.value),
    });
  }
  return list;
});

function updateScale(): void {
  const el = scrollerRef.value;
  if (!props.fit || el === null || el.clientWidth <= 0) {
    scrollScale.value = 1;
    syncViewport();
    return;
  }
  const available = el.clientWidth - SCROLL_PADDING * 2;
  scrollScale.value = Math.min(1, Math.max(0.1, available / pageSize.value.width));
  syncViewport();
}

function syncViewport(): void {
  const el = scrollerRef.value;
  if (el === null) return;
  viewport.value = { top: el.scrollTop, height: el.clientHeight };
}

function indexFromViewport(): number {
  const count = pageCount.value;
  if (count === 0) return 0;
  const step = stride.value > 0 ? stride.value : 1;
  const y = viewport.value.top + viewport.value.height * 0.35 - SCROLL_PADDING;
  return Math.min(count - 1, Math.max(0, Math.floor(y / step)));
}

let scrollRaf = 0;
function onScroll(): void {
  if (scrollRaf !== 0) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    syncViewport();
    emit('update:visiblePage', indexFromViewport());
  });
}

/** 外部定位到某页顶部 */
function scrollToPage(index: number): void {
  const el = scrollerRef.value;
  if (el === null || index < 0 || index >= pageCount.value) return;
  el.scrollTop = SCROLL_PADDING + index * stride.value;
  syncViewport();
}

defineExpose({ scrollToPage, syncViewport });

let observer: ResizeObserver | undefined;
onMounted(() => {
  updateScale();
  if (typeof ResizeObserver !== 'undefined' && scrollerRef.value !== null) {
    observer = new ResizeObserver(updateScale);
    observer.observe(scrollerRef.value);
  }
  void nextTick(syncViewport);
  attachSelectionSync();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
  detachSelectionSync();
});

const slotWidth = computed(() => `${pageSize.value.width * scrollScale.value}px`);
const scaledFrameStyle = computed(() => ({
  ...pageFrameStyle.value,
  transform: `scale(${scrollScale.value})`,
  transformOrigin: 'top left',
}));

const editableNow = computed(() => props.editable && props.editor !== null && props.index !== null);

/* ---------- 编辑桥：片段格输入路由（方案 S） ---------- */

/** 重排后是否需要按模型选区还原 caret（任一编辑 / 边界导航置位） */
let restorePending = false;
/** IME 组合快照（compositionstart → end 差分一次性提交） */
let compositionSnap: {
  fragEl: HTMLElement;
  blockId: string;
  fromLine: number;
  oldText: string;
} | null = null;

function fragElOf(node: EventTarget | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : null;
  const frag = el?.closest<HTMLElement>(FRAG_SELECTOR);
  if (frag === null || (frag !== undefined && rootRef.value?.contains(frag) !== true)) return null;
  return frag ?? null;
}

function findFragEl(blockId: string, fromLine: number): HTMLElement | null {
  const root = rootRef.value;
  if (root === null) return null;
  const els = Array.from(root.querySelectorAll<HTMLElement>(FRAG_SELECTOR));
  for (const el of els) {
    if (el.dataset.blockId === blockId && Number(el.dataset.fromLine ?? '0') === fromLine) {
      return el;
    }
  }
  return null;
}

/** 块内文本长度（模型口径：叶文本块 nodeSize − 2；原子块为 0） */
function blockTextLen(locDocStart: number): number {
  const editor = props.editor;
  if (editor === null) return 0;
  const node = editor.editorState.doc.nodeAt(locDocStart);
  if (node === null || node === undefined) return 0;
  return Math.max(0, node.nodeSize - 2);
}

/**
 * 块边界回删 / 前删：join 相邻块（模型真相），失败则仅还原光标。
 *
 * @param boundaryPos 两块之间的 PM 位置（前块尾 = 后块首）
 */
function joinAtBoundary(boundaryPos: number, hintBlockId: string): void {
  const editor = props.editor;
  if (editor === null) return;
  const tr = editor.editorState.tr.join(boundaryPos);
  if (tr.docChanged) {
    editor.dispatch(tr);
    restorePending = true;
    emit('edited', hintBlockId);
  }
}

function onBeforeInput(e: Event): void {
  const ev = e as InputEvent;
  if (!editableNow.value) return;
  const editor = props.editor;
  const index = props.index;
  if (editor === null || index === null) return;
  const fragEl = fragElOf(ev.target);
  if (fragEl === null) return;
  const type = ev.inputType;
  // IME 进行中：DOM 自由变化，compositionend 差分统一提交（阶段四口径）
  if (ev.isComposing || type.startsWith('insertComposition') || type === 'insertFromPaste'
    || type === 'insertFromDrop' || type === 'insertFromPasteDrag') {
    return;
  }
  const fs = fragSelection(fragEl);
  if (fs === null) return;
  const cpl = props.charsPerLine;

  if (type === 'insertText' || type === 'insertReplacementText') {
    const text = ev.data ?? '';
    if (applyFragmentEdit(editor, index, fs.blockId, fs.fromLine, fs.start, fs.end, text, cpl)) {
      restorePending = true;
      emit('edited', fs.blockId);
    }
    return; // 不拦截 DOM 默认插入，键入即时可见；重排后按模型还原
  }

  if (type.startsWith('delete')) {
    let from = fs.start;
    let to = fs.end;
    if (from === to) {
      if (type.endsWith('Backward')) from -= 1;
      else to += 1;
    }
    if (applyFragmentEdit(editor, index, fs.blockId, fs.fromLine, from, to, '', cpl)) {
      restorePending = true;
      emit('edited', fs.blockId);
      return; // DOM 同步删除，重排后统一
    }
    // 映射未命中 = 越出块边界：块首退格 / 块尾前删 → 模型 join 相邻块
    const loc = index.byId.get(fs.blockId);
    if (loc !== undefined) {
      const order = index.ordered;
      const i = order.indexOf(loc);
      const blockLen = blockTextLen(loc.docStart);
      const blockChar = fragmentCharToBlockChar(fs.fromLine, Math.min(from, to), loc.lineOffsets, cpl);
      if (type.endsWith('Backward') && blockChar <= 0 && i > 0) {
        e.preventDefault();
        joinAtBoundary(loc.docStart, fs.blockId);
        return;
      }
      if (type.endsWith('Forward') && blockChar >= blockLen && i >= 0 && i < order.length - 1) {
        const next = order[i + 1] as (typeof order)[number];
        e.preventDefault();
        joinAtBoundary(next.docStart, fs.blockId);
        return;
      }
    }
    e.preventDefault(); // 其余越界删除：拒绝原生改动，仅同步选区
    emit('sync');
    return;
  }

  if (type === 'insertParagraph' || type === 'insertLineBreak') {
    e.preventDefault();
    if (applyFragmentSplit(editor, index, fs.blockId, fs.fromLine, fs.start, cpl)) {
      restorePending = true;
      emit('edited', fs.blockId);
    }
    return;
  }

  if (type === 'historyUndo' || type === 'historyRedo' || type === 'historyPaste') {
    e.preventDefault();
    emit('history', type === 'historyUndo' ? 'undo' : 'redo');
    return;
  }

  // 未知输入类型：拒绝原生改动（模型是唯一真相），交重排还原视图
  e.preventDefault();
  emit('sync');
}

function onCompositionStart(e: Event): void {
  const fragEl = fragElOf(e.target);
  if (fragEl === null || !editableNow.value) return;
  const blockId = fragEl.dataset.blockId ?? '';
  const fromLine = Number(fragEl.dataset.fromLine ?? '0');
  compositionSnap = { fragEl, blockId, fromLine: Number.isFinite(fromLine) ? fromLine : 0, oldText: fragPlainText(fragEl) };
}

function onCompositionEnd(): void {
  const snap = compositionSnap;
  compositionSnap = null;
  if (snap === null || !editableNow.value) return;
  const editor = props.editor;
  const index = props.index;
  if (editor === null || index === null) return;
  const newText = fragPlainText(snap.fragEl);
  const d = diffTextReplace(snap.oldText, newText);
  if (d.from === d.to && d.text === '') return;
  if (applyFragmentEdit(editor, index, snap.blockId, snap.fromLine, d.from, d.to, d.text, props.charsPerLine)) {
    restorePending = true;
    emit('edited', snap.blockId);
  }
}

function onPaste(e: Event): void {
  if (!editableNow.value) return;
  const ev = e as ClipboardEvent;
  const editor = props.editor;
  const index = props.index;
  if (editor === null || index === null) return;
  const fragEl = fragElOf(ev.target);
  if (fragEl === null) return;
  ev.preventDefault();
  const raw = ev.clipboardData?.getData('text/plain') ?? '';
  const text = raw.replace(/\r\n?/g, '\n');
  const fs = fragSelection(fragEl);
  if (fs === null) return;
  if (text === '') {
    if (fs.start !== fs.end) applyFragmentEdit(editor, index, fs.blockId, fs.fromLine, fs.start, fs.end, '', props.charsPerLine);
    return;
  }
  if (applyFragmentEdit(editor, index, fs.blockId, fs.fromLine, fs.start, fs.end, text, props.charsPerLine)) {
    restorePending = true;
    emit('edited', fs.blockId);
    // 程序化写入 DOM（不触发 beforeinput，避免二次落模）
    const sel = window.getSelection();
    if (sel !== null && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const tn = document.createTextNode(text);
      range.insertNode(tn);
      sel.setBaseAndExtent(tn, text.length, tn, text.length);
    }
  }
}

/* ---------- 键盘：历史快捷键 + 片段边界跨页 / 跨块导航 ---------- */

function focusAndSetCaret(pageIndex: number, blockId: string, fromLine: number, localChar: number): void {
  const apply = (): void => {
    const el = findFragEl(blockId, fromLine);
    if (el === null) return;
    el.focus({ preventScroll: false });
    const pos = domPosInFrag(el, localChar);
    const sel = window.getSelection();
    if (pos === null || sel === null) return;
    const r = document.createRange();
    r.setStart(pos.container, pos.offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  };
  const { start, end } = range.value;
  if (pageIndex >= start && pageIndex <= end) {
    apply();
    return;
  }
  scrollToPage(pageIndex);
  void nextTick(apply);
}

/** 模型选区 → 页/片段归属 → DOM caret 还原（重排后 / 边界导航共用） */
function restoreCaretFromModel(): void {
  const editor = props.editor;
  const index = props.index;
  if (editor === null || index === null) return;
  const sel = editor.editorState.selection;
  const hitFrom = locatePmPosition(index, sel.from);
  const hitTo = locatePmPosition(index, sel.to);
  if (hitFrom === null || hitTo === null) return;
  const cpl = props.charsPerLine;
  const pages = props.pages;
  const start = resolveCaretTarget(pages, index, cpl, hitFrom.loc.blockId, hitFrom.blockChar);
  const end = resolveCaretTarget(pages, index, cpl, hitTo.loc.blockId, hitTo.blockChar);
  if (start === null || end === null) return;
  const apply = (): void => {
    const elA = findFragEl(start.blockId, start.fromLine);
    const elB = end.blockId === start.blockId && end.fromLine === start.fromLine ? elA : findFragEl(end.blockId, end.fromLine);
    if (elA === null) return;
    elA.focus({ preventScroll: false });
    const pA = domPosInFrag(elA, start.localChar);
    const pB = elB !== null ? domPosInFrag(elB, end.localChar) : pA;
    const domSel = window.getSelection();
    if (pA === null || pB === null || domSel === null) return;
    const r = document.createRange();
    r.setStart(pA.container, pA.offset);
    r.setEnd(pB.container, pB.offset);
    domSel.removeAllRanges();
    domSel.addRange(r);
  };
  if (start.pageIndex < range.value.start || start.pageIndex > range.value.end) {
    scrollToPage(start.pageIndex);
    void nextTick(apply);
    return;
  }
  apply();
}

/** 片段边缘的跨页 / 跨块箭头导航；命中并处理返回 true（调用方 preventDefault） */
function navigateAtEdge(
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  fragEl: HTMLElement,
): boolean {
  const editor = props.editor;
  const index = props.index;
  if (editor === null || index === null) return false;
  const fs = fragSelection(fragEl);
  if (fs === null || fs.start !== fs.end) return false;
  const loc = index.byId.get(fs.blockId);
  if (loc === undefined) return false;
  const cpl = props.charsPerLine;
  const list = blockFragments(props.pages, fs.blockId, loc, cpl);
  const cur = list.find((e) => e.frag.fromLine === fs.fromLine);
  if (cur === undefined) return false;
  const k = list.indexOf(cur);

  if ((key === 'ArrowLeft' || key === 'ArrowUp') && fs.start === 0) {
    // 片段首：上一续页片段尾 → 同序内回跳
    if (k > 0) {
      const prev = list[k - 1] as (typeof list)[number];
      focusAndSetCaret(prev.pageIndex, fs.blockId, prev.frag.fromLine, Number.MAX_SAFE_INTEGER);
      return true;
    }
    // 块首：跨到前一块最后片段尾（ArrowUp 在首行交原生行内移动）
    if (key === 'ArrowLeft') {
      const i = index.ordered.indexOf(loc);
      if (i > 0) {
        const prevLoc = index.ordered[i - 1] as (typeof index.ordered)[number];
        const prevList = blockFragments(props.pages, prevLoc.blockId, prevLoc, cpl);
        const lastFrag = prevList[prevList.length - 1];
        if (lastFrag !== undefined) {
          focusAndSetCaret(lastFrag.pageIndex, prevLoc.blockId, lastFrag.frag.fromLine, Number.MAX_SAFE_INTEGER);
          return true;
        }
      }
    }
    return false;
  }

  if ((key === 'ArrowRight' || key === 'ArrowDown') && fs.start === fragPlainText(fragEl).length) {
    // 片段尾：同块续页片段首
    if (k < list.length - 1) {
      const next = list[k + 1] as (typeof list)[number];
      focusAndSetCaret(next.pageIndex, fs.blockId, next.frag.fromLine, 0);
      return true;
    }
    // 块尾（模型文本穷尽）：跨到下一块首片段首
    const blockChar = fragmentCharToBlockChar(fs.fromLine, fs.start, loc.lineOffsets, cpl);
    if (blockChar >= blockTextLen(loc.docStart)) {
      const i = index.ordered.indexOf(loc);
      if (i >= 0 && i < index.ordered.length - 1) {
        const nextLoc = index.ordered[i + 1] as (typeof index.ordered)[number];
        const nextList = blockFragments(props.pages, nextLoc.blockId, nextLoc, cpl);
        const firstFrag = nextList[0];
        if (firstFrag !== undefined) {
          focusAndSetCaret(firstFrag.pageIndex, nextLoc.blockId, firstFrag.frag.fromLine, 0);
          return true;
        }
      }
    }
  }
  return false;
}

function onKeydown(e: Event): void {
  const ev = e as KeyboardEvent;
  if (!editableNow.value) return;
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
    const key = ev.key.toLowerCase();
    if (key === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      emit('history', 'undo');
      restorePending = true;
      return;
    }
    if ((key === 'z' && ev.shiftKey) || key === 'y') {
      ev.preventDefault();
      emit('history', 'redo');
      restorePending = true;
      return;
    }
  }
  const fragEl = fragElOf(ev.target);
  if (fragEl === null) return;
  if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    if (navigateAtEdge(ev.key, fragEl)) ev.preventDefault();
  }
}

/* ---------- 选区 → 模型同步（selectionchange） ---------- */

let lastSynced: { from: number; to: number } | null = null;

function syncSelectionToModel(): void {
  if (!editableNow.value) return;
  const editor = props.editor;
  const index = props.index;
  if (editor === null || index === null) return;
  const active = document.activeElement;
  const fragEl = active instanceof HTMLElement ? active.closest<HTMLElement>(FRAG_SELECTOR) : null;
  if (fragEl === null || rootRef.value?.contains(fragEl) !== true) return;
  const fs = fragSelection(fragEl);
  if (fs === null) return;
  const state = editor.editorState;
  const fromChar = fragmentCharToBlockChar(fs.fromLine, fs.start, index.byId.get(fs.blockId)?.lineOffsets, props.charsPerLine);
  const toChar = fragmentCharToBlockChar(fs.fromLine, fs.end, index.byId.get(fs.blockId)?.lineOffsets, props.charsPerLine);
  const loc = index.byId.get(fs.blockId);
  if (loc === undefined || fromChar < 0 || toChar < 0) return;
  const from = loc.contentStart + fromChar;
  const to = loc.contentStart + toChar;
  if (lastSynced !== null && lastSynced.from === from && lastSynced.to === to) return;
  if (state.selection.from === from && state.selection.to === to) {
    lastSynced = { from, to };
    return;
  }
  lastSynced = { from, to };
  if (applyFragmentSelection(editor, index, fs.blockId, fs.fromLine, fs.start, fs.end, props.charsPerLine)) {
    emit('sync');
  }
}

function onDocumentSelectionChange(): void {
  syncSelectionToModel();
}

function attachSelectionSync(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('selectionchange', onDocumentSelectionChange);
}

function detachSelectionSync(): void {
  if (typeof document === 'undefined') return;
  document.removeEventListener('selectionchange', onDocumentSelectionChange);
}

/* ---------- 重排后 caret 还原 ---------- */

watch(
  () => props.pages,
  () => {
    if (restorePending && editableNow.value) {
      restorePending = false;
      void nextTick(() => restoreCaretFromModel());
    }
  },
);
</script>

<template>
  <div ref="scrollerRef" class="bt-paged" @scroll="onScroll">
    <div ref="rootRef" class="bt-paged__track" :style="contentStyle">
      <div
        v-for="page in renderedPages"
        :key="page.index"
        class="bt-paged__slot"
        :style="{ top: `${page.top}px`, width: slotWidth, height: `${slotHeight}px` }"
      >
        <div
          class="bt-paged-page"
          :style="scaledFrameStyle"
          @beforeinput="onBeforeInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @paste="onPaste"
          @keydown="onKeydown"
        >
          <div class="bt-paged-page__flow">
            <div
              v-for="frag in page.frags"
              :key="frag.key"
              class="bt-paged-frag"
              :data-block-id="frag.blockId"
              :data-from-line="frag.fromLine"
              :data-line-count="frag.lineCount"
              :contenteditable="editableNow ? 'true' : 'false'"
              v-html="frag.html"
            ></div>
          </div>
          <footer class="bt-paged-page__no">{{ page.numberText }}</footer>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bt-paged {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bt-editor-stage, #dcd6c9);
}

.bt-paged__track {
  position: relative;
  width: 100%;
}

.bt-paged__slot {
  position: absolute;
  inset-inline: 0;
  margin-inline: auto;
}

.bt-paged-page {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  box-sizing: border-box;
  background: var(--bt-background, #faf8f4);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.16),
    0 6px 18px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.bt-paged-page__flow {
  outline: none;
}

.bt-paged-frag {
  outline: none;
}

.bt-paged-page__no {
  position: absolute;
  inset-inline: 0;
  bottom: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--bt-accent, #8c5a2b);
}
</style>
