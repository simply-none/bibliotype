<script setup lang="ts">
/**
 * 修订页签（C5）：接受 / 拒绝修订、切换修订模式与查看视图
 *
 * 由 `LibraryDrawer` 容器按页签挂载；订阅编辑器变更以驱动 `revisionTick` 重算
 * 修订模型，退订在组件卸载时完成（原容器的 editor watch 语义等价下移到本组件）。
 */
import { BtRevisionSidebar, buildRevisionModel } from '@bibliotype/vue';
import { collectRevisions, type BookDocument, type RevisionView } from '@bibliotype/core';
import {
  acceptAllRevisions,
  acceptRevision,
  rejectAllRevisions,
  rejectRevision,
  setRevisionMode,
  type BookEditor,
} from '@bibliotype/editor';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{
  /** 当前文档（阅读态取此文档收集修订） */
  document: BookDocument;
  /** 编辑器实例（编辑态收集修订 / 下发命令；阅读态为 null） */
  editor?: BookEditor | null;
}>();

const emit = defineEmits<{
  (event: 'notify', message: string): void;
}>();

const revisionEnabled = ref(false);
const revisionView = ref<RevisionView>('marked');
const revisionTick = ref(0);
let unsubscribeEditor: (() => void) | undefined;

watch(
  () => props.editor,
  (editor) => {
    unsubscribeEditor?.();
    if (editor != null) {
      unsubscribeEditor = editor.onChange(() => {
        revisionTick.value += 1;
      });
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  unsubscribeEditor?.();
});

const revisionModel = computed(() => {
  void revisionTick.value;
  const document = props.editor?.getDocument() ?? props.document;
  return buildRevisionModel(collectRevisions(document), { now: Date.now() });
});

function runEditorCommand(command: typeof acceptAllRevisions): void {
  const editor = props.editor;
  if (editor == null) {
    emit('notify', '请进入编辑模式后再处理修订');
    return;
  }
  command(editor.editorState, (tr) => editor.dispatch(tr));
  revisionTick.value += 1;
}

function toggleRevisionMode(enabled: boolean): void {
  revisionEnabled.value = enabled;
  runEditorCommand(setRevisionMode(enabled));
}

function setView(view: RevisionView): void {
  revisionView.value = view;
}
</script>

<template>
  <BtRevisionSidebar
    :model="revisionModel"
    :view="revisionView"
    :enabled="revisionEnabled"
    :author="'demo'"
    @set-mode="toggleRevisionMode"
    @set-view="setView"
    @accept="(changeId) => runEditorCommand(acceptRevision(changeId))"
    @reject="(changeId) => runEditorCommand(rejectRevision(changeId))"
    @accept-all="runEditorCommand(acceptAllRevisions)"
    @reject-all="runEditorCommand(rejectAllRevisions)"
    @locate="(path) => emit('notify', `修订位置：${path}`)"
  />
</template>
