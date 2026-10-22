/**
 * 全局事件守卫：键盘、后台落盘与离开提示
 *
 * 键盘：编辑态 Ctrl/Cmd+S 立即落盘（拦截浏览器「保存网页」）；弹窗打开时 Esc 关闭
 * 且不外泄按键；仅阅读态 ← / → 翻页（编辑态方向键归编辑器）。后台 / pagehide /
 * 失焦触发落盘（把握能写完的时机，单飞去重不重复写库）；存在未保存变更离开页面前
 * 提示并尽力落盘一轮。处理器只读取各块状态、不注册监听（注册 / 清理由 App.vue 负责）。
 */
import { type Ref, type ShallowRef } from 'vue';
import { Reader } from '@bibliotype/reader';
import type { useDraftAutosave } from './use-draft-autosave.js';

export interface LifecycleDeps {
  mode: Ref<'read' | 'edit'>;
  infoOpen: Ref<boolean>;
  settingsOpen: Ref<boolean>;
  reader: ShallowRef<Reader>;
  saveNow: () => Promise<void>;
  closeSettings: () => void;
  autosave: ReturnType<typeof useDraftAutosave>;
  dirty: Ref<boolean>;
  scheduleRemeasure: () => void;
}

/** 全局键盘 / 可见性 / 卸载守卫处理器 */
export function useAppLifecycle(deps: LifecycleDeps) {
  const { mode, infoOpen, settingsOpen, reader, saveNow, closeSettings, autosave, dirty, scheduleRemeasure } =
    deps;

  function onKeydown(event: KeyboardEvent): void {
    /* 编辑模式 Ctrl/Cmd+S：立即落盘（拦截浏览器「保存网页」默认行为） */
    if (
      mode.value === 'edit' &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault();
      void saveNow();
      return;
    }
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (infoOpen.value) {
      if (event.key === 'Escape') infoOpen.value = false;
      return;
    }
    /* 设置弹窗为模态：Esc 关闭（丢弃未保存改动），其余按键不外泄（避免背景页被翻页） */
    if (settingsOpen.value) {
      if (event.key === 'Escape') closeSettings();
      return;
    }
    /* 编辑模式：← / → 交由编辑器移动光标，不翻页 */
    if (mode.value === 'edit') return;
    if (event.key === 'ArrowLeft') {
      reader.value.prevPage();
    } else if (event.key === 'ArrowRight') {
      reader.value.nextPage();
    }
  }

  /** 页面转入后台（切标签 / 最小化）：立即落盘，把握住真正能写完的时机 */
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') void autosave.flush();
  }

  /**
   * 页面被隐藏 / 回收前最后一次落盘（B6）
   *
   * 移动端 WebView 切应用、被系统回收时 `beforeunload` 经常不触发，
   * `pagehide` 才是最后能写完的时机；与 visibilitychange 同一套 flush，
   * 单飞去重保证不会重复写库。
   */
  function onPageHide(): void {
    void autosave.flush();
  }

  /** 从后台 / bfcache 返回：补一次重排（往返后视口尺寸可能已变） */
  function onPageShow(): void {
    scheduleRemeasure();
  }

  /** 窗口失焦（软键盘收起 / 切应用）：作为一次节流保存触发点（B6） */
  function onWindowBlur(): void {
    if (mode.value === 'edit') autosave.schedule();
  }

  /** 存在未保存变更时离开页面提示（并尽力落盘一轮） */
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value) return;
    void autosave.flush();
    event.preventDefault();
    event.returnValue = '';
  }

  return { onKeydown, onVisibilityChange, onPageHide, onPageShow, onWindowBlur, onBeforeUnload };
}
