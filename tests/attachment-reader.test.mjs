import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../attachment-reader.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { parseAttachment, parserHealth } = await import(moduleUrl);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (String(url).endsWith('/parse')) {
    const body = JSON.parse(options.body);
    assert.equal(body.fileName, '가상_거래명세서.pdf');
    assert.equal(Buffer.from(body.contentBase64, 'base64').toString('utf8'), 'virtual-pdf');
    return new Response(JSON.stringify({
      success: true,
      fileType: 'pdf',
      markdown: '합계 108,560원',
      textChars: 12,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(Buffer.from('virtual-pdf'), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': '11' },
  });
};

try {
  const result = await parseAttachment({
    id: 'a',
    name: '가상_거래명세서.pdf',
    href: 'https://example.test/files/a.pdf',
    sourceUrl: 'about:blank',
    sourceOrigin: 'https://example.test',
  });
  assert.equal(result.success, true);
  assert.equal(result.fileType, 'pdf');
  assert.equal(calls.length, 2);

  const missing = await parseAttachment({ id: 'b', name: '가상_영수증.pdf' });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'DOWNLOAD_URL_MISSING');

  const crossOrigin = await parseAttachment({
    id: 'c',
    name: '가상_견적서.pdf',
    href: 'https://outside.test/a.pdf',
    sourceOrigin: 'https://example.test',
  });
  assert.equal(crossOrigin.code, 'CROSS_ORIGIN_ATTACHMENT');

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, service: 'edoc-parser' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal((await parserHealth()).ok, true);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, service: 'other-service' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal((await parserHealth()).ok, false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('attachment-reader tests: ok');
