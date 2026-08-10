// 복사·내보내기용 마크다운 생성 (background·popup 공용).

export function buildMarkdown(r) {
  const lines = [`# [${r.doc_type || '문서'}] ${r.title || r.one_line || ''}`];
  if (r.title && r.one_line) lines.push(`> ${r.one_line}`);
  const info = [];
  if (r.doc_no) info.push(`**문서번호**: ${r.doc_no}`);
  if (r.sent_date) info.push(`**시행일**: ${r.sent_date}`);
  if (r.sender) info.push(`**발신**: ${r.sender}`);
  if (r.receiver) info.push(`**수신**: ${r.receiver}`);
  if (info.length) lines.push('', info.join(' · '));
  if (r.deadline) lines.push(`\n**기한**: ${r.deadline}`);
  if (r.key_points?.length) lines.push('\n## 핵심 내용', ...r.key_points.map((k) => `- ${k}`));
  if (r.actions?.length) lines.push('\n## 조치 사항', ...r.actions.map((a) => `- [ ] ${a}`));
  if (r.cautions?.length) lines.push('\n## 주의', ...r.cautions.map((c) => `- ⚠ ${c}`));
  lines.push(`\n---\n_${new Date().toLocaleString('ko-KR')} · 전자문서 AI 요약 (AI 생성 — 원문 확인 필요)_`);
  return lines.join('\n');
}

export function buildReviewMarkdown(v) {
  const lines = [`# [AI 검토] ${v.status}`];
  if (v.summary) lines.push('', v.summary);
  const sec = (title, items) => {
    if (items?.length) lines.push(`\n## ${title}`, ...items.map((i) => `- ${i.title ? `**${i.title}** — ` : ''}${i.content}`));
  };
  sec('잘 작성된 부분', v.strengths);
  sec('보완이 필요한 부분', v.improvements);
  sec('결재 전 확인사항', v.checks);
  lines.push(`\n---\n_${new Date().toLocaleString('ko-KR')} · 전자문서 AI 검토 (AI 참고용 — 결재 판단 근거 아님)_`);
  return lines.join('\n');
}

export function buildExpenseMarkdown(check) {
  const lines = [`# [지출결의 첨부검사] ${check.label || '검사 결과'}`];
  lines.push('', `- 검사 범위: ${check.scope || 'L1'}`);
  lines.push(`- 발견 첨부: ${check.counts?.discovered ?? 0}건`);
  if (check.rulesetId) lines.push(`- 적용 규칙: ${check.rulesetId} ${check.rulesetVersion || ''}`.trim());
  if (check.expenseType?.name) lines.push(`- 지출유형: ${check.expenseType.name}`);
  if (check.attachments?.length) {
    lines.push('\n## 첨부파일');
    for (const item of check.attachments) {
      const matched = item.matchedRules?.length ? ` — 규칙 ${item.matchedRules.join(', ')}` : '';
      const status = item.contentStatus === 'complete' ? '내용 확인 완료'
        : item.contentStatus === 'needs_ocr' ? 'OCR 필요'
          : item.contentStatus === 'manual_required' ? '직접 선택 필요'
          : item.contentStatus === 'unreadable' ? '검사불가' : '내용 미검사';
      lines.push(`- ${item.name}${item.sizeText ? ` (${item.sizeText})` : ''}${matched} — ${status}`);
      if (item.fields) {
        lines.push(`  - 추출: 금액 ${item.fields.amounts?.length || 0}건 · 날짜 ${item.fields.dates?.length || 0}건 · 사업자번호 ${item.fields.businessNumbers?.length || 0}건 · 서명표시 ${item.fields.signatureCues?.length || 0}건`);
      }
    }
  }
  if (check.issues?.length) {
    lines.push('\n## 확인사항');
    for (const issue of check.issues) {
      lines.push(`- **${issue.title}** — ${issue.message}${issue.obtainFrom ? ` · 확보 위치: ${issue.obtainFrom}` : ''}`);
    }
  }
  if (check.aiReview) {
    lines.push('\n## 로컬 AI 의미 검사');
    if (check.aiReview.summary) lines.push(check.aiReview.summary);
    for (const item of check.aiReview.findings || []) {
      lines.push(`- [${item.level === 'warn' ? '확인 후보' : '참고'}] **${item.item || '내용'}** — ${item.message}${item.file ? ` · ${item.file}` : ''}`);
    }
    for (const item of check.aiReview.crossChecks || []) {
      lines.push(`- [${item.level === 'warn' ? '확인 후보' : '참고'}] **${item.item || '교차검증'}** — ${item.message}${item.files?.length ? ` · ${item.files.join(', ')}` : ''}`);
    }
    if (check.aiReview.limitations?.length) {
      lines.push('', `> 검사 한계: ${check.aiReview.limitations.join(' · ')}`);
    }
  }
  lines.push(`\n---\n_${new Date().toLocaleString('ko-KR')} · 지출결의 첨부검사 ${check.scope || 'L1'}_`);
  return lines.join('\n');
}

// 요약 결과 파일명 — 경로 조작·구분자 제거
export function resultFileName(prefix, title) {
  const safe = String(title || '문서').slice(0, 40).replace(/[\\/:*?"<>|\s]/g, '_');
  return `${prefix}_${safe}_${new Date().toISOString().slice(0, 10)}.md`;
}
