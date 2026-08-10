// 파싱된 첨부 텍스트에서 결정론적으로 추출 가능한 L2 필드를 요약한다.
// 원문 전체는 반환하지 않아 브라우저 세션·결과 UI에 남지 않게 한다.

const unique = (items) => [...new Set(items)];

export function isValidBusinessNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 10) return false;
  const nums = [...digits].map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * weights[i];
  sum += Math.floor((nums[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === nums[9];
}

export function extractContentFields(markdown) {
  const text = String(markdown || '').slice(0, 500000);
  const amounts = unique([...text.matchAll(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{2,})\s*원/g)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter(Number.isFinite));
  const dates = unique([...text.matchAll(/\b(20\d{2})[.\-/년]\s*(0?[1-9]|1[0-2])[.\-/월]\s*(0?[1-9]|[12]\d|3[01])(?:일)?\b/g)]
    .map((match) => `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`));
  const businessNumbers = unique([...text.matchAll(/\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{5})\b/g)]
    .map((match) => `${match[1]}-${match[2]}-${match[3]}`));
  const signatureCues = unique([
    ...text.matchAll(/(서명\s*또는\s*인|서명|날인|직인|결재|\(인\))/g),
  ].map((match) => match[1]));
  return {
    amounts,
    dates,
    businessNumbers: businessNumbers.map((value) => ({ value, valid: isValidBusinessNumber(value) })),
    signatureCues,
  };
}

const weight = (status) => ({ pass: 0, warn: 1, block: 2 })[status] ?? 1;
const MANUAL_SELECTION_CODES = new Set(['DOWNLOAD_URL_MISSING', 'CROSS_ORIGIN_ATTACHMENT']);

export function buildExpenseAiInput(parseResults, maxChars = 30000) {
  const sections = [];
  let remaining = Math.max(0, Number(maxChars) || 0);
  for (const item of parseResults || []) {
    if (!item?.success || item.isImageBased === true || remaining <= 0) continue;
    const name = String(item.name || item.fileName || '첨부파일')
      .replace(/[\r\n\0<>]/g, ' ')
      .trim()
      .slice(0, 240);
    const text = String(item.markdown || '').trim();
    if (!text) continue;
    const allowance = Math.min(12000, remaining);
    const selected = text.slice(0, allowance);
    sections.push(`[첨부파일: ${name}]\n${selected}\n[첨부파일 끝]`);
    remaining -= selected.length;
  }
  return sections.join('\n\n');
}

export function applyExpenseAiReview(check, review) {
  if (!review || typeof review !== 'object') return check;
  const knownNames = new Set((check.attachments || []).map((item) => item.name));
  const normalized = {
    summary: String(review.summary || ''),
    findings: (review.findings || []).filter((item) => !item.file || knownNames.has(item.file)),
    crossChecks: (review.crossChecks || []).map((item) => ({
      ...item,
      _specifiedFiles: Array.isArray(item.files) && item.files.length > 0,
      files: (item.files || []).filter((file) => knownNames.has(file)),
    })).filter((item) => !item._specifiedFiles || item.files.length > 0)
      .map(({ _specifiedFiles, ...item }) => item),
    limitations: Array.isArray(review.limitations) ? review.limitations : [],
  };
  check.issues = (check.issues || []).filter((issue) => issue.source !== 'ai');
  check.aiReview = normalized;
  const candidates = [
    ...(normalized.findings || []).map((item) => ({ ...item, kind: '파일검사' })),
    ...(normalized.crossChecks || []).map((item) => ({ ...item, kind: '교차검증', file: (item.files || []).join(', ') })),
  ];
  for (const item of candidates) {
    if (item.level !== 'warn' || !item.message) continue;
    check.issues.push({
      code: 'AI_REVIEW_CANDIDATE',
      source: 'ai',
      level: 'warn',
      title: `AI ${item.kind}: ${item.item || '확인 필요'}`,
      message: item.message,
      file: item.file || '',
      evidence: item.evidence || '',
    });
  }
  check.counts.aiWarnings = candidates.filter((item) => item.level === 'warn').length;
  check.status = check.issues.reduce(
    (current, issue) => (weight(issue.level) > weight(current) ? issue.level : current),
    check.status,
  );
  check.label = ({ pass: '통과', warn: '경고', block: '차단' })[check.status];
  return check;
}

export function applyContentResults(check, parseResults, { supplemental = false } = {}) {
  const parsedById = new Map((parseResults || []).map((item) => [item.id, item]));
  const parsedNames = new Set((parseResults || []).map((item) => item.name).filter(Boolean));
  check.issues = (check.issues || []).filter((issue) => {
    if (issue.source !== 'content') return true;
    if (!supplemental) return false;
    return !parsedNames.has(issue.attachmentName);
  });
  for (const attachment of check.attachments || []) {
    const parsed = parsedById.get(attachment.id)
      || (parseResults || []).find((item) => item.name === attachment.name);
    if (supplemental && !parsed) continue;
    if (!parsed?.success) {
      const manualRequired = MANUAL_SELECTION_CODES.has(parsed?.code);
      attachment.contentStatus = manualRequired ? 'manual_required' : 'unreadable';
      attachment.contentError = parsed?.error || '파일 내부 내용을 읽지 못했습니다.';
      check.issues.push({
        code: parsed?.code || 'CONTENT_UNREADABLE',
        source: 'content',
        attachmentName: attachment.name,
        level: manualRequired ? 'warn' : 'block',
        title: manualRequired ? `${attachment.name} 직접 선택 필요` : `${attachment.name} 검사불가`,
        message: attachment.contentError,
      });
      continue;
    }
    const needsOcr = parsed.isImageBased === true || parsed.qualitySummary?.needsOcr === true
      || parsed.warnings?.some((warning) => warning.code === 'NEEDS_OCR');
    if (needsOcr) {
      attachment.contentStatus = 'needs_ocr';
      attachment.contentError = '스캔·이미지 문서로 OCR이 필요합니다.';
      check.issues.push({
        code: 'OCR_REQUIRED',
        source: 'content',
        attachmentName: attachment.name,
        level: 'block',
        title: `${attachment.name} OCR 필요`,
        message: '안전 검토로 OCR 모듈이 비활성화되어 내부 내용을 확인하지 못했습니다.',
      });
      continue;
    }
    attachment.contentStatus = 'complete';
    attachment.fileType = parsed.fileType || attachment.extension;
    attachment.pageCount = parsed.pageCount || 0;
    attachment.textChars = parsed.textChars || 0;
    attachment.fields = extractContentFields(parsed.markdown);
    attachment.parseWarnings = (parsed.warnings || []).map((warning) => warning.code);
    if (parsed.truncated) {
      check.issues.push({
        code: 'CONTENT_TRUNCATED',
        source: 'content',
        attachmentName: attachment.name,
        level: 'warn',
        title: `${attachment.name} 내용 일부 제한`,
        message: '추출 본문이 500,000자를 넘어 앞부분만 필드 검사에 사용했습니다.',
      });
    }
  }

  check.scope = 'L1+L2';
  check.counts.contentComplete = (check.attachments || []).filter((item) => item.contentStatus === 'complete').length;
  check.counts.contentManual = (check.attachments || []).filter((item) => item.contentStatus === 'manual_required').length;
  check.counts.contentFailed = (check.attachments || []).filter((item) => ['unreadable', 'needs_ocr'].includes(item.contentStatus)).length;
  check.status = check.issues.reduce(
    (current, issue) => (weight(issue.level) > weight(current) ? issue.level : current),
    'pass',
  );
  check.label = ({ pass: '통과', warn: '경고', block: '차단' })[check.status];
  return check;
}
