import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', editor: 'src/editor.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  external: ['@bibliotype/core', '@bibliotype/editor', 'prosemirror-model', 'prosemirror-state'],
});
