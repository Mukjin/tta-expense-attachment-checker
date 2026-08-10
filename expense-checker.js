// 지출결의 첨부 L1 검사기.
// 화면·브라우저 API와 분리된 순수 판정 로직이라 규칙 회귀 테스트가 가능하다.

export const EXPENSE_RESULTS = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  BLOCK: 'block',
});

const RESULT_LABELS = Object.freeze({
  pass: '통과',
  warn: '경고',
  block: '차단',
});

const CONDITION_OPERATORS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'matches', 'exists']);

function validateCondition(condition, path, errors, depth = 0) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    errors.push(`${path}: 조건 객체가 필요합니다.`);
    return;
  }
  if (depth > 10) {
    errors.push(`${path}: 조건 중첩은 10단계를 넘을 수 없습니다.`);
    return;
  }
  const groups = ['all', 'any'].filter((key) => key in condition);
  if (groups.length) {
    const key = groups[0];
    if (!Array.isArray(condition[key]) || !condition[key].length) errors.push(`${path}.${key}: 하나 이상의 조건이 필요합니다.`);
    else condition[key].forEach((item, index) => validateCondition(item, `${path}.${key}[${index}]`, errors, depth + 1));
    return;
  }
  if ('not' in condition) return validateCondition(condition.not, `${path}.not`, errors, depth + 1);
  if (!String(condition.field || '').trim()) errors.push(`${path}.field: 필드 경로가 필요합니다.`);
  const operator = condition.operator || 'eq';
  if (!CONDITION_OPERATORS.has(operator)) errors.push(`${path}.operator: 지원하지 않는 연산자 ${operator}`);
  if (operator === 'matches') safeRegex(condition.value) || errors.push(`${path}.value: 유효한 200자 이하 정규식이 필요합니다.`);
}

export function validateExpenseRules(ruleset) {
  const errors = [];
  const warnings = [];
  if (!ruleset || typeof ruleset !== 'object' || Array.isArray(ruleset)) {
    return { valid: false, errors: ['최상위 JSON 객체가 필요합니다.'], warnings };
  }
  if (ruleset.schema_version !== '1.0') errors.push('schema_version은 "1.0"이어야 합니다.');
  if (!String(ruleset.ruleset?.id || '').trim()) errors.push('ruleset.id가 필요합니다.');
  if (!String(ruleset.ruleset?.version || '').trim()) errors.push('ruleset.version이 필요합니다.');
  if (!Array.isArray(ruleset.expense_types)) errors.push('expense_types 배열이 필요합니다.');
  const types = Array.isArray(ruleset.expense_types) ? ruleset.expense_types : [];
  const typeCodes = new Set();
  for (const [typeIndex, type] of types.entries()) {
    const path = `expense_types[${typeIndex}]`;
    const code = String(type?.code || '').trim();
    if (!code) errors.push(`${path}.code가 필요합니다.`);
    else if (typeCodes.has(code)) errors.push(`${path}.code가 중복되었습니다: ${code}`);
    else typeCodes.add(code);
    if (!String(type?.name || '').trim()) errors.push(`${path}.name이 필요합니다.`);
    validateCondition(type?.match, `${path}.match`, errors);
    if (!Array.isArray(type?.required_attachments)) {
      errors.push(`${path}.required_attachments 배열이 필요합니다.`);
      continue;
    }
    const requirementIds = new Set();
    for (const [reqIndex, requirement] of type.required_attachments.entries()) {
      const reqPath = `${path}.required_attachments[${reqIndex}]`;
      const id = String(requirement?.id || '').trim();
      if (!id) errors.push(`${reqPath}.id가 필요합니다.`);
      else if (requirementIds.has(id)) errors.push(`${reqPath}.id가 중복되었습니다: ${id}`);
      else requirementIds.add(id);
      if (!String(requirement?.name || '').trim()) errors.push(`${reqPath}.name이 필요합니다.`);
      if (requirement?.severity && !['warn', 'block'].includes(requirement.severity)) errors.push(`${reqPath}.severity는 warn 또는 block이어야 합니다.`);
      if (requirement?.when) validateCondition(requirement.when, `${reqPath}.when`, errors);
      const match = requirement?.match;
      if (!match || typeof match !== 'object') errors.push(`${reqPath}.match가 필요합니다.`);
      else {
        const patterns = Array.isArray(match.filename_patterns) ? match.filename_patterns : [];
        if (!patterns.length && !match.system_type_codes?.length) errors.push(`${reqPath}.match에는 filename_patterns 또는 system_type_codes가 필요합니다.`);
        patterns.forEach((pattern, index) => safeRegex(pattern) || errors.push(`${reqPath}.match.filename_patterns[${index}] 정규식이 올바르지 않습니다.`));
      }
    }
    for (const [reqIndex, requirement] of type.required_attachments.entries()) {
      for (const alternative of requirement?.alternatives?.any_of || []) {
        if (!requirementIds.has(alternative)) errors.push(`${path}.required_attachments[${reqIndex}].alternatives: 알 수 없는 요구사항 ${alternative}`);
      }
    }
  }
  if (!types.length) warnings.push('지출유형 규칙이 비어 있어 필수첨부 판정은 경고로 표시됩니다.');
  if (!ruleset.ruleset?.approved_by) warnings.push('승인자 정보가 비어 있습니다. 운영 적용 전 승인 이력을 기록하세요.');
  return { valid: errors.length === 0, errors, warnings };
}

