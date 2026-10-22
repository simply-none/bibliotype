/**
 * H5 断点与单列骨架状态（A1 / A2 / A4 / A6 / B5）
 *
 * 宽度 < md（768px）视为 H5 单列骨架；三个开合状态分别对应左栏面板抽屉、
 * 「更多」菜单 sheet 与编辑态属性 sheet。吸附档位常量给 BtDrawer / BtSheet
 * 的 snapHeights 用——把手只在有档位时渲染，「能拖」这个信号本身也得给用户看到。
 * 与 tab 联动的 openMobileTab 等动作在 `use-aside-tabs` 组装。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { BT_BREAKPOINTS, useBreakpoint } from '@bibliotype/vue';

/** H5：属性检视器 sheet 的吸附档位（B5：半屏 / 全屏） */
export const MOBILE_INSPECTOR_SNAPS: readonly string[] = ['48vh', '92vh'];

/** H5：「更多」sheet 的吸附档位（P2） */
export const MOBILE_MENU_SNAPS: readonly string[] = ['52vh', '88vh'];

/** 断点探测与 H5 浮层开合状态 */
export function useMobileShell(): {
  breakpoint: ReturnType<typeof useBreakpoint>;
  mobileShell: ComputedRef<boolean>;
  mobileAsideOpen: Ref<boolean>;
  mobileMenuOpen: Ref<boolean>;
  mobileInspectorOpen: Ref<boolean>;
} {
  /** 断点探测（D1）：宽度 < md（768px）视为 H5 单列骨架 */
  const breakpoint = useBreakpoint();

  /** 是否走 H5 单列骨架（375–768px） */
  const mobileShell = computed(() => breakpoint.width.value < BT_BREAKPOINTS.md);

  /** H5：左栏面板抽屉（目录 / 搜索 / 书签 / 导入 / 句读） */
  const mobileAsideOpen = ref(false);

  /** H5：「更多」菜单 sheet（全局动作 + 底栏次要控件） */
  const mobileMenuOpen = ref(false);

  /** H5：编辑态属性检视器 sheet */
  const mobileInspectorOpen = ref(false);

  return { breakpoint, mobileShell, mobileAsideOpen, mobileMenuOpen, mobileInspectorOpen };
}
