/**
 * 画册图片页提供者：整幅照片 + 细白框 + 图注（模拟摄影集画册）。
 * 图片来自 picsum.photos（需网络），加载失败自动回退为程序绘制的
 * 渐变艺术样张，保证离线可用。
 */
import type { PageProvider } from '../../engine/types';

const PAGE_COUNT = 10;
const CAPTIONS = [
  '晨雾 · 山径', '暮色 · 海岸', '老墙 · 光影', '静物 · 陶与花', '夜航 · 灯塔',
  '林间 · 逆光', '街角 · 雨后', '旷野 · 风车', '港口 · 归帆', '初雪 · 屋檐',
];

/** 预解码图片；任一失败即整体回退（保持 demo 简单可靠）。 */
function loadImages(count: number): Promise<Array<HTMLImageElement | null>> {
  const tasks = Array.from({ length: count }, (_, i) => {
    return new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `https://picsum.photos/seed/pageflip-${i}/900/1200`;
    });
  });
  return Promise.all(tasks);
}

export function createAlbumProvider(): PageProvider {
  const images: Array<HTMLImageElement | null> = [];
  let useFallback = false;
  const provider: PageProvider = {
    pageCount: PAGE_COUNT,
    aspect: 0.72,
    orientation: 'ltr',
    ready: loadImages(PAGE_COUNT).then((loaded) => {
      images.push(...loaded);
      useFallback = loaded.some((img) => img === null);
    }),
    renderPage(ctx, pageIndex, w, h) {
      drawMatte(ctx, w, h);
      const inset = w * 0.055;
      const img = images[pageIndex];
      if (img && !useFallback) {
        drawCoverFit(ctx, img, inset, inset, w - inset * 2, h - inset * 2.4);
      } else {
        drawGeneratedArt(ctx, pageIndex, inset, inset, w - inset * 2, h - inset * 2.4);
      }
      drawCaption(ctx, pageIndex, w, h);
    },
  };
  return provider;
}

/** 卡纸底 + 照片外细框。 */
function drawMatte(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#efece4';
  ctx.fillRect(0, 0, w, h);
}

/** cover 模式绘制（等比裁切填满）。 */
function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
  ctx.strokeStyle = 'rgba(60, 50, 40, 0.5)';
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.strokeRect(x, y, w, h);
}

/** 离线回退：程序生成的「摄影感」渐变艺术。 */
function drawGeneratedArt(
  ctx: CanvasRenderingContext2D,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const palettes = [
    ['#2c3e50', '#4ca1af'], ['#355c7d', '#c06c84'], ['#0f2027', '#2c5364'],
    ['#41295a', '#2f0743'], ['#136a8a', '#267871'], ['#232526', '#414345'],
  ];
  const [from, to] = palettes[seed % palettes.length];
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // 光斑与地平线，营造摄影氛围
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const glow = ctx.createRadialGradient(
    x + w * (0.25 + 0.5 * ((seed * 0.37) % 1)),
    y + h * 0.3,
    0,
    x + w * 0.5,
    y + h * 0.5,
    w * 0.9
  );
  glow.addColorStop(0, 'rgba(255, 244, 214, 0.55)');
  glow.addColorStop(1, 'rgba(255, 244, 214, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(10, 14, 20, 0.55)';
  ctx.beginPath();
  ctx.moveTo(x, y + h * (0.62 + 0.08 * Math.sin(seed)));
  ctx.lineTo(x + w, y + h * (0.55 + 0.08 * Math.cos(seed * 1.7)));
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(60, 50, 40, 0.5)';
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.strokeRect(x, y, w, h);
}

function drawCaption(ctx: CanvasRenderingContext2D, pageIndex: number, w: number, h: number): void {
  ctx.fillStyle = '#4a4438';
  ctx.font = `${Math.round(h * 0.026)}px "Noto Serif SC", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(CAPTIONS[pageIndex % CAPTIONS.length], w / 2, h * 0.925);
  ctx.fillStyle = 'rgba(74, 68, 56, 0.6)';
  ctx.font = `${Math.round(h * 0.02)}px "Noto Serif SC", "SimSun", serif`;
  ctx.fillText(String(pageIndex + 1).padStart(2, '0'), w / 2, h * 0.962);
}
