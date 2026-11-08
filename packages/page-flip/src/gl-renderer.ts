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
import type { BindEdge, FlipSceneState, PageSize, RenderOptions } from './types';

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  meshSegmentsX: 64,
  meshSegmentsY: 88,
  cameraDistFactor: 3.2,
  dprCap: 2,
  textureCacheSize: 5,
  textureUploadsPerFrame: 1,
  layoutWidthRatio: 0.94,
  layoutHeightRatio: 0.92,
};

interface MeshBuffers {
  /** WebGL2 顶点数组对象（记录 attrib 绑定，省去每帧重设）；WebGL1 为 null。 */
  vao: WebGLVertexArrayObject | null;
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
  private renderOptions: RenderOptions = { ...DEFAULT_RENDER_OPTIONS };
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

  setRenderOptions(render: RenderOptions): void {
    const segmentsChanged =
      render.meshSegmentsX !== this.renderOptions.meshSegmentsX ||
      render.meshSegmentsY !== this.renderOptions.meshSegmentsY;
    this.renderOptions = { ...render };
    if (segmentsChanged) {
      this.buildMeshes();
    }
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
    const d = this.renderOptions.cameraDistFactor * Math.max(this.pageSize.width, this.pageSize.height);
    const fovY = 2 * Math.atan(cssHeight / 2 / d);
    this.vp = multiply(
      perspective(fovY, cssWidth / cssHeight, d / 3, 3 * d),
      translateZ(-d)
    );
  }

