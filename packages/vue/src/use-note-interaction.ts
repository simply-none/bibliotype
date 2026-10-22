/**
 * 注释交互组合式（D9）
 *
 * 阅读器里的注文与注码都是 `v-html` 注入的 HTML 字符串，无法逐个挂 Vue 监听；
 * 本组合式在页容器上做**单点事件委托**（click / pointerover / focusin），命中：
 *
 * - `.bt-mark-noteref`：正文上标注码 → 跳注文并高亮；
 * - `.bt-note-backref` / `.bt-note-marker[data-note-ref]`：注文侧 → 回正文原句；
 * - 悬浮 / 聚焦注码：预览注文（触屏无 hover 时改为点击后预览）。
 *
 * 跨页跳转只读 Reader 的定位表（`getPageOfNote` / `getPageOfNoteRef`），
 * 不扫文档树；高亮计时单实例、时长可注入（测试不必真等待）。
 */
import { getCurrentScope, nextTick, onScopeDispose, ref, watch, type Ref } from 'vue';
import {
  collectNodeText,
  findNodeById,
  neighborNoteAnchor,
  type Reader,
} from '@bibliotype/reader';

/** 预览浮层状态 */
export interface NotePreviewState {
  /** 注释 id */
  noteId: string;
  /** 预览文本（纯文本，组件按文本渲染，不解析 HTML） */
  text: string;
  /** 触发元素（浮层定位锚点） */
  anchor: HTMLElement;
}

/** useNoteInteraction 入参 */
export interface UseNoteInteractionOptions {
  /** 阅读器 */
  reader: Reader;
  /** 请求翻页（不传则直接调用 `reader.goToPage`；组件可注入以同步滚动容器） */
  onRequestPage?: (pageIndex: number) => boolean;
  /**
   * 流式阅读定位钩子（D5）
   *
   * 流式模式没有分页结果，`getPageOfNote` 取不到页码。宿主传入后，`goToNote`
   * 在「注释元素尚未挂载」时优先调用它，由宿主挂载目标块并把元素滚入视口；
   * 返回 `true` 表示已发起定位（渲染后继续高亮），`false` / 不传则回落既有分页逻辑。
   */
  onLocateNode?: (nodeId: string) => boolean;
  /** 单次高亮时长（ms，缺省 2000） */
  highlightMs?: number;
  /** 悬浮预览延迟（ms，缺省 180） */
  previewDelayMs?: number;
  /** 点击触发的预览自动收起时长（ms，缺省 4000；悬浮预览随指针离开收起） */
  previewHideMs?: number;
}

/** useNoteInteraction 返回值 */
export interface UseNoteInteraction {
  /** 当前激活注释 id（双向高亮用；null = 无） */
  activeNoteId: Ref<string | null>;
  /** 当前预览（null = 未显示） */
  preview: Ref<NotePreviewState | null>;
  /** 绑定页容器（page / scroll 两种模式的根元素都要绑） */
  attach: (element: Element | null) => void;
  /** click 委托 */
  onClick: (event: MouseEvent) => void;
  /** pointerover 委托 */
  onPointerOver: (event: Event) => void;
  /** pointerout 委托 */
  onPointerOut: (event: Event) => void;
  /** focusin 委托（键盘用户） */
  onFocusIn: (event: FocusEvent) => void;
  /** focusout 委托 */
  onFocusOut: (event: FocusEvent) => void;
  /** 键盘：Alt+←/→ 切换注释、Esc 关闭预览；返回是否已消费 */
  handleKeydown: (event: KeyboardEvent) => boolean;
  /** 关闭预览 */
  closePreview: () => void;
  /** 跳转到注释并高亮（跨页自动翻页） */
  goToNote: (noteId: string) => boolean;
  /** 回到注引用原句并高亮（跨页自动翻页） */
  goToRef: (refId: string, noteId?: string) => boolean;
  /** 上一条 / 下一条注释（循环） */
  stepNote: (direction: 1 | -1) => boolean;
  /** 清除高亮 */
  clearActive: () => void;
}