const getPath = (obj, path) => String(path || '')
  .split('.')
  .filter(Boolean)
  .reduce((v, key) => (v == null ? undefined : v[key]), obj);

const comparable = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(s.replace(/,/g, ''))) return Number(s.replace(/,/g, ''));
  return s;
};

export function evaluateCondition(node, context) {
  if (!node) return true;
  if (Array.isArray(node.all)) return node.all.every((item) => evaluateCondition(item, context));
  if (Array.isArray(node.any)) return node.any.some((item) => evaluateCondition(item, context));
  if (node.not) return !evaluateCondition(node.not, context);

  const actual = getPath(context, node.field);
  const expected = node.value;
  switch (node.operator || 'eq') {
    case 'eq': return comparable(actual) === comparable(expected);
    case 'ne': return comparable(actual) !== comparable(expected);
    case 'gt': return comparable(actual) > comparable(expected);
    case 'gte': return comparable(actual) >= comparable(expected);
    case 'lt': return comparable(actual) < comparable(expected);
    case 'lte': return comparable(actual) <= comparable(expected);
    case 'in': return Array.isArray(expected) && expected.map(comparable).includes(comparable(actual));
    case 'contains': return String(actual ?? '').includes(String(expected ?? ''));
    case 'matches': {
      const pattern = String(expected ?? '');
      if (!pattern || pattern.length > 200) return false;
      try { return new RegExp(pattern, 'i').test(String(actual ?? '')); } catch { return false; }
    }
    case 'exists': return expected === false ? actual == null || actual === '' : actual != null && actual !== '';
    default: return false; // 알 수 없는 연산자는 안전하게 불일치 처리
  }
}

export function attachmentExtension(name) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

export function normalizeAttachments(raw = []) {
  const seen = new Set();
  const normalized = [];
  for (const [index, item] of raw.entries()) {
    const name = String(item?.name || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const href = String(item?.href || '').trim();
    const id = String(item?.id || item?.fileId || '').trim();
    const key = (id ? `id:${id}` : href ? `url:${href}` : `name:${name.toLowerCase()}`);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: id || `attachment-${index + 1}`,
      name,
      extension: String(item?.extension || attachmentExtension(name)).toLowerCase(),
      mimeType: String(item?.mimeType || '').toLowerCase(),
      href,
      sizeText: String(item?.sizeText || '').trim(),
      typeCode: String(item?.typeCode || '').trim(),
      selected: item?.selected === true,
      sourceUrl: String(item?.sourceUrl || '').trim(),
      sourceOrigin: String(item?.sourceOrigin || '').trim(),
      matchedRules: [],
      contentStatus: 'not_checked',
    });
  }
  return normalized;
}

const safeRegex = (pattern) => {
  const source = String(pattern || '');
  if (!source || source.length > 200) return null;
  try { return new RegExp(source, 'i'); } catch { return null; }
};

export function attachmentMatches(attachment, requirement) {
  const match = requirement?.match || {};
  const identities = [];
  if (match.system_type_codes?.length) {
    identities.push(match.system_type_codes.map(String).includes(attachment.typeCode));
  }
  if (match.filename_patterns?.length) {
    identities.push(match.filename_patterns.some((p) => safeRegex(p)?.test(attachment.name)));
  }
  if (!identities.length && requirement?.name) {
    identities.push(attachment.name.toLowerCase().includes(String(requirement.name).toLowerCase()));
  }
  const identityOk = identities.some(Boolean);
  const extensionOk = !match.extensions?.length
    || match.extensions.map((v) => String(v).toLowerCase().replace(/^\./, '')).includes(attachment.extension);
  const mimeOk = !match.mime_types?.length
    || match.mime_types.map((v) => String(v).toLowerCase()).includes(attachment.mimeType);
  return identityOk && extensionOk && mimeOk;
}

