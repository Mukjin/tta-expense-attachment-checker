import assert from 'node:assert/strict';
import { inferExpenseContext } from '../expense-context.js';

const context = inferExpenseContext([{
  pairs: [
    { label: '제목', value: '가상 사무용품 구매' },
    { label: '지출 유형', value: '가상 물품구매' },
    { label: '지출금액', value: '108,560원' },
  ],
}], { url: 'https://example.test/virtual', title: '가상 결의' });

assert.equal(context.expense.title, '가상 사무용품 구매');
assert.equal(context.expense.type, '가상 물품구매');
assert.equal(context.expense.total, 108560);
assert.equal(context.page.url, 'https://example.test/virtual');

const fallback = inferExpenseContext([], { title: '가상 제목' });
assert.equal(fallback.expense.title, '가상 제목');
assert.equal(fallback.expense.total, null);

console.log('expense-context tests: ok');
