// 로컬 문서 파서 서비스.
// 127.0.0.1에만 바인딩하고 원본은 디스크에 저장하지 않은 채 Buffer로 kordoc에 전달한다.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { parse, VERSION as KORDOC_VERSION } from 'kordoc';

export const DEFAULT_PORT = 11435;
export const DEFAULT_EXTENSION_ID = 'lmkejmofkdcjnfcnmjgekbfippdklaco';
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BODY_BYTES = Math.ceil(MAX_FILE_BYTES * 4 / 3) + (1024 * 1024);
const MAX_MARKDOWN_CHARS = 500000;
const EXTENSION_ID = /^[a-p]{32}$/;

const json = (res, status, body, origin = '') => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
};

export const extensionOrigin = (extensionId = process.env.EDOC_EXTENSION_ID || DEFAULT_EXTENSION_ID) => {
  const id = String(extensionId).trim();
  return EXTENSION_ID.test(id) ? `chrome-extension://${id}` : '';
};

const allowedOrigin = (req, expectedOrigin) => {
  const origin = String(req.headers.origin || '');
  // 브라우저가 아닌 로컬 상태 점검 요청은 Origin이 없을 수 있다.
  if (!origin) return '';
  return expectedOrigin && origin === expectedOrigin ? origin : null;
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  let overflow = false;
  const chunks = [];
  req.on('data', (chunk) => {
    if (overflow) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      overflow = true;
      chunks.length = 0;
      reject(Object.assign(new Error('요청 크기가 제한을 초과했습니다.'), { status: 413 }));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (overflow) return;
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      reject(Object.assign(new Error('JSON 요청 형식이 올바르지 않습니다.'), { status: 400 }));
    }
  });
  req.on('error', reject);
});

const decodeBase64 = (value) => {
  const source = String(value || '').replace(/\s+/g, '');
  if (!source || source.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) {
    throw Object.assign(new Error('파일 데이터가 올바른 base64가 아닙니다.'), { status: 400 });
  }
  const buffer = Buffer.from(source, 'base64');
  if (!buffer.length) throw Object.assign(new Error('빈 파일은 검사할 수 없습니다.'), { status: 400 });
  if (buffer.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error(`파일 크기가 ${MAX_FILE_BYTES / 1024 / 1024}MB 제한을 초과했습니다.`), { status: 413 });
  }
  return buffer;
};

export async function parseDocument({ fileName, contentBase64 }) {
  const safeName = String(fileName || 'attachment').replace(/[\r\n\0]/g, '').slice(0, 240);
  const buffer = decodeBase64(contentBase64);
  const result = await parse(buffer, {
    ocr: false, // 취약한 선택적 네이티브 OCR 모듈은 설치하지 않는다.
    removeHeaderFooter: true,
    keepTrailingEmptyCols: true,
  });
  if (!result.success) {
    return {
      success: false,
      fileName: safeName,
      fileType: result.fileType,
      code: result.code || 'PARSE_ERROR',
      error: result.error || '문서 파싱에 실패했습니다.',
      pageCount: result.pageCount || 0,
      isImageBased: result.isImageBased === true,
    };
  }
  const fullMarkdown = String(result.markdown || '');
  const truncated = fullMarkdown.length > MAX_MARKDOWN_CHARS;
  return {
    success: true,
    fileName: safeName,
    fileType: result.fileType,
    pageCount: result.pageCount || 0,
    isImageBased: result.isImageBased === true,
    markdown: fullMarkdown.slice(0, MAX_MARKDOWN_CHARS),
    textChars: fullMarkdown.length,
    truncated,
    warnings: (result.warnings || []).map((warning) => ({
      code: warning.code,
      page: warning.page || null,
      message: String(warning.message || '').slice(0, 500),
    })),
    qualitySummary: result.qualitySummary || null,
  };
}

export function createParserServer({ extensionId = process.env.EDOC_EXTENSION_ID || DEFAULT_EXTENSION_ID } = {}) {
  const expectedOrigin = extensionOrigin(extensionId);
  return http.createServer(async (req, res) => {
    const origin = allowedOrigin(req, expectedOrigin);
    if (origin === null) return json(res, 403, { error: '허용되지 않은 호출 출처입니다.' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { ok: true, service: 'edoc-parser', kordoc: KORDOC_VERSION }, origin);
    }
    if (req.method !== 'POST' || req.url !== '/parse') {
      return json(res, 404, { error: '지원하지 않는 경로입니다.' }, origin);
    }
    try {
      const body = await readJsonBody(req);
      const result = await parseDocument(body);
      return json(res, result.success ? 200 : 422, result, origin);
    } catch (error) {
      return json(res, Number(error.status) || 500, {
        error: error instanceof Error ? error.message : '문서 파싱 중 오류가 발생했습니다.',
      }, origin);
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const rawPort = Number(process.env.EDOC_PARSER_PORT || DEFAULT_PORT);
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_PORT;
  const origin = extensionOrigin();
  if (!origin) {
    console.error('[edoc-parser] EDOC_EXTENSION_ID가 필요합니다. edge://extensions에서 확장 ID를 확인하세요.');
    process.exitCode = 1;
  } else {
    const server = createParserServer();
    server.listen(port, '127.0.0.1', () => {
      console.log(`[edoc-parser] http://127.0.0.1:${port} · kordoc ${KORDOC_VERSION} · 허용 ${origin}`);
    });
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
  }
}
