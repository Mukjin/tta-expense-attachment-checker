import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const publicKey = Buffer.from(manifest.key, 'base64');
const digest = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
const extensionId = [...digest]
  .flatMap((byte) => [byte >> 4, byte & 15])
  .map((nibble) => String.fromCharCode(97 + nibble))
  .join('');
const expectedId = (await readFile(new URL('../distribution/extension-id.txt', import.meta.url), 'ascii')).trim();

assert.equal(extensionId, expectedId);
assert.equal(manifest.version, '0.5.0');
assert.ok(manifest.host_permissions.includes('https://gw.tta.or.kr/*'));
assert.ok(manifest.content_scripts.some((script) => script.matches.includes('https://gw.tta.or.kr/*') && script.js.includes('widget.js')));
assert.ok(!manifest.permissions.includes('nativeMessaging'));

console.log(`distribution tests: ok (${extensionId})`);

