import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../expense-checker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  attachmentExtension,
  checkExpenseAttachments,
  evaluateCondition,
  loadExpenseRules,
  normalizeAttachments,
  validateExpenseRules,
} = await import(moduleUrl);

assert.equal(attachmentExtension('가상_거래명세서.PDF'), 'pdf');
assert.equal(evaluateCondition({ field: 'expense.total', operator: 'gte', value: 100000 }, {
  expense: { total: '108,560' },
}), true);
assert.equal(evaluateCondition({ field: 'page.title', operator: 'matches', value: '가상.*구매' }, {
  page: { title: '가상 사무용품 구매' },
}), true);

assert.equal(normalizeAttachments([
  { name: '가상_견적서.pdf', href: 'https://example.test/a' },
  { name: '가상_견적서.pdf', href: 'https://example.test/a' },
]).length, 1);

const rules = {
  schema_version: '1.0',
  ruleset: { id: 'virtual-rules', version: '1' },
  expense_types: [{
    code: 'SUPPLY',
    name: '가상 물품구매',
    match: { field: 'expense.type', operator: 'eq', value: 'SUPPLY' },
    required_attachments: [
      {
        id: 'estimate',
        name: '견적서',
        severity: 'block',
        match: { filename_patterns: ['견적서'], extensions: ['pdf'] },
      },
      {
        id: 'tax',
        name: '세금계산서',
        severity: 'block',
        match: { filename_patterns: ['세금계산서'], extensions: ['pdf'] },
      },
      {
        id: 'contract',
        name: '계약서',
        severity: 'warn',
        when: { field: 'expense.total', operator: 'gte', value: 1000000 },
        match: { filename_patterns: ['계약서'], extensions: ['pdf'] },
      },
    ],
  }],
};
assert.equal(validateExpenseRules(rules).valid, true);

const invalidRules = structuredClone(rules);
invalidRules.expense_types[0].required_attachments[0].match.filename_patterns = ['('];
assert.equal(validateExpenseRules(invalidRules).valid, false);
assert.match(validateExpenseRules(invalidRules).errors.join(' '), /정규식/);

globalThis.chrome = {
  runtime: { getURL: (path) => `chrome-extension://virtual/${path}` },
  storage: { local: { get: async () => ({ expenseRules: rules }) } },
};
assert.equal((await loadExpenseRules()).ruleset.id, 'virtual-rules');
delete globalThis.chrome;

const blocked = checkExpenseAttachments(
  { expense: { type: 'SUPPLY', total: 108560 } },
  [{ name: '가상_견적서.pdf' }],
  rules,
);
assert.equal(blocked.status, 'block');
assert.equal(blocked.counts.discovered, 1);
assert.equal(blocked.counts.requirements, 2);
assert.equal(blocked.counts.missing, 1);
assert.equal(blocked.issues[0].title, '세금계산서 누락');

const passed = checkExpenseAttachments(
  { expense: { type: 'SUPPLY', total: 108560 } },
  [{ name: '가상_견적서.pdf' }, { name: '가상_세금계산서.pdf' }],
  rules,
);
assert.equal(passed.status, 'pass');
assert.equal(passed.counts.satisfied, 2);

const conditionalWarning = checkExpenseAttachments(
  { expense: { type: 'SUPPLY', total: 1500000 } },
  [{ name: '가상_견적서.pdf' }, { name: '가상_세금계산서.pdf' }],
  rules,
);
assert.equal(conditionalWarning.status, 'warn');
assert.equal(conditionalWarning.issues[0].title, '계약서 누락');

const alternativeRules = structuredClone(rules);
alternativeRules.expense_types[0].required_attachments.push({
  id: 'estimate-copy',
  name: '비교견적서',
  severity: 'block',
  alternatives: { any_of: ['estimate'] },
  match: { filename_patterns: ['비교견적서'], extensions: ['pdf'] },
});
const alternativePassed = checkExpenseAttachments(
  { expense: { type: 'SUPPLY', total: 108560 } },
  [{ name: '가상_견적서.pdf' }, { name: '가상_세금계산서.pdf' }],
  alternativeRules,
);
assert.equal(alternativePassed.status, 'pass');

const warning = checkExpenseAttachments({}, [{ name: '가상_영수증.pdf' }], { expense_types: [] });
assert.equal(warning.status, 'warn');
assert.equal(warning.issues[0].code, 'RULE_NOT_CONFIGURED');

console.log('expense-checker tests: ok');
