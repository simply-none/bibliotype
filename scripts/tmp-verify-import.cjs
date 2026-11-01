/* Node 侧验证导入产物（用后即删） */
const fs = require('fs');
const path = require('path');
const { epubToBookDocument } = require('C:/cod/note_npm/packages/import-epub/dist/index.cjs');
const { buildClassicalEditorSchema } = require('C:/cod/note_npm/packages/classical/dist/editor.cjs');

const epubPath = process.argv[2];
const buf = fs.readFileSync(epubPath);
const schema = buildClassicalEditorSchema();
const doc = epubToBookDocument(new Uint8Array(buf), schema, { title: '验证' });

// 找目标标题块，检查 attrs
let hit = null;
let tocEntry = null;
const scan = (node) => {
  const text = (node.children ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  if (node.type === 'heading' && /第一部分\s+自律/.test(text) && hit === null) {
    hit = { id: node.id, attrs: JSON.stringify(node.attrs ?? {}).slice(0, 160), type: node.type };
  }
  if ((node.marks ?? []).some(m => String(m.attrs?.href ?? '').includes('sigil_toc_id_6')) && tocEntry === null) {
    tocEntry = { text: text.slice(0, 14), href: (node.marks ?? []).map(m => m.attrs?.href)[0] };
  }
  for (const child of node.children ?? []) scan(child);
};
scan(doc.root);
console.log(JSON.stringify({ heading: hit, tocEntry }, null, 1));