  render(state: FlipSceneState, resolveTexture: (pageIndex: number) => WebGLTexture | null): void {
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
    gl.uniform1f(u.get('uDebug')!, state.debug ? 1 : 0);
    gl.uniform1f(u.get('uLift')!, pose ? pose.strength : 0);
    gl.uniform1f(u.get('uDrapeBulge')!, pose ? pose.drapeBulge : 0);
    gl.uniform1f(u.get('uLandFade')!, state.flipFade);
    gl.uniform1f(u.get('uPaperT')!, state.paperT);
    const shading = state.shading;
    gl.uniform3f(u.get('uBackTint')!, shading.backPaperTint[0], shading.backPaperTint[1], shading.backPaperTint[2]);
    gl.uniform1f(u.get('uBackWash')!, shading.backPaperWash);
    gl.uniform1f(u.get('uBackShade')!, shading.backPaperShade);
    gl.uniform1f(u.get('uFrontDark')!, shading.frontCurlDark);
    gl.uniform2f(u.get('uRootAo')!, shading.rootAoStrength, shading.rootAoWidthRatio);
    gl.uniform2f(u.get('uSpineAo')!, shading.spineAoStrength, shading.spineAoWidth);
    // 书沟着色参数（几何保持平铺桌面——书沟立体感由片元着色的缝谷阴影 +
    // 光泽表达，uGutter 按绘制对象逐次开关）；书脊弯折（边缘悬停）：
    // 深度按页高换算并已按弯折强度缩放，供顶点着色器微凹
    const creaseW = Math.max(shading.gutterCreaseWidthRatio * this.pageSize.width, 1);
    gl.uniform2f(u.get('uGutterCrease')!, shading.gutterCreaseDepth, creaseW);
    gl.uniform3f(u.get('uGutterRise')!, shading.gutterRiseStrength, this.pageSize.width * 0.06, this.pageSize.width * 0.05);
    gl.uniform1f(u.get('uGutterFlexZ')!, shading.gutterFlexDepthRatio * this.pageSize.height * state.gutterFlex);
    gl.uniform1f(u.get('uGutterFlex')!, state.gutterFlex);
    gl.uniform1f(u.get('uStackLayers')!, shading.stackLayers);
    gl.uniform1f(u.get('uStackLayerDepth')!, shading.stackLayerDepth);
    gl.uniform1f(u.get('uStackLayerCrease')!, shading.stackLayerCrease);
    gl.uniform1f(u.get('uStackTopLight')!, shading.stackTopEdgeLight);
    gl.uniform1f(u.get('uStackHtRatio')!, shading.stackHeadTailRatio);
    gl.uniform1f(u.get('uShadowStrength')!, pose ? this.shadowStrength(pose, shading) : 0);
    gl.uniform1f(
      u.get('uShadowWidth')!,
      pose ? shading.shadowWidthA * pose.strength + shading.shadowWidthB * pose.radius + shading.shadowWidthC : 1
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.get('uTex')!, 0);

    if (state.spread) {
      // 双页模式：左面（几何帧 right）+ 右面（几何帧 left），书脊居中
      //（世界 x=0），两侧各偏移 ±W_c/2。翻动侧额外把「翻页前的旧面」
      // 作为淡出层压在目标面之上（alpha = 1−flipFade）——点击/翻起瞬间
      // 被翻侧内容不突变，动画落定后才切到目标面。
      const half = this.pageSize.width / 2;
      this.drawUnderSide(1, -half, state.spread.leftPage, resolveTexture, 1);
      this.drawUnderSide(0, half, state.spread.rightPage, resolveTexture, 1);
      const fading = state.spread.fadingFace;
      if (fading) {
        const frame = fading.side === 'left' ? 1 : 0;
        const offsetX = fading.side === 'left' ? -half : half;
        this.drawUnderSide(frame, offsetX, fading.page, resolveTexture, 1 - state.flipFade);
      }
      const flip = state.spread.flipping;
      if (pose && flip) {
        const frame = flip.side === 'left' ? 1 : 0;
        const offsetX = flip.side === 'left' ? -half : half;
        this.drawFlipSide(pose, frame, offsetX, flip.page, resolveTexture);
      }
      return;
    }

    // 单页模式：几何帧与纹理帧均随装订侧
    gl.uniform1f(u.get('uFrame')!, frameIndex(this.bindEdge));
    gl.uniform1f(u.get('uTuvFrame')!, frameIndex(this.bindEdge));
    gl.uniform1f(u.get('uOffsetX')!, 0);
    gl.uniform1f(u.get('uAlpha')!, 1);
    gl.uniform1f(u.get('uGutter')!, 0);
    gl.uniform1f(u.get('uFlat')!, 1);
    gl.uniform1f(u.get('uIsUnder')!, 1);
    this.applyPose(pose);
    gl.bindTexture(gl.TEXTURE_2D, resolveTexture(state.underPage));

    // 下层页（平面 + 书脊 AO + 接触投影）
    this.drawMesh(this.underMesh);

    // 翻动页（卷曲形变）
    const flipTex = state.flippingPage !== null ? resolveTexture(state.flippingPage) : null;
    if (pose && flipTex) {
      gl.uniform1f(u.get('uFlat')!, 0);
      gl.uniform1f(u.get('uIsUnder')!, 0);
      gl.uniform1f(u.get('uShadowStrength')!, 0);
      gl.uniform1f(u.get('uAlpha')!, 1);
      this.applyPose(pose);
      gl.bindTexture(gl.TEXTURE_2D, flipTex);
      this.drawMesh(this.flipMesh);
    }
  }

  /** 双页单侧下层页（几何帧与纹理帧一致——左面帧 right，内容正立；alpha 供淡出层）。 */
  private drawUnderSide(
    frame: number,
    offsetX: number,
    page: number | null,
    resolveTexture: (pageIndex: number) => WebGLTexture | null,
    alpha: number
  ): void {
    if (page === null) {
      return; // 封面 spread 的左侧 / 页数不足——不绘制（背景透出）
    }
    const gl = this.gl;
    const u = this.uniforms;
    gl.uniform1f(u.get('uFrame')!, frame);
    gl.uniform1f(u.get('uTuvFrame')!, frame);
    gl.uniform1f(u.get('uOffsetX')!, offsetX);
    gl.uniform1f(u.get('uFlat')!, 1);
    gl.uniform1f(u.get('uIsUnder')!, 1);
    gl.uniform1f(u.get('uGutter')!, 1); // 双页下层页（含淡出层）启用书沟
    gl.uniform1f(u.get('uAlpha')!, alpha);
    this.applyPose(null);
    gl.bindTexture(gl.TEXTURE_2D, resolveTexture(page));
    this.drawMesh(this.underMesh);
  }

