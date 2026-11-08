/**
 * GLSL ES 1.00 着色器源码（同一份源码兼容 WebGL1 / WebGL2 上下文）。
 *
 * 顶点着色器：两种形变模型（与 deform.ts 逐式一致）——
 *
 * **rotation（刚体旋转，edge 抓取 / 滑动 / 自动翻页）**：页面绕书脊
 * （规范 x=0）刚体旋转 φ，自由边带卷筒 χ（半径 r），中段沿页法向叠加
 * 飞行拱。真实书本硬页翻转：页面立起、透视缩短（z 抬升经透视相机产生
 * 近大远小）、自由边为最高点、φ=π 自然落桌。
 *
 * **fold（折痕卷折，corner 捏角折角模型）**：卷曲段绕贴桌圆柱爬升
 * （θ=π 折回折痕正上方），背面斜披段自卷顶镜像展开落桌。
 *
 * 片元着色器：
 * - rotation：正反面按**局部表面角**判定（过 90° 侧面逐渐显出纸背）——
 *   正面 = 纹理（卷筒附近渐暗 + 倾斜微暗）；背面 = 真实纸背纹理
 *   （双页模式翻动叶的另一面，落地时与下层目标面逐像素对齐）或暖调
 *   纸色 + 透字近似（单页模式）；落定尾段随 uLandFade 消隐（纸背明度
 *   同步 →1，移除瞬间与下层无缝）。
 * - fold：正面卷曲段渐暗 → 背面单一暖调纸色（与既有行为一致）。
 * - 下层页：书脊常驻 AO + 翻起页投影——rotation 为随翻越投影范围移动
 *   的软影带（按所在侧门控）；fold 为折痕两侧 vS 高斯带。
 */

export const VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec2 aUv;

uniform mat4 uVP;
uniform vec2 uSize;          // 页面尺寸 (W, H)，世界单位 = CSS px
uniform vec2 uCreaseOrigin;  // 折痕点（rotation：书脊锚点）
uniform vec2 uCreaseDir;     // 折痕方向（单位）
uniform vec2 uWrapNormal;    // 卷起侧法向（单位）
uniform float uRadius;       // 卷曲半径（rotation：自由边卷筒半径）
uniform float uTaper;        // 轴向锥化
uniform float uDrapeBulge;   // 背面斜披段弧拱高度（px）
uniform float uLift;         // 掀起材料全长（背面斜披段落桌依据）
uniform float uModel;        // 形变模型：0 = fold / 1 = rotation
uniform float uFlipAngle;    // rotation：翻页角 φ
uniform float uCurlAngle;    // rotation：自由边卷筒包角 χ
uniform float uBow;          // rotation：飞行拱高（px）
uniform float uFlat;         // 1 = 下层页（跳过形变）
uniform float uGutterFlexZ;  // 书脊弯折深度（px，已按悬停强度缩放；0 = 平铺）
uniform float uFrame;        // 页面帧（几何装订侧）：0 left / 1 right / 2 top / 3 bottom
uniform float uOffsetX;      // 世界 X 偏移（双页模式：右面 +W_c/2、左面 −W_c/2、单页 0）

varying vec2 vUv;
varying float vS;            // 到折痕有符号距离（掀侧为正；rotation = 距书脊距离）
varying float vXi;           // 折痕轴向归一化坐标（锥化用）
varying float vAngle;        // rotation：局部表面角（刚体段 φ，卷筒段 φ+θ）
varying float vD;            // rotation：材料距书脊距离

const float PI = 3.141592653589793;

