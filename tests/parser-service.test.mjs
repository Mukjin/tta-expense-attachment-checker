import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createParserServer, extensionOrigin, parseDocument } from '../parser-service.mjs';

const makePdf = (text) => {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
};

const parsed = await parseDocument({
  fileName: 'virtual.pdf',
  contentBase64: makePdf('Virtual total 108,560').toString('base64'),
});
assert.equal(parsed.success, true);
assert.equal(parsed.fileType, 'pdf');
assert.match(parsed.markdown, /Virtual total 108,560/);

const templateDir = new URL('../node_modules/kordoc/templates/', import.meta.url);
const hwpxName = (await readdir(templateDir)).find((name) => name.toLowerCase().endsWith('.hwpx'));
assert.ok(hwpxName, 'kordoc HWPX fixture가 있어야 함');
const hwpx = await parseDocument({
  fileName: 'virtual-form.hwpx',
  contentBase64: (await readFile(new URL(hwpxName, templateDir))).toString('base64'),
});
assert.equal(hwpx.success, true);
assert.equal(hwpx.fileType, 'hwpx');
assert.ok(hwpx.textChars > 0);

await assert.rejects(
  () => parseDocument({ fileName: 'empty.pdf', contentBase64: '' }),
  /빈 파일|base64/,
);
await assert.rejects(
  () => parseDocument({ fileName: 'invalid.pdf', contentBase64: 'abc' }),
  /base64/,
);

const virtualExtensionId = 'abcdefghijklmnopabcdefghijklmnop';
assert.equal(extensionOrigin(virtualExtensionId), `chrome-extension://${virtualExtensionId}`);
assert.equal(extensionOrigin('invalid'), '');

const server = createParserServer({ extensionId: virtualExtensionId });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const health = await fetch(`http://127.0.0.1:${address.port}/health`).then((response) => response.json());
assert.equal(health.ok, true);
const allowed = await fetch(`http://127.0.0.1:${address.port}/health`, {
  headers: { Origin: `chrome-extension://${virtualExtensionId}` },
});
assert.equal(allowed.status, 200);
assert.equal(allowed.headers.get('access-control-allow-origin'), `chrome-extension://${virtualExtensionId}`);
const denied = await fetch(`http://127.0.0.1:${address.port}/health`, {
  headers: { Origin: 'chrome-extension://pppppppppppppppppppppppppppppppp' },
});
assert.equal(denied.status, 403);
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

console.log('parser-service tests: ok');
