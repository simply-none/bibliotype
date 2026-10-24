/**
 * 编辑会话：编辑 ↔ 回写预览、脏标记 + 自动保存、启动草稿与文档导入
 *
 * 编辑 → 回写预览：进入编辑惰性创建 BookEditor（古籍 schema + 修订追踪插件），
 * 「保存并预览」落盘并回写 Reader 全链路重排后返回阅读；位置记忆按分页三端同源
 * 对齐页码。脏标记与自动保存走 useDraftAutosave（节流合并 + 空闲落盘 + 单飞去重）。
 *
 * 跨块依赖（reader 实例、文档版本号、样式作用域、重排调度、消息条）经参数注入，
 * 由 App.vue 组装；本块不反向 import App 或其它块，保持单向依赖。
 */
import { computed, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { normalizeGlyphImages, type BookDocument } from '@bibliotype/core';
import {
  buildClassicalEditorSchema,
} from '@bibliotype/classical/editor';
import { BookEditor, createBookEditorPlugins, createRevisionTrackingPlugin } from '@bibliotype/editor';
import { IndexedDbAdapter } from '@bibliotype/adapter-indexeddb';
import { Reader } from '@bibliotype/reader';
import { BtEditor, type EditorBinding } from '@bibliotype/vue';
import { useDraftAutosave } from './use-draft-autosave.js';
import type { StyleSettingsApi } from './use-style-settings.js';
import type { useToast } from './use-toast.js';
import { lunyuDocument } from '../data/lunyu.js';
import { LUNYU_BOOK_ID } from './use-layout-tokens.js';
import { bookIdFromTitle } from './use-settings-snapshot.js';

/** 草稿记录 id（Demo 单文档，固定键） */
const DRAFT_ID = 'current';

export interface EditSessionDeps {
  reader: ShallowRef<Reader>;
  bookVersion: Ref<number>;
  styleApi: StyleSettingsApi;
  currentBookId: Ref<string>;
  scheduleRemeasure: () => void;
  pushToast: ReturnType<typeof useToast>['push'];
}

/** 编辑模式状态、自动保存与文档往返 */
export function useEditSession(deps: EditSessionDeps) {
  const { reader, bookVersion, styleApi, currentBookId, scheduleRemeasure, pushToast } = deps;

  /** 当前界面模式：阅读 / 编辑 */
  const mode = ref<'read' | 'edit'>('read');

  /** 编辑器实例（首次进入编辑模式时惰性创建，之后复用） */
  const bookEditor = shallowRef<BookEditor | null>(null);

  /** BtEditor 组件实例（编辑态目录跳转等命令入口） */
  const btEditorRef = ref<InstanceType<typeof BtEditor> | null>(null);

  /** 书库抽屉是否展开（书架 / 备份 / 加密 / 修订 / 版本） */
  const libraryOpen = ref(false);

  /** 编辑画布是否只读（单一真相源为 editing.readonly，持久化；本计算只读不写） */
  const editorReadonly = computed(() => styleApi.editing.value.readonly === true);

  /** 编辑态视口页（PagedCanvas 回写；「保存并预览」时回定位到阅读该页，自 0 起） */
  const editorVisiblePage = ref(0);
  /** 进编辑时的定位页（阅读模式当前页；BtEditor 首轮分页就绪后滚到此页） */
  const editStartPage = ref(0);

  /** 草稿存储适配器：本地 IndexedDB 持久化（库 / 仓名与正式文档库区分） */
  const draftStore = new IndexedDbAdapter({
    databaseName: 'bibliotype-demo',
    storeName: 'drafts',
  });

  /**
   * 自动保存调度器（策略见 use-draft-autosave）：
   * 节流合并 + 空闲落盘 + 单飞去重——序列化与整本写入都不落在输入帧上。
   */
  const autosave = useDraftAutosave({
    editor: () => bookEditor.value,
    store: draftStore,
    id: DRAFT_ID,
  });

  /** 是否存在未保存变更（镜像 editor.isDirty，供工具栏展示） */
  const dirty = autosave.dirty;
  /** 最近一次成功落盘时刻（本地时间串；null 表示本次会话未成功落盘过） */
  const savedAt = autosave.savedAt;
  /** 是否正在落盘（工具栏展示「保存中…」） */
  const saving = autosave.saving;
  /** 最近一次落盘是否失败（配额 / 环境不支持时保持未保存并重试） */
  const saveFailed = autosave.failed;

  /** 保存状态文案（失败 > 写入中 > 未保存 > 已保存时刻） */
  const saveStatusText = computed<string>(() => {
    if (saveFailed.value) return '保存失败，重试中';
    if (saving.value) return '保存中…';
    if (dirty.value) return '● 未保存';
    return savedAt.value === null ? '已保存' : `已保存 ${savedAt.value}`;
  });

  /** 编辑器变更取消订阅句柄（卸载时清理） */
  let unsubscribeEditor: (() => void) | null = null;

  /** 编辑器变更回调：同步脏标记并调度一轮合并落盘（决策与时限在 autosave 内） */
  function onEditorChange(): void {
    autosave.schedule();
  }

  /** 立即落盘（Ctrl/Cmd+S）：跳过挂起调度，写一轮并刷新状态 */
  async function saveNow(): Promise<void> {
    await autosave.flush();
  }

  /** 读取本地草稿（IndexedDB 异步；无 / 读取失败回 null） */
  async function readDraft(): Promise<BookDocument | null> {
    try {
      const draft = await draftStore.load(DRAFT_ID);
      if (draft === undefined) return null;
      /* 字图归一化（K6 补口）：旧会话草稿可能仍把缺字图存成块级插图，
       * 恢复时自动归并（幂等）；进入编辑器后 autosave 落盘新基线 */
      return normalizeGlyphImages(draft).document;
    } catch {
      return null;
    }
  }

  /** 清除本地草稿（IndexedDB 删除记录） */
  async function clearDraft(): Promise<void> {
    try {
      await draftStore.delete(DRAFT_ID);
    } catch {
      /* 忽略 */
    }
  }

  /** 从书库打开一本书：阅读器与编辑器同步换文档 */
  function onLibraryBook(document: BookDocument): void {
    reader.value.loadDocument(document);
    bookVersion.value += 1;
    bookEditor.value?.loadDocument(document);
    pushToast(`已打开《${document.metadata.title}》`, 'success');
  }

  /** 进入编辑模式：以草稿（若有）或当前阅读文档 + 古籍 schema 创建编辑器（惰性） */
  async function enterEdit(): Promise<void> {
    if (bookEditor.value === null) {
      const schema = buildClassicalEditorSchema();
      const draft = await readDraft();
      bookEditor.value = new BookEditor({
        schema,
        document: draft ?? reader.value.document ?? lunyuDocument,
        plugins: [
          ...createBookEditorPlugins(schema),
          // 修订追踪默认关闭，由「书库 → 修订」页签开启（C5）
          createRevisionTrackingPlugin({ author: 'demo' }),
        ],
      });
      unsubscribeEditor = bookEditor.value.onChange(onEditorChange);
      dirty.value = bookEditor.value.isDirty;
    }
    mode.value = 'edit';
    styleApi.patchEditingDirect({ readonly: false });
    // 位置记忆：进编辑定位到阅读模式当前页（分页三端同源，页码可直接对齐）
    editStartPage.value = reader.value.currentPage;
    editorVisiblePage.value = editStartPage.value;
    // 进编辑前重测（编辑器由当前阅读文档创建，块 id 对齐 → 分页线与预览一致）
    scheduleRemeasure();
  }

  /** 保存并预览：编辑产物落盘 + 回写 Reader（全链路重排，页码重算）并返回阅读 */
  function saveAndPreview(): void {
    const editor = bookEditor.value;
    if (editor === null) return;
    reader.value.loadDocument(editor.getDocument());
    // 文档（含元数据）变更 → 顶部书名等派生值重新取值
    bookVersion.value += 1;
    // 位置记忆：回定位到编辑退出时的视口页（新文档页数可能变少，限幅后再跳）
    const target = Math.min(editorVisiblePage.value, reader.value.totalPages - 1);
    if (target >= 0) reader.value.goToPage(target);
    // 取消挂起的合并落盘并立即写一轮（不等待：退出编辑的界面响应优先）
    void autosave.flush();
    mode.value = 'read';
    // 文档变更 → 重测新文档块尺寸（旧 id 映射对新文档不适用）
    scheduleRemeasure();
  }

  /**
   * 切换书籍：先把当前书已提交的配置落盘（flush 用的是切换前的 bookScope），
   * 再切到新书 id 并载入其设置、应用到画布（布局 / 令牌 / 功能样式随之更新）。
   */
  async function switchBook(newId: string): Promise<void> {
    await styleApi.flush();
    currentBookId.value = newId;
    await styleApi.load();
    scheduleRemeasure();
  }

  /** 还原样册：编辑器内容重置为原始样例并清除草稿 */
  async function resetSample(): Promise<void> {
    autosave.reset();
    bookEditor.value?.loadDocument(lunyuDocument);
    void clearDraft();
    // 还原样册 = 回到《论语》，切回其设置作用域并重新载入
    await switchBook(LUNYU_BOOK_ID);
  }

  /** 导入文档：载入阅读预览，若编辑器已建则同步内容（loadDocument 重置脏基准），并落盘草稿 + 重排 */
  async function onImported(doc: BookDocument): Promise<void> {
    reader.value.loadDocument(doc);
    // 新文档（含元数据）载入 → 顶部书名等派生值重新取值
    bookVersion.value += 1;
    if (bookEditor.value === null) {
      // 编辑器尚未创建（进入编辑模式才惰性创建）：autosave 只能序列化已存在的编辑器，
      // 若此处不落盘，enterEdit 从 IndexedDB 读到的仍是导入前的旧草稿，编辑区标题与正文
      // 会显示成旧书。故导入书直接作为草稿基线写入，确保惰性创建的编辑器载入的是新书。
      dirty.value = false;
      await draftStore.save(DRAFT_ID, doc);
    } else {
      bookEditor.value.loadDocument(doc);
      dirty.value = bookEditor.value.isDirty;
      // 新内容立即落盘（导入即新基线；跳过「无待写」判定）
      void autosave.flush({ force: true });
    }
    // 切到导入书的设置作用域（落盘旧书设置 + 载入新书设置并应用）
    await switchBook(bookIdFromTitle(doc.metadata.title));
    scheduleRemeasure();
  }

  /** 主工具栏「编辑 / 保存并预览」双向切换 */
  function toggleEditMode(): void {
    if (mode.value === 'read') {
      void enterEdit();
    } else {
      saveAndPreview();
    }
  }

  /** 捕获 BtEditor 默认插槽透传的 paged 感知 binding（供右栏属性检视器） */
  const slotBinding = shallowRef<EditorBinding | null>(null);
  /** 插槽渲染计数（非响应式；仅用于识别「首轮捕获」，避免逐事务重渲染） */
  let slotRenderCount = 0;
  function captureSlotBinding(binding: EditorBinding): EditorBinding {
    slotRenderCount += 1;
    if (slotBinding.value === null && slotRenderCount === 1) {
      // 首次捕获：同步递增 version 让消费它的 computed 失效（仅在 null→有值时发生一次）
      binding.version.value += 1;
    }
    slotBinding.value = binding;
    return binding;
  }

  /**
   * 右栏检视器用的 binding
   *
   * 仅「未捕获 → 已捕获」一次切换会重渲染主区（slot 内容随之重建）；
   * 之后逐事务只走 version 自增，由 AttrInspector 内部 computed 自行响应。
   */
  const inspectorBinding = computed<EditorBinding | null>(() => {
    if (slotBinding.value === null && mode.value === 'edit') {
      void slotRenderCount; // 占位依赖：首次捕获前的空读不再触发额外逻辑
    }
    return mode.value === 'edit' ? slotBinding.value : null;
  });

  /** 卸载清理：退订编辑器变更、等在飞落盘结束后关库（避免打断正在提交的事务） */
  function teardown(): void {
    unsubscribeEditor?.();
    unsubscribeEditor = null;
    void autosave
      .dispose()
      .then(() => draftStore.close())
      .catch(() => undefined);
  }

  return {
    mode,
    bookEditor,
    btEditorRef,
    libraryOpen,
    editorReadonly,
    editorVisiblePage,
    editStartPage,
    draftStore,
    autosave,
    dirty,
    savedAt,
    saving,
    saveFailed,
    saveStatusText,
    saveNow,
    readDraft,
    clearDraft,
    onLibraryBook,
    onEditorChange,
    enterEdit,
    saveAndPreview,
    switchBook,
    resetSample,
    onImported,
    toggleEditMode,
    slotBinding,
    captureSlotBinding,
    inspectorBinding,
    teardown,
  };
}

export type EditSessionApi = ReturnType<typeof useEditSession>;
