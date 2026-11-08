/**
 * 仿真翻页 Demo 的 Vue 组合式：引擎 ↔ 组件接线。
 * 职责：生命周期挂载 / 视口自适应 / 提供者切换 / 状态与 FPS 轮询 / 自动演示。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { FlipController } from '@bibliotype/page-flip';
import { createDemoProviders, type DemoProviderEntry } from './providers';

export function usePageflip(canvasRef: Ref<HTMLCanvasElement | null>, stageRef: Ref<HTMLElement | null>) {
  const providers = createDemoProviders();
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
    pageCount.value = entry.provider.pageCount;

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
    pageCount.value = entry.provider.pageCount;
    currentPage.value = 0;
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
    }, 2200);
  }

  function stopAutoPlay(): void {
    autoPlaying.value = false;
    window.clearInterval(autoTimer);
  }

  return {
    providers,
    providerKey,
    currentPage,
    pageCount,
    debug,
    fps,
    error,
    initialized,
    autoPlaying,
    switchProvider,
    toggleDebug,
    prev: () => controller?.autoFlip('backward'),
    next: () => controller?.autoFlip('forward'),
    startAutoPlay,
    stopAutoPlay,
  };
}
