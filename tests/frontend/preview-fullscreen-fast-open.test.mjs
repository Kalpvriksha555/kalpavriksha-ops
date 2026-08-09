import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fileService = fs.readFileSync(new URL('../../frontend/src/services/fileService.js', import.meta.url), 'utf8');
const viewer = fs.readFileSync(new URL('../../frontend/src/components/files/UnifiedFileViewer.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');

test('PDF preview starts the authenticated stream without a blocking HEAD round trip', () => {
  const pdfBranch = fileService.indexOf("if (kind === 'pdf')");
  const mediaHeadBranch = fileService.indexOf("if (['image', 'video', 'audio'].includes(kind))");
  const headRequest = fileService.indexOf("method: 'HEAD'", mediaHeadBranch);
  assert.ok(pdfBranch > 0, 'dedicated PDF fast-stream branch is missing');
  assert.ok(mediaHeadBranch > pdfBranch, 'PDF must bypass the media HEAD branch');
  assert.ok(headRequest > mediaHeadBranch, 'HEAD should remain only for non-PDF media validation');
  assert.match(fileService.slice(pdfBranch, mediaHeadBranch), /optimisticStream: true/);
  assert.doesNotMatch(fileService.slice(pdfBranch, mediaHeadBranch), /method:\s*['\"]HEAD['\"]/);
});

test('unified PDF viewer has a deterministic near-full-viewport height independent of arbitrary utility generation', () => {
  assert.match(viewer, /kalpa-unified-viewer-panel/);
  assert.match(viewer, /kalpa-unified-pdf-stage/);
  assert.match(viewer, /kalpa-unified-pdf-frame/);
  assert.match(css, /\.kalpa-unified-viewer-panel\s*\{[\s\S]*height:\s*min\(94dvh,\s*980px\)\s*!important/);
  assert.match(css, /\.kalpa-unified-viewer-content\s*\{[\s\S]*flex:\s*1 1 0%\s*!important[\s\S]*height:\s*0\s*!important/);
  assert.match(css, /\.kalpa-unified-pdf-frame\s*\{[\s\S]*position:\s*absolute\s*!important[\s\S]*height:\s*100%\s*!important/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*\.kalpa-unified-viewer-panel\s*\{[\s\S]*height:\s*100dvh\s*!important/);
});
