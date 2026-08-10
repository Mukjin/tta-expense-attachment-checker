import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../expense-content-checker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  applyContentResults,
  applyExpenseAiReview,
  buildExpenseAiInput,
  extractContentFields,
  isValidBusinessNumber,
} = await import(moduleUrl);

assert.equal(isValidBusinessNumber('123-45-67891'), true);
assert.equal(isValidBusinessNumber('123-45-67890'), false);

const fields = extractContentFields(`
  가상 거래명세서
  합계 108,560원
  거래일 2026. 06. 17.
  사업자등록번호 123-45-67891
  담당자 서명
`);
assert.deepEqual(fields.amounts, [108560]);
assert.deepEqual(fields.dates, ['2026-06-17']);
assert.deepEqual(fields.businessNumbers, [{ value: '123-45-67891', valid: true }]);
assert.deepEqual(fields.signatureCues, ['서명']);

const baseCheck = {
  status: 'pass',
  label: '통과',
  scope: 'L1',
  attachments: [
    { id: 'a', name: '가상_거래명세서.pdf' },
    { id: 'b', name: '가상_세금계산서.pdf' },
  ],
  issues: [],
  counts: {},
};
const result = applyContentResults(baseCheck, [
  { id: 'a', success: true, fileType: 'pdf', markdown: '합계 108,560원', textChars: 12 },
  { id: 'b', success: false, code: 'ENCRYPTED', error: '암호화 문서' },
]);
assert.equal(result.status, 'block');
assert.equal(result.scope, 'L1+L2');
assert.equal(result.counts.contentComplete, 1);
assert.equal(result.counts.contentFailed, 1);
assert.equal(result.attachments[1].contentStatus, 'unreadable');

const manualCheck = applyContentResults({
  status: 'pass',
  label: '통과',
  scope: 'L1',
  attachments: [{ id: 'c', name: '가상_영수증.pdf' }],
  issues: [],
  counts: {},
}, [
  { id: 'c', success: false, code: 'DOWNLOAD_URL_MISSING', error: '다운로드 주소 없음' },
]);
assert.equal(manualCheck.status, 'warn');
assert.equal(manualCheck.label, '경고');
assert.equal(manualCheck.counts.contentManual, 1);
assert.equal(manualCheck.counts.contentFailed, 0);
assert.equal(manualCheck.attachments[0].contentStatus, 'manual_required');
assert.equal(manualCheck.issues[0].level, 'warn');

const aiInput = buildExpenseAiInput([
  { success: true, name: '가상_거래명세서.pdf', markdown: '합계 108,560원' },
  { success: false, name: '가상_암호문서.pdf', markdown: '포함되면 안 됨' },
]);
assert.match(aiInput, /가상_거래명세서\.pdf/);
assert.doesNotMatch(aiInput, /가상_암호문서/);

applyExpenseAiReview(result, {
  summary: '사람 확인 필요 후보 1건',
  findings: [{ level: 'warn', file: '가상_거래명세서.pdf', item: '금액', message: '합계 의미 확인 필요' }],
  crossChecks: [],
  limitations: [],
});
assert.equal(result.aiReview.summary, '사람 확인 필요 후보 1건');
assert.equal(result.counts.aiWarnings, 1);
assert.equal(result.issues.at(-1).source, 'ai');

applyExpenseAiReview(result, {
  summary: '알 수 없는 파일명 후보',
  findings: [{ level: 'warn', file: '존재하지않는파일.pdf', item: '기타', message: '반영되면 안 됨' }],
  crossChecks: [],
  limitations: [],
});
assert.equal(result.aiReview.findings.length, 0);
assert.equal(result.issues.some((issue) => issue.message === '반영되면 안 됨'), false);

applyContentResults(result, [
  { id: 'b', name: '가상_세금계산서.pdf', success: true, fileType: 'pdf', markdown: '합계 108,560원' },
], { supplemental: true });
assert.equal(result.attachments[0].contentStatus, 'complete');
assert.equal(result.attachments[1].contentStatus, 'complete');
assert.equal(result.counts.contentFailed, 0);
assert.equal(result.issues.some((issue) => issue.attachmentName === '가상_세금계산서.pdf'), false);

console.log('expense-content-checker tests: ok');