const NOTEREF_SELECTOR = '.bt-mark-noteref';
const BACKREF_SELECTOR = '.bt-note-backref';
const MARKER_SELECTOR = '.bt-note-marker[data-note-ref]';
/** 高亮态类名（样式在 `buildBookCss` 的 `.bt-note-active` 规则里） */
export const NOTE_ACTIVE_CLASS = 'bt-note-active';

/** 属性选择器值转义（注释 id 可能是树路径，含 `/`；仍需防引号 / 反斜杠） */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** `#target` → `target`（接受空值与无 `#` 前缀） */
function stripHash(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return '';
  return value.charAt(0) === '#' ? value.slice(1) : value;
}

/** 从事件目标向上找命中选择器的最外层元素 */
function closest(target: EventTarget | null, selector: string): HTMLElement | null {
  if (target === null || typeof target !== 'object') return null;
  const element = target as Element;
  if (typeof element.closest !== 'function') return null;
  return element.closest(selector) as HTMLElement | null;
}

/** 当前环境是否无悬浮能力（触屏）：此时预览改由点击触发 */
function isHoverless(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none)').matches;
}

/**
 * 创建注释交互
 *
 * @param options 见 {@link UseNoteInteractionOptions}
 */
export function useNoteInteraction(options: UseNoteInteractionOptions): UseNoteInteraction {
  const {
    reader,
    onRequestPage,
    onLocateNode,
    highlightMs = 2000,
    previewDelayMs = 180,
    previewHideMs = 4000,
  } = options;
  const activeNoteId = ref<string | null>(null);
  const preview = ref<NotePreviewState | null>(null);
  let container: Element | null = null;
  let highlighted: Element[] = [];
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (highlightTimer !== undefined) clearTimeout(highlightTimer);
    highlightTimer = undefined;
  };

  const cancelPreviewTimer = (): void => {
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    previewTimer = undefined;
  };

  /** 悬浮预览的自动收起计时（点击触发时使用） */
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const closePreview = (): void => {
    cancelPreviewTimer();
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    preview.value = null;
  };

  const clearActive = (): void => {
    clearTimer();
    for (const element of highlighted) element.classList.remove(NOTE_ACTIVE_CLASS);
    highlighted = [];
    activeNoteId.value = null;
  };

  const attach = (element: Element | null): void => {
    if (container === element) return;
    clearActive();
    closePreview();
    container = element;
  };

  const findNoteElement = (noteId: string): HTMLElement | null => {
    if (container === null) return null;
    return container.querySelector(`[data-note-id="${escapeAttr(noteId)}"]`) as HTMLElement | null;
  };

  const findRefElement = (refId: string): HTMLElement | null => {
    if (container === null) return null;
    return container.querySelector(`[id="${escapeAttr(refId)}"]`) as HTMLElement | null;
  };

  /** 特性检测：happy-dom / 旧内核没有 scrollIntoView */
  const scrollTo = (element: Element | null): void => {
    if (element === null) return;
    const target = element as HTMLElement;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center' });
    }
  };

  /** 给注文条目与对应正文注码同时加高亮 */
  const activate = (noteId: string): void => {
    clearActive();
    if (container !== null) {
      const notes = container.querySelectorAll(`[data-note-id="${escapeAttr(noteId)}"]`);
      const refs = container.querySelectorAll(`[href="#${escapeAttr(noteId)}"]`);
      highlighted = [...Array.from(notes), ...Array.from(refs)];
    }
    for (const element of highlighted) element.classList.add(NOTE_ACTIVE_CLASS);
    activeNoteId.value = noteId;
    highlightTimer = setTimeout(clearActive, highlightMs);
  };

  /** 单侧高亮（回跳时同时高亮原句与注码） */
  const activateElement = (element: HTMLElement, noteId?: string): void => {
    if (noteId !== undefined) {
      activate(noteId);
    } else {
      clearActive();
      highlighted = [element];
      element.classList.add(NOTE_ACTIVE_CLASS);
      highlightTimer = setTimeout(clearActive, highlightMs);
    }
    scrollTo(element);
  };

  /** 注释纯文本：DOM 优先（含续注片段），缺省回退 IR 节点 */
  const resolveNoteText = (noteId: string): string => {
    const element = findNoteElement(noteId);
    if (element !== null) {
      const text = extractNoteText(element);
      if (text !== '') return text;
    }
    const doc = reader.document;
    if (doc === undefined) return '';
    const node = findNodeById(doc.root, noteId);
    return node === undefined ? '' : collectNodeText(node).trim();
  };

  const showPreview = (trigger: HTMLElement, noteId: string, autoHide = false): void => {
    const text = resolveNoteText(noteId);
    if (text === '') return;
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    preview.value = { noteId, text, anchor: trigger };
    if (autoHide) {
      // 触屏没有「移出」事件：给点击触发的预览一个兜底收起时长
      hideTimer = setTimeout(() => closePreview(), previewHideMs);
    }
  };

  /** 翻页后等 DOM 更新再定位（页模式下目标页此时才渲染） */
  const afterRender = (run: () => void): void => {
    void nextTick(() => {
      run();
    });
  };

  const goToPage = (pageIndex: number): void => {
    if (onRequestPage !== undefined) {
      onRequestPage(pageIndex);
      return;
    }
    reader.goToPage(pageIndex);
  };

  const goToNote = (noteId: string): boolean => {
    const inPage = findNoteElement(noteId);
    if (inPage !== null) {
      activate(noteId);
      scrollTo(inPage);
      return true;
    }
    // 流式阅读：注释元素尚未挂载时，交给宿主挂载目标块并滚入视口
    if (onLocateNode?.(noteId) === true) {
      afterRender(() => {
        const element = findNoteElement(noteId);
        if (element !== null) {
          activate(noteId);
          scrollTo(element);
        }
      });
      return true;
    }
    const page = reader.getPageOfNote(noteId) ?? reader.getPageOfNode(noteId);
    if (page === undefined) return false;
    // 目标页尚未渲染：先记下当前注释（连续快捷键 / 上一条下一条据此续接），
    // 渲染完成后再补高亮与滚动
    activeNoteId.value = noteId;
    goToPage(page);
    afterRender(() => {
      // 注文未随页渲染（如宿主只渲染正文）时仍高亮正文注码，保证「点了一定有反馈」
      activate(noteId);
      scrollTo(findNoteElement(noteId));
    });
    return true;
  };

  const goToRef = (refId: string, noteId?: string): boolean => {
    const inPage = findRefElement(refId);
    if (inPage !== null) {
      activateElement(inPage, noteId);
      return true;
    }
    const page = reader.getPageOfNoteRef(refId);
    if (page === undefined) return false;
    goToPage(page);
    afterRender(() => {
      const element = findRefElement(refId);
      if (element !== null) activateElement(element, noteId);
    });
    return true;
  };

  const stepNote = (direction: 1 | -1): boolean => {
    const anchor = neighborNoteAnchor(
      reader.getNoteAnchors(),
      activeNoteId.value ?? undefined,
      direction,
    );
    if (anchor === undefined) return false;
    return goToNote(anchor.noteId);
  };

  const onClick = (event: MouseEvent): void => {
    const noteref = closest(event.target, NOTEREF_SELECTOR);
    if (noteref !== null) {
      const targetId = stripHash(noteref.getAttribute('href'));
      if (targetId === '') return;
      event.preventDefault();
      // 触屏无 hover：再点同一个注码收起预览（点按切换，A5）
      if (
        isHoverless() &&
        preview.value !== null &&
        preview.value.noteId === targetId &&
        preview.value.anchor === noteref
      ) {
        closePreview();
        return;
      }
      const found = goToNote(targetId);
      // 触屏无 hover：点击后直接预览，避免用户只有「跳过去」没有「读到注文」
      if (found && isHoverless()) showPreview(noteref, targetId, true);
      return;
    }

    const backref = closest(event.target, BACKREF_SELECTOR);
    if (backref !== null) {
      const refId = stripHash(backref.getAttribute('href'));
      if (refId === '') return;
      event.preventDefault();
      goToRef(refId, closest(event.target, '[data-note-id]')?.getAttribute('data-note-id') ?? undefined);
      return;
    }

    const marker = closest(event.target, MARKER_SELECTOR);
    if (marker !== null) {
      const refId = marker.getAttribute('data-note-ref') ?? '';
      if (refId === '') return;
      event.preventDefault();
      const noteId = closest(event.target, '[data-note-id]')?.getAttribute('data-note-id') ?? undefined;
      goToRef(refId, noteId);
    }
  };

  const onPointerOver = (event: Event): void => {
    const noteref = closest(event.target, NOTEREF_SELECTOR) ?? closest(event.target, MARKER_SELECTOR);
    if (noteref === null) return;
    const noteId =
      stripHash(noteref.getAttribute('href')) ||
      stripHash(noteref.getAttribute('data-note-ref'));
    if (noteId === '') return;
    cancelPreviewTimer();
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      showPreview(noteref, noteId);
    }, previewDelayMs);
  };

  const onPointerOut = (event: Event): void => {
    const trigger = closest(event.target, NOTEREF_SELECTOR) ?? closest(event.target, MARKER_SELECTOR);
    if (trigger === null) return;
    const next = (event as PointerEvent).relatedTarget;
    if (next instanceof Node && trigger.contains(next)) return;
    cancelPreviewTimer();
    if (preview.value !== null && preview.value.anchor === trigger) closePreview();
  };

  const onFocusIn = (event: FocusEvent): void => {
    const noteref = closest(event.target, NOTEREF_SELECTOR);
    if (noteref === null) return;
    cancelPreviewTimer();
    const noteId = stripHash(noteref.getAttribute('href'));
    if (noteId !== '') showPreview(noteref, noteId);
  };

  const onFocusOut = (event: FocusEvent): void => {
    const noteref = closest(event.target, NOTEREF_SELECTOR);
    if (noteref === null) return;
    if (preview.value !== null && preview.value.anchor === noteref) closePreview();
  };

  const handleKeydown = (event: KeyboardEvent): boolean => {
    if (event.key === 'Escape' && preview.value !== null) {
      event.preventDefault();
      closePreview();
      return true;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
    const found = stepNote(event.key === 'ArrowRight' ? 1 : -1);
    if (found) event.preventDefault();
    return found;
  };

  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      clearActive();
      cancelPreviewTimer();
      if (hideTimer !== undefined) clearTimeout(hideTimer);
      hideTimer = undefined;
      unbindOutsideClose();
    });
  }

  /**
   * 触屏：点击卡片外区域关闭预览（A5）
   *
   * 捕获阶段检查，避免与页面自身的 click 逻辑抢顺序；点在同一注码上不关闭——
   * 由 `onClick` 做「再点收起」的切换。
   */
  const onDocClick = (event: MouseEvent): void => {
    if (preview.value === null) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (preview.value.anchor.contains(target)) return;
    if (
      closest(event.target, NOTEREF_SELECTOR) !== null ||
      closest(event.target, MARKER_SELECTOR) !== null
    ) {
      return;
    }
    closePreview();
  };

  let outsideBound = false;
  function bindOutsideClose(): void {
    if (outsideBound || typeof document === 'undefined') return;
    document.addEventListener('click', onDocClick, true);
    outsideBound = true;
  }
  function unbindOutsideClose(): void {
    if (!outsideBound || typeof document === 'undefined') return;
    document.removeEventListener('click', onDocClick, true);
    outsideBound = false;
  }

  // 只在「触屏 + 预览可见」时挂外部点击监听，桌面悬浮预览仍由指针移出收起
  watch(preview, (value) => {
    if (value !== null && isHoverless()) bindOutsideClose();
    else unbindOutsideClose();
  });

  return {
    activeNoteId,
    preview,
    attach,
    onClick,
    onPointerOver,
    onPointerOut,
    onFocusIn,
    onFocusOut,
    handleKeydown,
    closePreview,
    goToNote,
    goToRef,
    stepNote,
    clearActive,
  };
}

/** 提取注文纯文本：跳过注码与回跳符号（只留注文正文） */
function extractNoteText(element: Element): string {
  let text = '';
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      text += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.classList.contains('bt-note-marker') || el.classList.contains('bt-note-backref')) return;
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(element);
  return text.replace(/\s+/g, ' ').trim();
}
