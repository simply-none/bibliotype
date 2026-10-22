/**
 * 设置分区的模板可用类型别名
 *
 * SFC 模板表达式里的 `x as T` 会被 vue 编译器原样写进渲染函数（运行时 import），
 * 若类型仍留在 `import { type T } from '@bibliotype/...'` 的取值语句里就会解析失败；
 * 因此在纯类型模块中集中再导出一次，模板侧一律从本文件取类型名。
 */
export type { PageChromeField } from '@bibliotype/layout';