void main() {
  vec2 rel = aPos - uCreaseOrigin;
  float s = dot(rel, uWrapNormal);
  float xiPx = dot(rel, uCreaseDir);        // 折痕平行方向坐标（px，必须保留！）
  float xi = xiPx / uSize.y;
  vec2 pos2 = aPos;
  float zLift = 0.0;
  float localAngle = 0.0;

  if (uFlat < 0.5 && uModel > 0.5) {
    // 刚体旋转模型：绕书脊（规范 x=0）翻转 + 自由边卷筒 + 飞行拱。
    // 截面按材料距书脊 d 分两段（与 deform.ts deformRotationPoint 同式）：
    // 刚体段沿页向 T=(cosφ,sinφ) 伸出 d；卷筒段绕铰链圆筒卷包角 θ。
    float d = aPos.x;
    float r = max(uRadius, 0.25);
    float hinge = max(uSize.x - r * uCurlAngle, 0.0);
    float cosPhi = cos(uFlipAngle);
    float sinPhi = sin(uFlipAngle);
    float along;
    float nOff;
    if (d <= hinge) {
      along = d;
      nOff = 0.0;
      localAngle = uFlipAngle;
    } else {
      float theta = min((d - hinge) / r, uCurlAngle);
      along = hinge + r * sin(theta);
      nOff = r * (1.0 - cos(theta));
      localAngle = uFlipAngle + theta;
    }
    // 飞行拱：沿页法向 N=(−sinφ,cosφ) 弓出（中段最大，两端归零）
    nOff += uBow * sin(PI * clamp(d / max(uSize.x, 1.0), 0.0, 1.0));
    pos2.x = along * cosPhi - nOff * sinPhi;
    zLift = along * sinPhi + nOff * cosPhi;
  } else if (uFlat < 0.5 && s > 0.0) {
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
    // 下落 smoothstep：弧顶/触桌两端零斜率（与卷曲段 C1 衔接、近桌减速），
    // 叠加 sin² 弧拱（真实纸张前冲弧线，两端亦零斜率）
    float drapeEase = backFrac * backFrac * (3.0 - 2.0 * backFrac);
    float drapeArc = sin(3.14159265 * backFrac);
    zLift = mix(
      lift,
      2.0 * r * (1.0 - drapeEase) + uDrapeBulge * drapeArc * drapeArc,
      overCrest
    );
  }

  if (uGutterFlexZ > 0.01 && uFlat > 0.5) {
    // 边缘悬停的书脊弯折：两侧页面近缝向沟内微凹（背离观察者），
    // 自由边不动——书脊被轻轻掰开的预览效果（不掀页）
    float t = clamp(aPos.x / uSize.x, 0.0, 1.0);
    float recess = pow(1.0 - t, 1.6);
    zLift -= uGutterFlexZ * recess;
  }

  vS = s;
  vXi = xi;
  vAngle = localAngle;
  vD = aPos.x;
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
  world.x += uOffsetX;
  // 书沟立体感仅由片元着色表达（缝谷阴影 + 光泽）——几何保持平铺桌面：
  // 页块上下缘平直，无隆起/倾斜
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
uniform sampler2D uBackTex;   // rotation：真实纸背纹理（翻动叶的另一面）
uniform float uHasBackTex;    // 1 = 纸背用真实纹理（双页），0 = 暖调纸色近似
uniform float uBackMirror;    // 纸背纹理 UV x 镜像（forward 折右面 = 1）
uniform vec2 uSize;           // 页面尺寸 (W_c, H_c) 规范空间——书口叠边的像素换算
uniform float uTuvFrame;      // 纹理帧（内容朝向）：0 left / 1 right / 2 top / 3 bottom
uniform float uIsUnder;       // 1 = 下层页（书脊 AO + 接触投影）
uniform float uModel;         // 形变模型：0 = fold / 1 = rotation
uniform float uFlipSpan;      // rotation：自由缘投影距书脊（px，= W·|cosφ|）
uniform float uFlipHeight;    // rotation：sin φ（页面离桌高度比）
uniform float uFlipSide;      // rotation：翻越侧（+1 = 自由边侧 / −1 = 对侧）
uniform float uUnderSide;     // 下层页所在侧（+1 = 自由边侧 / −1 = 对侧）
uniform float uShadowWidth;   // 投影带宽（fold）
uniform float uShadowStrength;
uniform float uRadius;        // 卷曲半径
uniform float uCurlAngle;     // rotation：卷筒包角 χ（卷筒带宽度依据）
uniform float uTaper;         // 轴向锥化
uniform float uLandFade;      // 落定淡出系数（0=不透明，1=背面平铺段全透明）
uniform float uPaperT;        // 每页纸厚（px）——书口页叠边纹理的层距
uniform vec3 uBackTint;       // 折页纸背色（暖调纸色）
uniform float uBackWash;      // 折页纸背混色比（1−wash = 正面内容透出/反字强度）
uniform float uBackShade;     // 折页均一明度
uniform float uFrontDark;     // 正面卷曲段渐暗幅度
uniform vec2 uRootAo;         // 折痕根部 AO（强度, 宽度比）
uniform vec2 uSpineAo;        // 书脊常驻 AO（强度, 宽度）
uniform float uGutter;        // 1 = 双页书沟着色生效
uniform float uGutterFlex;    // 书脊弯折强度 0..1（边缘悬停，缝谷阴影随之加深）
uniform vec2 uGutterCrease;   // 书沟窄缝谷阴影（强度, 特征宽度 px）
uniform vec3 uGutterRise;     // 坡面光泽高光（幅度, 中心距 px, 带宽 px）
uniform float uStackLayers;   // 书口页叠边层数
uniform float uStackLayerDepth;  // 叠边层深
uniform float uStackLayerCrease; // 叠边层缝对比
uniform float uStackTopLight;    // 顶层页缘亮边强度
uniform float uStackHtRatio;     // 天头地脚带宽比
uniform float uDebug;
uniform float uAlpha;         // 绘制透明度（双页淡出层 = 1−flipFade，其余恒 1）

varying vec2 vUv;
varying float vS;
varying float vXi;
varying float vAngle;
varying float vD;

void main() {
  float rL = max(uRadius * (1.0 - uTaper * vXi), 0.25);
  float foldW = rL * 3.141592653589793;     // 卷曲压缩段的材料全长（fold）

  // 纹素采样：规范 UV → 屏幕向纹理 UV（纹理帧决定轴序与翻转，可与几何帧解耦——
  // 双页左面几何书脊在右、内容仍正立显示）。
  // left:  (u, 1−v)  right: (1−u, 1−v)  top: (v, 1−u)  bottom: (v, u)
  vec2 tuv;
  if (uTuvFrame < 0.5) {
    tuv = vec2(vUv.x, 1.0 - vUv.y);
  } else if (uTuvFrame < 1.5) {
    tuv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  } else if (uTuvFrame < 2.5) {
    tuv = vec2(vUv.y, 1.0 - vUv.x);
  } else {
    tuv = vec2(vUv.y, vUv.x);
  }
  bool isFlip = uIsUnder < 0.5;             // 翻动页才参与分段着色与背面透视

  vec4 base = texture2D(uTex, tuv);
  vec3 col = base.rgb;
  float alpha = 1.0;

  if (isFlip && uModel > 0.5) {
    // rotation：正反面按局部表面角判定（过 90° 侧面逐渐显出纸背）
    float backness = smoothstep(1.0708, 2.0708, vAngle);  // π/2 ± 0.5 过渡带
    float r = max(uRadius, 0.25);
    float hinge = max(uSize.x - r * uCurlAngle, 0.0);
    // 正面：卷筒带渐暗（远离光源）+ 整页倾斜微暗
    vec3 frontCol = base.rgb * (1.0 - uFrontDark * smoothstep(hinge - r, uSize.x, vD));
    frontCol *= 1.0 - 0.10 * sin(clamp(vAngle, 0.0, 1.5707963));
    // 背面：真实纸背纹理（双页）或暖调纸色 + 透字（单页）；
    // 落定尾段明度 → 1（移除瞬间与下层同页无缝衔接）
    vec3 backCol;
    if (uHasBackTex > 0.5) {
      vec2 btuv = vec2(mix(vUv.x, 1.0 - vUv.x, uBackMirror), 1.0 - vUv.y);
      backCol = texture2D(uBackTex, btuv).rgb;
    } else {
      backCol = mix(base.rgb, uBackTint, uBackWash);
    }
    backCol *= mix(uBackShade, 1.0, uLandFade);
    col = mix(frontCol, backCol, backness);
    // 落定淡出：随纸背显现比例消隐（背面全显 = 整页淡出）
    alpha = 1.0 - uLandFade * backness;
  } else if (isFlip) {
    if (vS > foldW * 0.5) {
      // 背面（折回平铺的纸背）：单一暖调纸色，贴近真实纸张——
      // 大比例混入纸色、保留约 18% 正面内容透出（隐约反字），均一
      // 明度略暗于下层页（压在上面的那张纸）
      col = mix(col, uBackTint, uBackWash);
      col *= uBackShade;
    } else if (vS > 0.0) {
      // 正面卷曲段：由桌面亮连续渐入纸背明度（终点 = 背面均色，无断差）
      col *= 1.0 - uFrontDark * smoothstep(0.0, foldW * 0.5, vS);
    }
    // 落定淡出：仅翻动页的背面平铺段按 uLandFade 消隐
    alpha = 1.0 - uLandFade * step(foldW, vS);
  }

  // 折痕根部 AO（卷曲圆柱自身投影；rotation 以书脊为根部）
  col *= 1.0 - uRootAo.x * exp(-abs(vS) / (rL * uRootAo.y + 2.0));

  // 书脊常驻 AO + 书沟谷着色：下层页与翻动页统一应用——翻动页的书脊侧
  // 平坦部分同样坐在沟里，缺失会让翻页时缝部一侧的弯曲阴影突然消失
  float spineAo = 1.0 - uSpineAo.x * smoothstep(uSpineAo.y, 0.0, vUv.x);
  col *= spineAo;
  if (uGutter > 0.5) {
    float dSpinePx = vUv.x * uSize.x;
    float gutterCrease = exp(-dSpinePx / max(uGutterCrease.y, 1.0));
    col *= 1.0 - uGutterCrease.x * (1.0 + 0.35 * uGutterFlex) * gutterCrease;
    float sheenT = (dSpinePx - uGutterRise.y) / max(uGutterRise.z, 1.0);
    float gutterSheen = exp(-sheenT * sheenT);
    col *= 1.0 + uGutterRise.x * gutterSheen;
  }

  if (uIsUnder > 0.5) {
    // 书口页叠边（纸厚暗示）：自由边 + 天头地脚露出薄层页缘
    float dFore = (1.0 - vUv.x) * uSize.x;   // 距自由边（规范空间恒 uv.x = 1）
    float dHead = vUv.y * uSize.y;           // 距天头
    float dTail = (1.0 - vUv.y) * uSize.y;   // 距地脚
    float stackW = uPaperT * uStackLayers;   // 叠边露出层数由 shading 配置

    // 装订侧书页叠边（单页模式显示书厚；双页书沟为光滑曲面，不显示层线）
    if (uGutter < 0.5) {
      float dBind = vUv.x * uSize.x;           // 距装订边（规范空间恒 uv.x = 0）
      float bindStrip = 1.0 - smoothstep(stackW * 0.7 - uPaperT * 0.5, stackW * 0.7, dBind);
      if (bindStrip > 0.003) {
        float bindShade = 1.0 - uStackLayerDepth * floor(dBind / uPaperT)
            - uStackLayerCrease * smoothstep(0.3, 0.5, abs(fract(dBind / uPaperT) - 0.5));
        col *= mix(1.0, bindShade, bindStrip);
      }
    }

    float foreStrip = 1.0 - smoothstep(stackW - uPaperT * 0.5, stackW, dFore);
    if (foreStrip > 0.003) {
      float sheetShade = 1.0 - uStackLayerDepth * floor(dFore / uPaperT)
          - uStackLayerCrease * smoothstep(0.3, 0.5, abs(fract(dFore / uPaperT) - 0.5));
      col *= mix(1.0, sheetShade, foreStrip);
      // 顶层页缘受光亮边
      col = mix(col, vec3(1.0), uStackTopLight * (1.0 - smoothstep(0.0, 0.8, dFore)));
    }
    float htW = stackW * uStackHtRatio;
    float headStrip = 1.0 - smoothstep(htW - uPaperT * 0.5, htW, dHead);
    float tailStrip = 1.0 - smoothstep(htW - uPaperT * 0.5, htW, dTail);
    if (headStrip > 0.003) {
      float shadeH = 1.0 - uStackLayerDepth * floor(dHead / uPaperT)
          - uStackLayerCrease * smoothstep(0.3, 0.5, abs(fract(dHead / uPaperT) - 0.5));
      col *= mix(1.0, shadeH, headStrip);
    }
    if (tailStrip > 0.003) {
      float shadeT = 1.0 - uStackLayerDepth * floor(dTail / uPaperT)
          - uStackLayerCrease * smoothstep(0.3, 0.5, abs(fract(dTail / uPaperT) - 0.5));
      col *= mix(1.0, shadeT, tailStrip);
    }

    if (uModel > 0.5) {
      // rotation：随翻越投影范围移动的软影——自由缘投影处窄软影 +
      // 页下方宽带减光；仅作用于被翻越侧的下层页，页面贴桌（起翻/
      // 落定）时无影（与下层接触，由书沟 AO 承担）
      float gate = 1.0 - min(abs(uUnderSide - uFlipSide), 1.0);
      float dPx = vUv.x * uSize.x;
      float span = max(uFlipSpan, 0.0);
      float wBand = uSize.x * (0.10 + 0.10 * uFlipHeight) + 8.0;
      float edgeShadow = exp(-pow((dPx - span) / wBand, 2.0));
      float broadW = span * 0.45 + 12.0;
      float broadShadow = 0.55 * exp(-pow((dPx - span * 0.55) / broadW, 2.0));
      float liftGate = smoothstep(0.02, 0.3, uFlipHeight);
      float shadow = uShadowStrength * gate * liftGate * clamp(edgeShadow + broadShadow, 0.0, 1.0);
      col *= 1.0 - shadow;
    } else {
      // fold：翻起页的接触投影——主影在折痕桌侧、次影在页下（窄带弱影）
      float w = max(uShadowWidth, 1.0);
      float t1 = exp(-pow((vS + 0.22 * w) / (0.30 * w), 2.0));
      float t2 = 0.35 * exp(-pow((vS - 0.12 * w) / (0.38 * w), 2.0));
      float shadow = uShadowStrength * clamp(t1 + t2, 0.0, 1.0);
      col *= 1.0 - shadow;
    }
  }

  if (uDebug > 0.5) {
    // 调试视图：分段分色（平铺灰蓝 / 卷曲绿 / 背面橙）+ 网格线；
    // rotation 按局部表面角与卷筒带划分，fold 按 vS 分段
    float hinge = max(uSize.x - max(uRadius, 0.25) * uCurlAngle, 0.0);
    vec3 dc = !isFlip ? vec3(0.55, 0.6, 0.72)
            : (uModel > 0.5
              ? (vAngle > 1.9 ? vec3(0.96, 0.62, 0.2)
                : (vD > hinge ? vec3(0.3, 0.76, 0.42) : vec3(0.55, 0.6, 0.72)))
              : (vS <= 0.0 ? vec3(0.55, 0.6, 0.72)
                : (vS > foldW ? vec3(0.96, 0.62, 0.2) : vec3(0.3, 0.76, 0.42))));
    vec2 cell = abs(fract(vUv * vec2(12.0, 18.0)) - 0.5);
    float line = smoothstep(0.46, 0.5, max(cell.x, cell.y));
    col = mix(dc, vec3(1.0, 0.2, 0.2), line * 0.5);
    alpha = 1.0;
  }

  gl_FragColor = vec4(col, alpha * uAlpha);
}
`;
