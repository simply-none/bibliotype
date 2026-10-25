/**
 * 界面皮肤状态（美化 P0 / P4）
 *
 * 皮肤 / 密度 / 动效 / 滚动条样式只决定壳层观感，与阅读纸面主题正交；夜间纸面（night）
 * 由主题块持有，深色皮肤联动点亮夜间。各开关落到 <html> data-*，
 * 抽屉 / 设置 / 书籍信息等 Teleport 到 body 的浮层因此共用同一套壳色令牌。
 */
import { computed, ref, watchEffect, type ComputedRef, type Ref } from 'vue';
import {
  DEFAULT_SCROLLBAR_STYLE,
  DEFAULT_UI_DENSITY,
  DEFAULT_UI_MOTION,
  DEFAULT_UI_SKIN,
  resolveUiSkin,
  type ScrollbarStyleKey,
  type UiDensity,
  type UiMotion,
  type UiSkin,
  type UiSkinKey,
} from '../ui-skin.js';

/** 皮肤 / 密度 / 动效 / 滚动条样式状态与 <html> 同步 */
export function useAppSkin(deps: { night: Ref<boolean> }): {
  uiSkin: Ref<UiSkinKey>;
  uiDensity: Ref<UiDensity>;
  uiMotion: Ref<UiMotion>;
  scrollbarStyle: Ref<ScrollbarStyleKey>;
  activeSkin: ComputedRef<UiSkin>;
  setUiSkin: (next: UiSkinKey) => void;
} {
  /** 界面皮肤：只决定壳层观感，与阅读纸面主题正交 */
  const uiSkin = ref<UiSkinKey>(DEFAULT_UI_SKIN);
  /** 界面密度：只缩间距与行高，不动字号与 44px 触控目标 */
  const uiDensity = ref<UiDensity>(DEFAULT_UI_DENSITY);
  /** 动效偏好：auto 跟随系统，off 显式关闭 */
  const uiMotion = ref<UiMotion>(DEFAULT_UI_MOTION);
  /** 滚动条样式（墨线 / 卷轴 / 竹简）：只改滚动条观感 */
  const scrollbarStyle = ref<ScrollbarStyleKey>(DEFAULT_SCROLLBAR_STYLE);

  /** 当前皮肤元数据（预览色 / 深色判定 / theme-color 同步） */
  const activeSkin = computed(() => resolveUiSkin(uiSkin.value));

  /**
   * 皮肤 / 密度 / 动效 / 夜间落到 <html>
   *
   * 挂在文档根而非 `.app`：抽屉、设置、书籍信息都 Teleport 到 body，
   * 只有根上的令牌才能穿过传送门；`data-night` 只供样式做纸张微调，
   * 壳色永远由 `data-skin` 唯一决定（避免夜间开关把皮肤染回深色）。
   * 同步写 `meta[name=theme-color]`：手机浏览器的地址栏 / 状态栏跟随壳色，
   * 不会再出现“黑壳 + 白顶栏”的裂缝。
   */
  watchEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.skin = uiSkin.value;
    root.dataset.density = uiDensity.value;
    root.dataset.motion = uiMotion.value;
    root.dataset.scrollbar = scrollbarStyle.value;
    root.dataset.night = deps.night.value ? 'true' : 'false';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta instanceof HTMLMetaElement) meta.content = activeSkin.value.preview.canvas;
  });

  /**
   * 切皮肤
   *
   * 深色皮肤选中时联动夜间纸面（否则黑壳 + 白纸的对比会刺眼）；
   * 浅色皮肤不强行关夜间——用户可能就想白天用浅壳读深色纸。
   */
  function setUiSkin(next: UiSkinKey): void {
    uiSkin.value = next;
    if (resolveUiSkin(next).dark) deps.night.value = true;
  }

  return { uiSkin, uiDensity, uiMotion, scrollbarStyle, activeSkin, setUiSkin };
}
