/**
 * 最小 4×4 矩阵工具（列主序，与 WebGL uniformMatrix4fv 约定一致）。
 * 本 demo 仅需透视投影 + 平移视图两个构造器。
 */
export type Mat4 = Float32Array;

/** 透视投影矩阵。 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/** 平移视图矩阵（相机位于 +z，看向 −z）。 */
export function translateZ(tz: number): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  out[14] = tz;
  return out;
}

/** a × b（4×4 列主序乘法）。 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
