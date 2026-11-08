/**
 * 页面纹理缓存（LRU）：位图 → GL 纹理。
 *
 * WebGL2 支持 NPOT mipmap（远端卷曲面更少闪烁）；WebGL1 退化为线性过滤。
 * `ensure` 每帧最多上传 budget 张，避免换页瞬间掉帧。
 */

export interface TextureStoreOptions {
  /** 缓存上限（张）。 */
  maxEntries?: number;
}

interface CacheEntry {
  texture: WebGLTexture;
  stamp: number;
}

/** 各向异性过滤扩展的最小类型面。 */
interface AnisotropyExtension {
  readonly TEXTURE_MAX_ANISOTROPY_EXT: number;
  readonly MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
}

export class TextureStore {
  private readonly maxEntries: number;
  private readonly cache = new Map<number, CacheEntry>();
  private stamp = 0;
  /** 各向异性过滤扩展（WebGL2 mipmap 路径下可用；缺省 null）。 */
  private readonly anisotropy: AnisotropyExtension | null;

  constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly mipmaps: boolean,
    options: TextureStoreOptions = {}
  ) {
    this.maxEntries = options.maxEntries ?? 5;
    this.anisotropy = this.mipmaps
      ? (gl.getExtension('EXT_texture_filter_anisotropic') ??
        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')) as AnisotropyExtension | null
      : null;
  }

  /** 取纹理；未命中返回 null（由 ensure 异步补齐）。 */
  get(pageIndex: number): WebGLTexture | null {
    const entry = this.cache.get(pageIndex);
    if (!entry) {
      return null;
    }
    entry.stamp = ++this.stamp;
    return entry.texture;
  }

  /** 立即上传第 pageIndex 页（位图绘制 + texImage2D）。 */
  load(pageIndex: number, drawPage: (index: number) => HTMLCanvasElement): WebGLTexture {
    const existing = this.cache.get(pageIndex);
    if (existing) {
      existing.stamp = ++this.stamp;
      return existing.texture;
    }
    const texture = this.upload(drawPage(pageIndex));
    this.cache.set(pageIndex, { texture, stamp: ++this.stamp });
    this.evict(pageIndex);
    return texture;
  }

  /**
   * 预算式补齐：按顺序上传缺失页，最多 budget 张。
   * 返回仍缺的页索引。
   */
  ensure(pageIndexes: number[], budget: number, drawPage: (index: number) => HTMLCanvasElement): number[] {
    const pending: number[] = [];
    for (const index of pageIndexes) {
      if (this.cache.has(index)) {
        this.get(index); // 刷新 LRU
      } else {
        pending.push(index);
      }
    }
    const remain = pending.slice(budget);
    for (const index of pending.slice(0, budget)) {
      this.load(index, drawPage);
    }
    return remain;
  }

  /** 清空缓存（尺寸变化 / 上下文恢复时）。 */
  clear(): void {
    for (const entry of this.cache.values()) {
      this.gl.deleteTexture(entry.texture);
    }
    this.cache.clear();
  }

  dispose(): void {
    this.clear();
  }

  private upload(image: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('TextureStore：创建纹理失败');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.mipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      // 各向异性过滤：卷曲曲面斜视角的远端纹理更清晰（上限 4，兼顾性能）
      if (this.anisotropy) {
        const max = gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
        gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max ?? 1));
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return texture;
  }

  private evict(keepIndex: number): void {
    while (this.cache.size > this.maxEntries) {
      let oldestIndex = -1;
      let oldestStamp = Infinity;
      for (const [index, entry] of this.cache) {
        if (index !== keepIndex && entry.stamp < oldestStamp) {
          oldestStamp = entry.stamp;
          oldestIndex = index;
        }
      }
      if (oldestIndex < 0) {
        break;
      }
      const entry = this.cache.get(oldestIndex);
      if (entry) {
        this.gl.deleteTexture(entry.texture);
      }
      this.cache.delete(oldestIndex);
    }
  }
}
