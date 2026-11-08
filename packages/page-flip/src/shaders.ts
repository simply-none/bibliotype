/**
 * GLSL ES 1.00 着色器源码（同一份源码兼容 WebGL1 / WebGL2 上下文）。
 *
 * 顶点着色器：与 deform.ts 逐式一致的 **3D 卷曲形变**（云展网 / StPageFlip
 * 同源）——卷曲段绕贴桌圆柱真实抬离页面平面，z 抬升经透视相机产生
 * 近大远小，卷筒的遮挡关系由深度测试自然呈现：
 * - s ≤ 0 桌面料原位（z=0）；
 * - 0 < θ = s/r ≤ π 卷曲压缩段：pos = P + n̂·r·sinθ，z = r·(1−cosθ)
 *   （θ=π 折回折痕正上方，高度 2r）；
 * - s > r·π 背面斜披段：pos = P − n̂·(s − r·π)，z 自卷顶 2r 线性降到
 *   自由边触桌，材料翻折到折痕另一侧、内容呈镜像（背面）。
 *
 * 片元着色器：立体感来自**几何抬升 + 单调连续渐变**——
 * 翻动页：正面卷曲段渐暗（连续过渡）→ 背面折回部分为**单一暖调纸色**
 * （大比例纸色 + 隐约反字透出；不再区分卷曲后坡/斜披两段，无弧顶
 * 高光条与自由端高光——折页只有一种颜色）；下层页
 * 只保留「书脊常驻 AO + 随折痕行进的接触投影」（分段着色仅作用于
 * 翻动页——下层页是平铺的纸，若套用分段逻辑，静止/翻页时会被误判
 * 成背面而镜像、洗白）。正反面判定用几何量 vS 对比 foldW（镜像下
 * 绕序不可靠）。
 * 翻动页背面斜披段随 uLandFade 在落定尾段淡出（镜像平贴态落在
 * 页外，淡出避免"悬空整页→硬切消失"的破绽）。
 */

export const VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec2 aUv;

uniform mat4 uVP;
uniform vec2 uSize;          // 页面尺寸 (W, H)，世界单位 = CSS px
uniform vec2 uCreaseOrigin;  // 折痕点
uniform vec2 uCreaseDir;     // 折痕方向（单位）
uniform vec2 uWrapNormal;    // 卷起侧法向（单位）
uniform float uRadius;       // 卷曲半径（卷曲带宽度基准）
uniform float uTaper;        // 轴向锥化
uniform float uLift;         // 掀起材料全长（背面斜披段落桌依据）
uniform float uFlat;         // 1 = 下层页（跳过形变）
uniform float uFrame;        // 页面帧（装订侧）：0 left / 1 right / 2 top / 3 bottom

varying vec2 vUv;
varying float vS;            // 到折痕有符号距离（掀侧为正）
varying float vXi;           // 折痕轴向归一化坐标（锥化用）

const float PI = 3.141592653589793;