  /** 双页翻动面（side left → 几何帧 right、书脊居中、向右翻越）。 */
  private drawFlipSide(
    pose: NonNullable<FlipSceneState['pose']>,
    frame: number,
    offsetX: number,
    page: number,
    resolveTexture: (pageIndex: number) => WebGLTexture | null
  ): void {
    const gl = this.gl;
    const u = this.uniforms;
    gl.uniform1f(u.get('uFrame')!, frame);
    gl.uniform1f(u.get('uTuvFrame')!, frame);
    gl.uniform1f(u.get('uOffsetX')!, offsetX);
    gl.uniform1f(u.get('uFlat')!, 0);
    gl.uniform1f(u.get('uIsUnder')!, 0);
    gl.uniform1f(u.get('uGutter')!, 0);
    gl.uniform1f(u.get('uShadowStrength')!, 0);
    gl.uniform1f(u.get('uAlpha')!, 1);
    this.applyPose(pose);
    gl.bindTexture(gl.TEXTURE_2D, resolveTexture(page));
    this.drawMesh(this.flipMesh);
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
      'uFlat', 'uFrame', 'uTuvFrame', 'uOffsetX', 'uIsUnder', 'uShadowWidth', 'uShadowStrength',
      'uBackTint', 'uBackWash', 'uBackShade', 'uFrontDark', 'uRootAo', 'uSpineAo',
      'uGutter', 'uGutterFlexZ', 'uGutterFlex', 'uGutterCrease', 'uGutterRise',
      'uStackLayers', 'uStackLayerDepth', 'uStackLayerCrease', 'uStackTopLight', 'uStackHtRatio',
      'uLift', 'uDrapeBulge', 'uLandFade', 'uPaperT', 'uTex', 'uDebug', 'uAlpha',
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
    this.flipMesh = this.createGridMesh(this.renderOptions.meshSegmentsX, this.renderOptions.meshSegmentsY);
    // 下层页 48×2 细分：书脊弯折（边缘悬停）形变集中在缝部，需要近缝分辨率
    this.underMesh = this.createGridMesh(48, 2);
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
    // WebGL2：VAO 记录 attrib 绑定（attrib location 已 bindAttribLocation 固定）
    let vao: WebGLVertexArrayObject | null = null;
    if (this.isWebGL2) {
      const gl2 = this.gl as WebGL2RenderingContext;
      vao = gl2.createVertexArray();
      gl2.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl2.bindVertexArray(null);
    }
    return { vao, vbo, ibo, indexCount: indices.length };
  }

  private drawMesh(mesh: MeshBuffers | null): void {
    if (!mesh) {
      return;
    }
    const gl = this.gl;
    if (mesh.vao) {
      (gl as WebGL2RenderingContext).bindVertexArray(mesh.vao);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    }
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    if (mesh.vao) {
      (gl as WebGL2RenderingContext).bindVertexArray(null);
    }
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
  private shadowStrength(pose: NonNullable<FlipSceneState['pose']>, shading: FlipSceneState['shading']): number {
    const base = Math.min(pose.strength / (shading.shadowBaseSpan * this.pageSize.width), 1);
    // flight shadow fade: a high-flying sheet casts a softer contact shadow
    const flightArc = Math.sin(Math.PI * pose.progress) ** 2;
    const flightFade = 1 - flightArc * shading.shadowFlightFade;
    return base * shading.shadowStrength * (1 - shading.shadowFlattenFade * pose.flatten) * flightFade;
  }
}
