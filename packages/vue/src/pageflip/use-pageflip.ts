/**
 * 仿真翻页引擎（@bibliotype/page-flip）的 Vue 绑定：引擎 ↔ 组件接线。
 *
 * 职责：生命周期挂载 / 视口自适应 / 提供者切换 / 状态与 FPS 轮询 / 自动演示。
 * 页面内容（PageProvider）由调用方注入——本组合式不关心内容层。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { FlipController, type PageProvider } from '@bibliotype/page-flip';

/** 翻页内容提供者条目（key 用于切换，label 用于 UI 展示）。 */
export interface PageflipProviderEntry {
  key: string;
  label: string;
  provider: PageProvider;
}

export interface UsePageflipOptions {
  /** 内容提供者列表（至少一项，第一项为初始行款）。 */
  providers: PageflipProviderEntry[];
  /** 自动演示间隔（毫秒）。 */
  autoPlayIntervalMs?: number;
}

export function usePageflip(
  canvasRef: Ref<HTMLCanvasElement | null>,
  stageRef: Ref<HTMLElement | null>,
  options: UsePageflipOptions
) {
  const providers = options.providers;
  const providerKey = ref(providers[0].key);
  const currentPage = ref(0);
  const pageCount = ref(providers[0].provider.pageCount);
  const debug = ref(false);
  const fps = ref(0);
  const autoPlaying = ref(false);
  const error = ref('');
  const initialized = ref(false);

  let controller: FlipController | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let fpsTimer = 0;
  let autoTimer = 0;

  onMounted(() => {
    const canvas = canvasRef.value;
    const stage = stageRef.value;
    if (!canvas || !stage) {
      return;
    }
    try {
      controller = new FlipController(canvas, {
        onStateChange: (page) => {
          currentPage.value = page;
        },
      });
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return;
    }
    initialized.value = true;

    const applyViewport = (): void => {
      const rect = stage.getBoundingClientRect();
      controller?.setViewport(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    resizeObserver = new ResizeObserver(applyViewport);
    resizeObserver.observe(stage);
    applyViewport();

    const entry = providers.find((item) => item.key === providerKey.value) ?? providers[0];
    controller.setProvider(entry.provider);
    syncEngineState();

    fpsTimer = window.setInterval(() => {
      fps.value = controller?.fps ?? 0;
    }, 500);

    // 调试钩子（浏览器控制台 / 自动化测试用）
    (window as unknown as Record<string, unknown>).__pageflip = controller;
  });

  onBeforeUnmount(() => {
    stopAutoPlay();
    window.clearInterval(fpsTimer);
    resizeObserver?.disconnect();
    controller?.destroy();
    controller = null;
  });

  function switchProvider(key: string): void {
    if (key === providerKey.value || !controller) {
      return;
    }
    const entry = providers.find((item) => item.key === key);
    if (!entry) {
      return;
    }
    providerKey.value = key;
    controller.setProvider(entry.provider);
    syncEngineState();
  }

  /** 以引擎生效口径同步视图状态：viewMode 用引擎回退后的实际值（非 left
   *  装订自动回退单页）；双页 pageCount = ⌊面数/2⌋+1（末 spread 左侧孤页，
   *  与引擎 spreadCount 一致）。不再由组合式自行推算。 */
  function syncEngineState(): void {
    if (!controller) {
      return;
    }
    viewMode.value = controller.viewMode;
    const entry = providers.find((item) => item.key === providerKey.value) ?? providers[0];
    pageCount.value =
      controller.viewMode === 'spread' ? Math.floor(entry.provider.pageCount / 2) + 1 : entry.provider.pageCount;
    currentPage.value = controller.currentPage;
  }

  function toggleDebug(): void {
    debug.value = !debug.value;
    if (controller) {
      controller.debug = debug.value;
    }
  }

  function startAutoPlay(): void {
    if (autoPlaying.value) {
      return;
    }
    autoPlaying.value = true;
    let direction: 'forward' | 'backward' = 'forward';
    autoTimer = window.setInterval(() => {
      if (!controller) {
        return;
      }
      // 乒乓演示：到末页折返，到首页再前进
      if (direction === 'forward' && currentPage.value >= pageCount.value - 1) {
        direction = 'backward';
      } else if (direction === 'backward' && currentPage.value <= 0) {
        direction = 'forward';
      }
      controller.autoFlip(direction);
    }, options.autoPlayIntervalMs ?? 2200);
  }

  function stopAutoPlay(): void {
    autoPlaying.value = false;
    window.clearInterval(autoTimer);
  }

  /** 视图模式（单页 / 双页对开）：双页下 currentPage 为 spread 索引、
   *  pageCount 为 spread 总数（引擎内 ceil(面数/2)）。 */
  const viewMode = ref<'single' | 'spread'>('single');

  function toggleViewMode(): void {
    if (!controller) {
      return;
    }
    controller.setViewMode(viewMode.value === 'single' ? 'spread' : 'single');
    // 生效口径由引擎回传：非 left 装订回退单页；双页总数 = ⌊面数/2⌋+1
    syncEngineState();
  }

  return {
    providers,
    providerKey,
    currentPage,
    pageCount,
    viewMode,
    debug,
    fps,
    error,
    initialized,
    autoPlaying,
    switchProvider,
    toggleViewMode,
    toggleDebug,
    prev: () => controller?.autoFlip('backward'),
    next: () => controller?.autoFlip('forward'),
    startAutoPlay,
    stopAutoPlay,
  };
}
