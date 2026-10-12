<script setup lang="ts">
/**
 * 编辑画布（BtEditor）
 *
 * - props.editor：BookEditor 实例（由使用方创建 / 管理生命周期）；
 * - 默认插槽作用域透传 EditorBinding（供工具条访问命令与激活态）；
 * - 挂载时创建 EditorView，卸载时销毁；editor 实例替换时重建视图。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BookEditor } from '@bibliotype/editor';
import { useEditorBinding } from '../use-editor.js';
import 'prosemirror-view/style/prosemirror.css';

const props = defineProps<{ editor: BookEditor }>();

const canvasRef = ref<HTMLElement | null>(null);
const binding = useEditorBinding(props.editor);

onMounted(() => {
  if (canvasRef.value !== null) {
    binding.attach(canvasRef.value);
  }
});

onBeforeUnmount(() => {
  binding.detach();
});

// editor 实例替换（如切换文档后重建）时重新挂载视图
watch(
  () => props.editor,
  () => {
    if (canvasRef.value !== null) {
      binding.attach(canvasRef.value);
    }
  },
);
</script>

<template>
  <div class="bt-editor">
    <div v-if="$slots.default" class="bt-editor__toolbar">
      <slot v-bind="binding" />
    </div>
    <div ref="canvasRef" class="bt-editor__canvas" />
  </div>
</template>

<style scoped>
.bt-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.bt-editor__toolbar {
  flex: none;
}

.bt-editor__canvas {
  width: 100%;
  max-width: 760px;
  min-height: 480px;
  margin: 0 auto;
  padding: 36px 44px;

  /* 纸面配色可由使用方经 CSS 变量覆盖（如夜间模式） */
  background: var(--bt-editor-paper, #fff);
  color: var(--bt-editor-ink, #1f1f1f);
  border-radius: 10px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 10%);
  overflow-y: auto;
}

.bt-editor__canvas :deep(.ProseMirror) {
  min-height: 400px;
  outline: none;
  line-height: 1.9;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.bt-editor__canvas :deep(.ProseMirror p) {
  margin: 0 0 0.6em;
}
</style>
