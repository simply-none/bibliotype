/**
 * WebGL 渲染器：上下文管理、网格构建、每帧绘制。
 *
 * 场景构成：单页版式——下层页（平面四边形，含书脊 AO 与接触投影）+
 * 翻动页（细分网格，顶点着色器卷曲形变）。世界单位 = CSS 像素，
 * 页面居中于原点；透视相机在 +z，z 抬升产生真实近大远小。
 */
import { multiply, perspective, translateZ, type Mat4 } from './mat4';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import { frameIndex } from './page-frame';
import type { BindEdge, FlipSceneState, PageSize } from './types';

const FLIP_SEG_X = 64;
const FLIP_SEG_Y = 88;
const CAMERA_DIST_FACTOR = 3.2;

interface MeshBuffers {
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
}

export class GlRenderer {
  readonly isWebGL2: boolean;
  /** 原始 GL 上下文（TextureStore 复用同一上下文）。 */
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private flipMesh: MeshBuffers | null = null;
  private underMesh: MeshBuffers | null = null;
  private vp: Mat4 = new Float32Array(16);
  private pageSize: PageSize = { width: 1, height: 1 };
  private bindEdge: BindEdge = 'left';
  private lost = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onContextLost: () => void
  ) {
    const gl = (canvas.getContext('webgl2', { alpha: true, antialias: true }) ??
      canvas.getContext('webgl', { alpha: true, antialias: true })) as WebGLRenderingContext | null;
    if (!gl) {
      throw new Error('当前环境不支持 WebGL，无法渲染仿真翻页');
    }
    this.gl = gl;
    this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.initGl();
  }

  get isWebGL2Context(): boolean {
    return this.isWebGL2;
  }

  /** 更新版面（规范空间页面尺寸 / 装订侧），网格与缓存随尺寸变化重建。 */
  updateLayout(size: PageSize, bindEdge: BindEdge): void {
    const sizeChanged = size.width !== this.pageSize.width || size.height !== this.pageSize.height;
    const edgeChanged = bindEdge !== this.bindEdge;
    this.pageSize = { ...size };
    this.bindEdge = bindEdge;
    if (sizeChanged || edgeChanged) {
      this.buildMeshes();
    }
  }

  /** 画布尺寸适配（CSS 尺寸 × dpr），重建投影。 */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const d = CAMERA_DIST_FACTOR * Math.max(this.pageSize.width, this.pageSize.height);
    const fovY = 2 * Math.atan(cssHeight / 2 / d);
    this.vp = multiply(
      perspective(fovY, cssWidth / cssHeight, d / 3, 3 * d),
      translateZ(-d)
    );
  }

  render(state: FlipSceneState, underTex: WebGLTexture | null, flipTex: WebGLTexture | null): void {
    if (this.lost || !this.program) {
      return;
    }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    // alpha 混合：翻动页落定尾段按 uLandFade 消隐（画布合成对背景正确）
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const pose = state.pose;
    const u = this.uniforms;
    gl.useProgram(this.program);

    gl.uniformMatrix4fv(u.get('uVP')!, false, this.vp);
    gl.uniform2f(u.get('uSize')!, this.pageSize.width, this.pageSize.height);
    gl.uniform1f(u.get('uFrame')!, frameIndex(this.bindEdge));
    gl.uniform1f(u.get('uDebug')!, state.debug ? 1 : 0);
    gl.uniform1f(u.get('uLift')!, pose ? pose.strength : 0);
    gl.uniform1f(u.get('uLandFade')!, state.flipFade);
    gl.uniform1f(u.get('uPaperT')!, state.paperT);
    gl.uniform1f(u.get('uFlat')!, 1);
    gl.uniform1f(u.get('uIsUnder')!, 1);
    this.applyPose(pose);
    gl.uniform1f(u.get('uShadowStrength')!, pose ? this.shadowStrength(pose) : 0);
    gl.uniform1f(u.get('uShadowWidth')!, pose ? 0.16 * pose.strength + 0.3 * pose.radius + 12 : 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, underTex);
    gl.uniform1i(u.get('uTex')!, 0);

    // 下层页（平面 + 书脊 AO + 接触投影）
    this.drawMesh(this.underMesh);

    // 翻动页（卷曲形变）
    if (pose && flipTex) {
      gl.uniform1f(u.get('uFlat')!, 0);
      gl.uniform1f(u.get('uIsUnder')!, 0);
      gl.uniform1f(u.get('uShadowStrength')!, 0);
      this.applyPose(pose);
      gl.bindTexture(gl.TEXTURE_2D, flipTex);
      this.drawMesh(this.flipMesh);
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    const lose = this.gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.onContextLost();
  };

  private handleContextRestored = (): void => {
    this.lost = false;
    this.initGl();
    this.buildMeshes();
  };

  private initGl(): void {
    const gl = this.gl;
    this.program = this.compileProgram();
    const names = [
      'uVP', 'uSize', 'uCreaseOrigin', 'uCreaseDir', 'uWrapNormal', 'uRadius', 'uTaper',
      'uFlat', 'uFrame', 'uIsUnder', 'uShadowWidth', 'uShadowStrength',
      'uLift', 'uLandFade', 'uPaperT', 'uTex', 'uDebug',
    ];
    this.uniforms = new Map(names.map((name) => [name, gl.getUniformLocation(this.program!, name)]));
  }

  private compileProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`着色器编译失败: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.bindAttribLocation(program, 1, 'aUv');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`着色器链接失败: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private buildMeshes(): void {
    this.flipMesh = this.createGridMesh(FLIP_SEG_X, FLIP_SEG_Y);
    this.underMesh = this.createGridMesh(1, 1);
  }

  /** 构建页面网格：交错 [x, y, u, v]，规范空间 [0,W]×[0,H]。 */
  private createGridMesh(segX: number, segY: number): MeshBuffers {
    const gl = this.gl;
    const { width: w, height: h } = this.pageSize;
    const verts = new Float32Array((segX + 1) * (segY + 1) * 4);
    let vi = 0;
    for (let iy = 0; iy <= segY; iy++) {
      const py = (h * iy) / segY;
      const v = iy / segY;
      for (let ix = 0; ix <= segX; ix++) {
        verts[vi++] = (w * ix) / segX;
        verts[vi++] = py;
        verts[vi++] = ix / segX;
        verts[vi++] = v;
      }
    }
    const indices = new Uint16Array(segX * segY * 6);
    let ii = 0;
    for (let iy = 0; iy < segY; iy++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iy * (segX + 1) + ix;
        const b = a + 1;
        const c = a + segX + 1;
        const d = c + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    return { vbo, ibo, indexCount: indices.length };
  }

  private drawMesh(mesh: MeshBuffers | null): void {
    if (!mesh) {
      return;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  private applyPose(pose: FlipSceneState['pose']): void {
    const u = this.uniforms;
    if (pose) {
      this.uniform2f('uCreaseOrigin', pose.creaseOrigin.x, pose.creaseOrigin.y);
      this.uniform2f('uCreaseDir', pose.creaseDir.x, pose.creaseDir.y);
      this.uniform2f('uWrapNormal', pose.wrapNormal.x, pose.wrapNormal.y);
      this.uniform1f('uRadius', pose.radius);
      this.uniform1f('uTaper', pose.taper);
    } else {
      this.uniform2f('uCreaseOrigin', -1e5, -1e5);
      this.uniform2f('uCreaseDir', 0, 1);
      this.uniform2f('uWrapNormal', 1, 0);
      this.uniform1f('uRadius', 1);
      this.uniform1f('uTaper', 0);
    }
  }

  private uniform1f(name: string, value: number): void {
    const loc = this.uniforms.get(name);
    if (loc) {
      this.gl.uniform1f(loc, value);
    }
  }

  private uniform2f(name: string, x: number, y: number): void {
    const loc = this.uniforms.get(name);
    if (loc) {
      this.gl.uniform2f(loc, x, y);
    }
  }

  /** 接触投影强度：掀起范围越大越深，落页压平后自然消退。 */
  private shadowStrength(pose: NonNullable<FlipSceneState['pose']>): number {
    const base = Math.min(pose.strength / (0.75 * this.pageSize.width), 1);
    return base * 0.3 * (1 - 0.7 * pose.flatten);
  }
}