const resultWeight = (value) => ({ pass: 0, warn: 1, block: 2 })[value] ?? 1;
const normalizeSeverity = (value) => (value === 'block' ? 'block' : 'warn');

export function checkExpenseAttachments(context = {}, rawAttachments = [], ruleset = {}) {
  const attachments = normalizeAttachments(rawAttachments);
  const issues = [];
  if (!attachments.length) {
    issues.push({
      code: 'ATTACHMENT_LIST_EMPTY',
      level: 'block',
      title: '첨부파일 없음',
      message: '화면에서 검사 가능한 첨부파일을 찾지 못했음.',
    });
  }

  const types = Array.isArray(ruleset?.expense_types) ? ruleset.expense_types : [];
  const expenseType = types.find((type) => evaluateCondition(type.match, context));
  if (!expenseType) {
    issues.push({
      code: 'RULE_NOT_CONFIGURED',
      level: 'warn',
      title: '적용 규칙 미설정',
      message: '현재 지출유형에 적용할 승인 규칙이 없어 첨부 존재 여부만 확인함.',
    });
  }

  const requirements = (expenseType?.required_attachments || [])
    .filter((requirement) => evaluateCondition(requirement.when, context));
  const states = new Map();

  for (const requirement of requirements) {
    const matches = attachments.filter((attachment) => attachmentMatches(attachment, requirement));
    for (const attachment of matches) attachment.matchedRules.push(requirement.id || requirement.name || 'rule');
    states.set(requirement.id, { requirement, matches, satisfied: matches.length > 0 });
  }

  // 대체 증빙은 참조된 요구사항 중 하나가 충족됐을 때 현재 요구사항을 충족한 것으로 본다.
  for (const state of states.values()) {
    if (state.satisfied) continue;
    const alternatives = state.requirement?.alternatives?.any_of || [];
    state.satisfied = alternatives.some((id) => states.get(id)?.satisfied);
  }

  for (const state of states.values()) {
    if (state.satisfied) continue;
    const requirement = state.requirement;
    const level = normalizeSeverity(requirement.severity);
    issues.push({
      code: 'REQUIRED_ATTACHMENT_MISSING',
      ruleId: requirement.id || '',
      level,
      title: `${requirement.name || '필수 첨부'} 누락`,
      message: requirement.reason || '지출유형별 필수 증빙이 첨부되지 않았음.',
      obtainFrom: requirement.obtain_from || '',
    });
  }

  const status = issues.reduce(
    (current, issue) => (resultWeight(issue.level) > resultWeight(current) ? issue.level : current),
    'pass',
  );
  const satisfiedCount = [...states.values()].filter((state) => state.satisfied).length;
  return {
    status,
    label: RESULT_LABELS[status],
    scope: 'L1',
    rulesetId: ruleset?.ruleset?.id || '',
    rulesetVersion: ruleset?.ruleset?.version || '',
    expenseType: expenseType ? { code: expenseType.code || '', name: expenseType.name || '' } : null,
    attachments,
    issues,
    counts: {
      discovered: attachments.length,
      requirements: requirements.length,
      satisfied: satisfiedCount,
      missing: requirements.length - satisfiedCount,
    },
  };
}

export async function loadExpenseRules(path = 'expense-rules.json') {
  if (!globalThis.chrome?.runtime?.getURL) return { ruleset: {}, expense_types: [] };
  const stored = await chrome.storage?.local?.get?.('expenseRules').catch(() => ({}));
  if (stored?.expenseRules) {
    const validation = validateExpenseRules(stored.expenseRules);
    if (validation.valid) return stored.expenseRules;
    console.warn('[edoc] 저장된 지출 증빙 규칙이 유효하지 않아 번들 규칙을 사용합니다:', validation.errors);
  }
  const url = chrome.runtime.getURL(path);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('[edoc] 지출 증빙 규칙을 불러오지 못했습니다:', error.message);
    return { ruleset: {}, expense_types: [] };
  }
}
