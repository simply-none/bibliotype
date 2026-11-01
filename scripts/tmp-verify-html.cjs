/* 验证 epubToHtml 产物携带 data-source-anchor（用后即删） */
const fs = require('fs');
const { epubToHtml } = require('C:/cod/note_npm/packages/import-epub/dist/index.cjs');
const epubPath = process.argv[2];
const buf = fs.readFileSync(epubPath);
const html = epubToHtml(new Uint8Array(buf), {});
const hits = html.match(/data-source-anchor="[^"]+"/g) ?? [];
console.log('sourceAnchor count:', hits.length);
console.log('samples:', hits.slice(0, 4));
const sigil = html.match(/<h4[^>]*sigil_toc_id_6[^>]*>/) ?? html.match(/<[^>]*id="sigil_toc_id_6"[^>]*>/);
console.log('target heading tag:', sigil ? sigil[0].slice(0, 160) : 'not found');
