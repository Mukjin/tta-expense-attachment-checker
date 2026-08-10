import assert from 'node:assert/strict';
import { inspectExpense } from '../llm.js';

const originalFetch = globalThis.fetch;
let requestUrl = '';
let requestBody = null;
globalThis.fetch = async (url, options) => {
  requestUrl = String(url);
  requestBody = JSON.parse(options.body);
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          summary: '가상 문서 확인 후보 1건',
          findings: [{
            level: 'warn',
            file: '가상_거래명세서.pdf',
            item: '금액',
            message: '동일 의미 금액인지 사람 확인 필요',
            evidence: '합계 108,560원',
          }],
          cross_checks: [],
          limitations: ['실제 서명 이미지는 텍스트만으로 확인 불가'],
        }),
      },
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  const result = await inspectExpense('[첨부파일: 가상_거래명세서.pdf]\n합계 108,560원', {
    provider: 'openai',
    baseUrl: 'http://localhost:11434',
    model: 'virtual-model',
    apiKey: '',
  });
  assert.equal(requestUrl, 'http://localhost:11434/v1/chat/completions');
  assert.equal(requestBody.model, 'virtual-model');
  assert.match(requestBody.messages[0].content, /지출결의 증빙/);
  assert.match(requestBody.messages[1].content, /<<<UNTRUSTED_DOCUMENT>>>/);
  assert.equal(result.findings[0].level, 'warn');
  assert.equal(result.findings[0].file, '가상_거래명세서.pdf');
  assert.equal(result.crossChecks.length, 0);
} finally {
  globalThis.fetch = originalFetch;
}

let autoSelectedModel = '';
globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/v1/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'installed-local-model' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  autoSelectedModel = JSON.parse(options.body).model;
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ summary: '가상 검사', findings: [], cross_checks: [] }) },
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  await inspectExpense('가상 문서', {
    provider: 'openai',
    baseUrl: 'http://localhost:11434',
    model: '',
    apiKey: '',
  });
  assert.equal(autoSelectedModel, 'installed-local-model');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('expense-ai tests: ok');
