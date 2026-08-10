// 첨부 원본을 같은 출처에서 메모리로 읽어 로컬 파서에 전달한다.
// 원본 base64와 추출 전문은 호출이 끝난 뒤 반환 객체에 남기지 않는다.

export const PARSER_BASE_URL = 'http://127.0.0.1:11435';
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const sameOrigin = (href, sourceUrl, sourceOrigin) => {
  try {
    const expected = sourceOrigin || new URL(sourceUrl).origin;
    return new URL(href).origin === expected;
  } catch { return false; }
};

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export async function parserHealth(signal) {
  try {
    const response = await fetch(`${PARSER_BASE_URL}/health`, { cache: 'no-store', signal });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const health = await response.json();
    if (health?.ok !== true || health?.service !== 'edoc-parser') {
      return { ok: false, error: '11435 포트의 응답이 지출 첨부 파서가 아닙니다.' };
    }
    return health;
  } catch {
    return { ok: false, error: '로컬 문서 파서에 연결할 수 없습니다.' };
  }
}

export async function parseUploadedAttachment({ id, name, contentBase64 }, { signal } = {}) {
  try {
    const parsedResponse = await fetch(`${PARSER_BASE_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: name, contentBase64 }),
      cache: 'no-store',
      signal,
    });
    const parsed = await parsedResponse.json().catch(() => null);
    if (!parsed) throw new Error(`로컬 파서 응답 형식 오류 (HTTP ${parsedResponse.status})`);
    return { id, name, stage: 'parse', ...parsed };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return {
      id,
      name,
      success: false,
      stage: 'parser',
      code: 'PARSER_OFFLINE',
      error: error instanceof Error ? error.message : '로컬 파서 연결 실패',
    };
  }
}

export async function parseAttachment(attachment, { signal } = {}) {
  if (!attachment.href) {
    return {
      id: attachment.id,
      name: attachment.name,
      success: false,
      stage: 'download',
      code: 'DOWNLOAD_URL_MISSING',
      error: '화면에서 첨부 다운로드 주소를 찾지 못했습니다.',
    };
  }
  if (!sameOrigin(attachment.href, attachment.sourceUrl, attachment.sourceOrigin)) {
    return {
      id: attachment.id,
      name: attachment.name,
      success: false,
      stage: 'download',
      code: 'CROSS_ORIGIN_ATTACHMENT',
      error: '다른 출처의 첨부 주소는 자동으로 읽지 않습니다.',
    };
  }

  try {
    const response = await fetch(attachment.href, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal,
    });
    if (!response.ok) throw new Error(`첨부 다운로드 HTTP ${response.status}`);
    const announced = Number(response.headers.get('content-length') || 0);
    if (announced > MAX_FILE_BYTES) throw new Error('첨부파일이 32MB 제한을 초과했습니다.');
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('첨부파일이 비어 있습니다.');
    if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('첨부파일이 32MB 제한을 초과했습니다.');

    const parsedResponse = await fetch(`${PARSER_BASE_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: attachment.name, contentBase64: toBase64(buffer) }),
      cache: 'no-store',
      signal,
    });
    const parsed = await parsedResponse.json().catch(() => null);
    if (!parsed) throw new Error(`로컬 파서 응답 형식 오류 (HTTP ${parsedResponse.status})`);
    return {
      id: attachment.id,
      name: attachment.name,
      stage: 'parse',
      ...parsed,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return {
      id: attachment.id,
      name: attachment.name,
      success: false,
      stage: 'download',
      code: 'DOWNLOAD_OR_PARSER_ERROR',
      error: error instanceof Error ? error.message : '첨부 처리 중 오류가 발생했습니다.',
    };
  }
}

export async function parseAllAttachments(attachments, { signal, onProgress } = {}) {
  const health = await parserHealth(signal);
  if (!health.ok) {
    return attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      success: false,
      stage: 'parser',
      code: 'PARSER_OFFLINE',
      error: health.error || '로컬 문서 파서가 실행되지 않았습니다.',
    }));
  }
  const results = [];
  for (const [index, attachment] of attachments.entries()) {
    if (signal?.aborted) throw Object.assign(new Error('요청이 취소되었습니다.'), { name: 'AbortError' });
    onProgress?.(index + 1, attachments.length, attachment);
    results.push(await parseAttachment(attachment, { signal }));
  }
  return results;
}
