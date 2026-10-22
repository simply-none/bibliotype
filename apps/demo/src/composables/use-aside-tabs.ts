/**
 * 左栏标签面板与弹窗开合
 *
 * 左栏面板（目录 / 搜索 / 书签 / 导入 / 句读）同屏仅一个（参照 Apple Books /
 * Calibre），顶栏按钮即 tab 入口，再点收起；设置 / 书籍信息为模态弹窗。
 * H5 下同一份内容收进抽屉，从「更多」菜单 / 底栏打开时先定 tab 再开抽屉。
 * inspectorCollapsed 源状态由 App 持有（供界面偏好快照共享），折叠时经注入的
 * persistSettingsSnapshot 落盘。
 */
import { computed, ref, type Ref } from 'vue';
import type { AppIconName } from '../app-icons.js';
import type { StyleSettingsApi } from './use-style-settings.js';

/** 左栏标签面板（同屏仅一个；null = 整栏收起） */
export type AsideTab = 'toc' | 'search' | 'bookmarks' | 'import' | 'suggestions';

/** 顶栏 tab 入口（顺序与左栏面板一致；「句读」仅编辑模式可见；icon 供 H5 sheet 行） */
export const ASIDE_TABS: ReadonlyArray<{ key: AsideTab; label: string; icon: AppIconName }> = [
  { key: 'toc', label: '目录', icon: 'toc' },
  { key: 'search', label: '搜索', icon: 'search' },
  { key: 'bookmarks', label: '书签', icon: 'bookmark' },
  { key: 'import', label: '导入', icon: 'upload' },
  { key: 'suggestions', label: '句读', icon: 'edit' },
];

export interface AsideTabsDeps {
  styleApi: StyleSettingsApi;
  mobileAsideOpen: Ref<boolean>;
  mobileMenuOpen: Ref<boolean>;
  mobileInspectorOpen: Ref<boolean>;
  inspectorCollapsed: Ref<boolean>;
  persistSettingsSnapshot: () => void;
}

/** 面板 tab 与弹窗 / 属性栏折叠的开合状态 */
export function useAsideTabs(deps: AsideTabsDeps) {
  const { styleApi, mobileAsideOpen, mobileMenuOpen, mobileInspectorOpen, inspectorCollapsed } = deps;

  const activeTab = ref<AsideTab | null>('toc');

  /** 顶栏 tab 入口：点已开项即收起，否则切换 */
  function toggleTab(tab: AsideTab): void {
    activeTab.value = activeTab.value === tab ? null : tab;
  }

  /**
   * H5：从「更多」菜单 / 底栏打开面板（A1 / A4）
   *
   * 先定 tab 再开抽屉：抽屉内容由同一份 `AsidePanels` 渲染，`activeTab`
   * 为 null 时没有可渲染的面板，所以两者必须一起切换。
   */
  function openMobileTab(tab: AsideTab): void {
    activeTab.value = tab;
    mobileAsideOpen.value = true;
    mobileMenuOpen.value = false;
  }

  /** H5：打开编辑态属性 sheet（B5，默认落在半屏档，拖拽把手上拉全屏） */
  function openMobileInspector(): void {
    mobileInspectorOpen.value = true;
  }

  /** H5「更多」菜单：先收起 sheet 再执行动作（避免与新弹窗叠层） */
  function onMobileAction(action: () => void): void {
    mobileMenuOpen.value = false;
    action();
  }

  /** 当前面板标题（H5 抽屉标题栏；无选中面板时回退「面板」） */
  const activeTabLabel = computed(
    () => ASIDE_TABS.find((tab) => tab.key === activeTab.value)?.label ?? '面板',
  );

  const settingsOpen = ref(false);
  const infoOpen = ref(false);

  /** 关闭设置弹窗：未保存的草稿改动直接丢弃（仅「保存」才生效） */
  function closeSettings(): void {
    settingsOpen.value = false;
    styleApi.discardDraft();
  }

  /** 切换属性栏折叠并落盘 */
  function toggleInspector(): void {
    inspectorCollapsed.value = !inspectorCollapsed.value;
    deps.persistSettingsSnapshot();
  }

  /** 左栏是否可见（有任一 tab 激活；设置 / 书籍信息为弹窗不占左栏） */
  const asideVisible = computed(() => activeTab.value !== null);

  return {
    activeTab,
    toggleTab,
    openMobileTab,
    openMobileInspector,
    onMobileAction,
    activeTabLabel,
    settingsOpen,
    infoOpen,
    closeSettings,
    toggleInspector,
    asideVisible,
  };
}

export type AsideTabsApi = ReturnType<typeof useAsideTabs>;