void main() {
  vec2 rel = aPos - uCreaseOrigin;
  float s = dot(rel, uWrapNormal);
  float xiPx = dot(rel, uCreaseDir);        // 折痕平行方向坐标（px，必须保留！）
  float xi = xiPx / uSize.y;
  vec2 pos2 = aPos;
  float zLift = 0.0;

  if (uFlat < 0.5 && s > 0.0) {
    float r = max(uRadius * (1.0 - uTaper * xi), 0.25);
    float theta = min(s / r, PI);
    float bend = r * sin(theta);              // 卷入：0 → r → 0
    float lift = r * (1.0 - cos(theta));      // 沿圆柱爬升：0 → r → 2r
    float overCrest = step(PI, theta);
    float backSpan = max(uLift - r * PI, 1.0);
    float backFrac = clamp((s - r * PI) / backSpan, 0.0, 1.0);
    float mirrored = -(s - r * PI);           // θ=π 后镜像展开（负方向）
    // 圆柱 warp：折痕轴线上 ξ 处的正交截面 —— 切向分量不可丢弃，
    // 否则整个翻动页会塌缩成一条一维曲线（曲面消失）
    pos2 = uCreaseOrigin
         + uCreaseDir * xiPx
         + uWrapNormal * mix(bend, mirrored, overCrest);
    zLift = mix(lift, 2.0 * r * (1.0 - backFrac), overCrest);
  }

  vS = s;
  vXi = xi;
  vUv = aUv;
  // 页面帧映射：规范空间 → 屏幕（世界坐标，y 向上）；z 抬升不受帧影响。
  // 四种等距反射，det = −1（CULL_FACE 关闭，绕序无关）。
  vec2 world;
  if (uFrame < 0.5) {
    // left：恒等
    world = vec2(pos2.x - uSize.x * 0.5, uSize.y * 0.5 - pos2.y);
  } else if (uFrame < 1.5) {
    // right：X 镜像
    world = vec2(uSize.x * 0.5 - pos2.x, uSize.y * 0.5 - pos2.y);
  } else if (uFrame < 2.5) {
    // top：转置（规范书脊 x=0 → 屏幕上缘）
    world = vec2(pos2.y - uSize.y * 0.5, uSize.x * 0.5 - pos2.x);
  } else {
    // bottom：转置 + X 镜像（规范书脊 → 屏幕下缘）
    world = vec2(pos2.y - uSize.y * 0.5, pos2.x - uSize.x * 0.5);
  }
  gl_Position = uVP * vec4(world, zLift, 1.0);
}
`;

export const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uTex;
uniform vec2 uSize;           // 页面尺寸 (W_c, H_c) 规范空间——书口叠边的像素换算
uniform float uFrame;         // 页面帧（装订侧）：0 left / 1 right / 2 top / 3 bottom
uniform float uIsUnder;       // 1 = 下层页（书脊 AO + 接触投影）
uniform float uShadowWidth;   // 投影带宽
uniform float uShadowStrength;
uniform float uRadius;        // 卷曲半径
uniform float uTaper;         // 轴向锥化
uniform float uLift;          // 掀起材料全长（自由端高光定位）
uniform float uLandFade;      // 落定淡出系数（0=不透明，1=背面平铺段全透明）
uniform float uPaperT;        // 每页纸厚（px）——书口页叠边纹理的层距
uniform float uDebug;

varying vec2 vUv;
varying float vS;
varying float vXi;

void main() {
  float rL = max(uRadius * (1.0 - uTaper * vXi), 0.25);
  float foldW = rL * 3.141592653589793;     // 卷曲压缩段的材料全长

  // 纹素采样：规范 UV → 屏幕向纹理 UV（页面帧决定轴序与翻转）。
  // left:  (u, 1−v)  right: (1−u, 1−v)  top: (v, 1−u)  bottom: (v, u)
  vec2 tuv;
  if (uFrame < 0.5) {
    tuv = vec2(vUv.x, 1.0 - vUv.y);
  } else if (uFrame < 1.5) {
    tuv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  } else if (uFrame < 2.5) {
    tuv = vec2(vUv.y, 1.0 - vUv.x);
  } else {
    tuv = vec2(vUv.y, vUv.x);
  }
  bool isFlip = uIsUnder < 0.5;             // 翻动页才参与分段着色与背面透视
  // 纸张背面（反字）：折痕几何在折叠时已完成镜像反射，背面直接采样
  // 材料点自身纹素——正面内容从纸背看即为左右反字（不再额外翻转 UV，
  // 否则会把镜像抵消、背面显示正字）
  bool seeBack = isFlip && vS > foldW * 0.5; // θ > π/2：背面朝上

  vec4 base = texture2D(uTex, tuv);
  vec3 col = base.rgb;
  float shade = 1.0;

  if (isFlip) {
    if (vS > foldW * 0.5) {
      // 背面（折回平铺的纸背）：单一暖调纸色，贴近真实纸张——
      // 大比例混入纸色、保留约 18% 正面内容透出（隐约反字），均一
      // 明度略暗于下层页（压在上面的那张纸）
      col = mix(col, vec3(0.97, 0.945, 0.9), 0.82);
      shade = 0.94;
    } else if (vS > 0.0) {
      // 正面卷曲段：由桌面亮连续渐入纸背明度（终点 = 背面均色，无断差）
      shade = 1.0 - 0.06 * smoothstep(0.0, foldW * 0.5, vS);
    }
  }
  col *= shade;

  // 折痕根部 AO（卷曲圆柱自身投影）
  col *= 1.0 - 0.18 * exp(-abs(vS) / (rL * 0.22 + 2.0));

  if (uIsUnder > 0.5) {
    // 书脊常驻 AO：规范空间书脊恒在 uv.x = 0（与行款镜像无关）
    float spineAo = 1.0 - 0.16 * smoothstep(0.085, 0.0, vUv.x);
    col *= spineAo;

    // 书口页叠边（纸厚暗示）：自由边 + 天头地脚露出薄层页缘
    float dFore = (1.0 - vUv.x) * uSize.x;   // 距自由边（规范空间恒 uv.x = 1）
    float dHead = vUv.y * uSize.y;           // 距天头
    float dTail = (1.0 - vUv.y) * uSize.y;   // 距地脚
    float stackW = uPaperT * 5.0;            // 叠边露出约 5 层

    // 装订侧书页叠边：左缘薄层纸缘（书厚在装订侧同样可见）
    float dBind = vUv.x * uSize.x;           // 距装订边（规范空间恒 uv.x = 0）
    float bindStrip = 1.0 - smoothstep(stackW * 0.7 - uPaperT * 0.5, stackW * 0.7, dBind);
    if (bindStrip > 0.003) {
      float bindShade = 1.0 - 0.06 * floor(dBind / uPaperT)
          - 0.22 * smoothstep(0.3, 0.5, abs(fract(dBind / uPaperT) - 0.5));
      col *= mix(1.0, bindShade, bindStrip);
    }

    float foreStrip = 1.0 - smoothstep(stackW - uPaperT * 0.5, stackW, dFore);
    if (foreStrip > 0.003) {
      float sheetShade = 1.0 - 0.06 * floor(dFore / uPaperT)
          - 0.22 * smoothstep(0.3, 0.5, abs(fract(dFore / uPaperT) - 0.5));
      col *= mix(1.0, sheetShade, foreStrip);
      // 顶层页缘受光亮边
      col = mix(col, vec3(1.0), 0.2 * (1.0 - smoothstep(0.0, 0.8, dFore)));
    }
    float htW = stackW * 0.55;
    float headStrip = 1.0 - smoothstep(htW - uPaperT * 0.5, htW, dHead);
    float tailStrip = 1.0 - smoothstep(htW - uPaperT * 0.5, htW, dTail);
    if (headStrip > 0.003) {
      float shadeH = 1.0 - 0.06 * floor(dHead / uPaperT)
          - 0.22 * smoothstep(0.3, 0.5, abs(fract(dHead / uPaperT) - 0.5));
      col *= mix(1.0, shadeH, headStrip);
    }
    if (tailStrip > 0.003) {
      float shadeT = 1.0 - 0.06 * floor(dTail / uPaperT)
          - 0.22 * smoothstep(0.3, 0.5, abs(fract(dTail / uPaperT) - 0.5));
      col *= mix(1.0, shadeT, tailStrip);
    }

    // 翻起页的接触投影：主影在折痕桌侧、次影在页下（窄带弱影，贴合真实纸投影）
    float w = max(uShadowWidth, 1.0);
    float t1 = exp(-pow((vS + 0.22 * w) / (0.30 * w), 2.0));
    float t2 = 0.35 * exp(-pow((vS - 0.12 * w) / (0.38 * w), 2.0));
    float shadow = uShadowStrength * clamp(t1 + t2, 0.0, 1.0);
    col *= 1.0 - shadow;
  }

  if (uDebug > 0.5) {
    // 调试视图：三段分色（flat 灰蓝 / curl 绿 / back 橙）+ 网格线；
    // 下层页不参与分段，恒显示平铺色
    vec3 dc = !isFlip ? vec3(0.55, 0.6, 0.72)
            : (vS <= 0.0 ? vec3(0.55, 0.6, 0.72)
            : (vS > foldW ? vec3(0.96, 0.62, 0.2) : vec3(0.3, 0.76, 0.42)));
    vec2 cell = abs(fract(vUv * vec2(12.0, 18.0)) - 0.5);
    float line = smoothstep(0.46, 0.5, max(cell.x, cell.y));
    col = mix(dc, vec3(1.0, 0.2, 0.2), line * 0.5);
  }

  // 落定淡出：仅翻动页的背面平铺段按 uLandFade 消隐；
  // 卷曲段保持不透明，由半径收拢（landRadius）自然贴平消失。
  float alpha = 1.0;
  if (isFlip) {
    alpha = 1.0 - uLandFade * step(foldW, vS);
  }
  if (uDebug > 0.5) {
    alpha = 1.0;
  }

  gl_FragColor = vec4(col, alpha);
}
`;
