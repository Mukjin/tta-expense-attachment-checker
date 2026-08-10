// 페이지 주입 오버레이 렌더러.
//
// ⚠ renderOverlay는 chrome.scripting.executeScript({ func })로 직렬화되어 페이지에 주입된다.
//   모듈 스코프의 어떤 값도 참조하면 안 된다 (자기완결 함수).
//
// 섀도루트는 mode:'closed' — open이면 페이지 스크립트가 shadowRoot로 요약 전문을 읽고
// 내부 버튼을 click()으로 눌러 확장 기능을 임의 실행할 수 있다.
// 루트 참조는 격리 월드의 expando에 보관하므로 페이지에서 접근할 수 없다.
//
// TTA/KRDS 컬러: Primary #0A4DA2. 본문 서체는 Pretendard 계열.

export function renderOverlay(state) {
  const HOST_ID = '__edoc_ai_summary_host';
  let host = document.getElementById(HOST_ID);
  // 확장을 리로드·업데이트하면 격리 월드가 초기화되어 __root 참조를 잃는다.
  // 섀도루트가 closed라 DOM에서 되찾을 수 없고, 다시 attachShadow하면 NotSupportedError가 난다 —
  // 남은 껍데기를 버리고 새로 만든다 (안 그러면 새로고침 전까지 패널이 조용히 안 뜬다).
  if (host && !host.__root) {
    host.remove();
    host = null;
  }
  const isFirstMount = !host; // 재렌더(스트리밍 갱신) 시 등장 애니메이션 재생 금지 — 깜빡임 원인
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial; position:fixed; top:16px; right:16px; z-index:2147483647;';
    document.documentElement.appendChild(host);
    host.__root = host.attachShadow({ mode: 'closed' });
  }
  // executeScript는 주입 완료 순서를 보장하지 않는다. 세대 번호가 역행하면
  // 늦게 도착한 옛 부분결과가 최종 결과를 덮어써 "AI 생성 중…"이 고착된다.
  const gen = +state.gen || 0;
  if (gen < (host.__gen || 0)) return;
  host.__gen = gen;

  const root = host.__root;
  const fontSize = +(host.dataset.fs || 14);
  const mode = state.mode || 'summary';
  const partial = !!state.partial;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 이스케이프 후 **볼드** 마크다운만 <b>로 변환
  const bold = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // ── 스트리밍 타이핑 연출 ──
  // 이전 렌더의 텍스트를 host에 기억해 두고, 늘어난 꼬리만 <span class="tw">로 감싸 페이드인.
  // 처음 등장한 항목은 .new 슬라이드인, 마지막으로 자란 요소 끝에는 타이핑 커서를 붙인다.
  const prevTxt = host.__txt || {};
  const nextTxt = {};
  let caretKey = null;
  const reveal = (key, raw, render = bold) => {
    const s = String(raw ?? '');
    nextTxt[key] = s;
    const old = prevTxt[key];
    if (partial && s) {
      if (typeof old === 'string' && old && s.startsWith(old)) {
        if (s.length > old.length) {
          caretKey = key;
          return render(old) + `<span class="tw">${render(s.slice(old.length))}</span>`;
        }
      } else {
        caretKey = key;
        return `<span class="tw">${render(s)}</span>`;
      }
    }
    return render(s);
  };
  const isNew = (key) => (partial && !(key in prevTxt) ? ' new' : '');

  // key_points: "라벨: 내용" → 라벨 태그 + 내용 행
  const kvList = (items, pfx = 'k') => (items || []).map((i, n) => {
    const k = pfx + n;
    const m = /^([^:：]{1,12})[:：]\s*(.+)$/s.exec(String(i ?? ''));
    return m
      ? `<li class="kv${isNew(k)}" data-k="${k}"><span class="kl">${esc(m[1])}</span><span class="kt">${reveal(k, m[2])}</span></li>`
      : `<li class="${isNew(k).trim()}" data-k="${k}">${reveal(k, i)}</li>`;
  }).join('');
  const list = (items, pfx = 'l') => (items || []).map((i, n) =>
    `<li class="${isNew(pfx + n).trim()}" data-k="${pfx + n}">${reveal(pfx + n, i)}</li>`).join('');

  let body = '';
  const hasResult = (!!state.result || !!state.review || !!state.expenseCheck) && !partial;
  if (state.status) {
    const aiWaiting = /요약 중|검토 중|로컬 AI/.test(state.status);
    body = `<div class="status${aiWaiting ? ' working' : ''}">
      <span class="ai-orb"><span></span><span></span><span></span></span>
      <div class="status-copy"><b>${esc(state.status)}</b>${aiWaiting ? '<small>로컬 9B 모델은 보통 30초~2분 정도 걸립니다.</small>' : ''}</div>
      ${aiWaiting ? '<div class="progress"><i></i></div>' : ''}
    </div>`;
  }
  else if (state.error) body = `<div class="status error">${esc(state.error)}</div>`;
  else if (state.expenseCheck) {
    const check = state.expenseCheck;
    const grade = check.status === 'block' ? 'bad' : check.status === 'warn' ? 'mid' : 'ok';
    const attachmentItems = (check.attachments || []).map((item) => {
      const meta = [item.sizeText, item.extension?.toUpperCase()].filter(Boolean).join(' · ');
      const matched = item.matchedRules?.length ? ` · 규칙 ${item.matchedRules.join(', ')}` : '';
      const contentLabel = item.contentStatus === 'complete' ? '내용 확인 완료'
        : item.contentStatus === 'needs_ocr' ? 'OCR 필요'
          : item.contentStatus === 'manual_required' ? '직접 선택 필요'
          : item.contentStatus === 'unreadable' ? '검사불가' : '내용 미검사';
      const fieldCounts = item.fields ? [
        `금액 ${item.fields.amounts?.length || 0}`,
        `날짜 ${item.fields.dates?.length || 0}`,
        `사업자번호 ${item.fields.businessNumbers?.length || 0}`,
        `서명표시 ${item.fields.signatureCues?.length || 0}`,
      ].join(' · ') : '';
      const detail = item.contentError && item.contentStatus !== 'complete'
        ? `<br><span class="muted">${esc(item.contentError)}</span>` : '';
      return `<li><b>${esc(item.name)}</b>${meta ? ` <span class="muted">${esc(meta)}</span>` : ''}${esc(matched)}<br><span class="kl">${esc(contentLabel)}</span>${fieldCounts ? ` <span class="muted">${esc(fieldCounts)}</span>` : ''}${detail}</li>`;
    }).join('');
    const issueItems = (check.issues || []).map((issue) =>
      `<li>${issue.source === 'ai' ? '<span class="kl r">AI 후보</span> ' : ''}<b>${esc(issue.title)}</b> · ${esc(issue.message)}${issue.obtainFrom ? ` · ${esc(issue.obtainFrom)}` : ''}${issue.evidence ? ` <span class="muted">근거: ${esc(issue.evidence)}</span>` : ''}</li>`
    ).join('');
    const ai = check.aiReview;
    const aiItems = [
      ...(ai?.findings || []).map((item) => ({ ...item, files: item.file ? [item.file] : [] })),
      ...(ai?.crossChecks || []).map((item) => ({ ...item, evidence: '' })),
    ].map((item) => `<li><span class="kl${item.level === 'warn' ? ' r' : ''}">${item.level === 'warn' ? '확인 후보' : '참고'}</span> <b>${esc(item.item || '내용')}</b> · ${esc(item.message)}${item.files?.length ? ` <span class="muted">${esc(item.files.join(', '))}</span>` : ''}${item.evidence ? `<br><span class="muted">근거: ${esc(item.evidence)}</span>` : ''}</li>`).join('');
    const manualNeeded = (check.attachments || []).some((item) => ['manual_required', 'unreadable'].includes(item.contentStatus));
    body = `
      <div class="card main">
        <div><span class="pill grade ${grade}">${esc(check.label || '검사 결과')}</span></div>
        <div class="one">첨부 ${Number(check.counts?.discovered || 0).toLocaleString()}건 확인</div>
        <div class="sub">${check.scope === 'L1' ? 'L1 첨부 존재 검사' : 'L1 존재 + L2 내용 검사'}${check.expenseType?.name ? ` · ${esc(check.expenseType.name)}` : ''}</div>
        ${check.rulesetId ? `<div class="chips"><span class="chip"><span class="cl">규칙</span>${esc(check.rulesetId)} ${esc(check.rulesetVersion)}</span></div>` : ''}
      </div>
      <div class="card"><h2>전체 첨부파일</h2><ul>${attachmentItems || '<li>발견된 첨부파일 없음</li>'}</ul>${manualNeeded ? '<button class="filebtn" id="bFiles">원본 파일 직접 선택하여 L2 검사</button>' : ''}</div>
      ${ai ? `<div class="card"><h2>로컬 AI 의미 검사</h2>${ai.summary ? `<div class="sub">${esc(ai.summary)}</div>` : ''}${aiItems ? `<ul>${aiItems}</ul>` : '<div class="muted">추가 확인 후보 없음</div>'}${ai.limitations?.length ? `<div class="notice">한계: ${esc(ai.limitations.join(' · '))}</div>` : ''}</div>` : ''}
      ${issueItems ? `<div class="card warn"><h2>보완·확인 항목</h2><ul>${issueItems}</ul></div>` : ''}
      ${state.warn ? `<div class="notice">⚠ ${esc(state.warn)}</div>` : ''}
      <div class="disclaim">규칙·정규식 검사는 결정론적 결과이며, AI 항목은 차단에 사용하지 않는 사람 확인용 후보입니다. 금액·날짜·사업자번호·서명 표시는 반드시 원문에서 다시 확인하세요.</div>`;
  }
  else if (state.review) {
    const v = state.review;
    const st = String(v.status || '');
    const grade = /재검토/.test(st) ? 'bad' : /확인/.test(st) ? 'chk' : /보완/.test(st) ? 'mid' : /가능/.test(st) ? 'ok' : 'mid';
    // 요약 모드의 kv(라벨 칩) 스타일로 톤 통일 — 섹션 색상별 칩
    const chipCls = (cls) => (cls === 'act' ? 'kl g' : cls === 'warn' ? 'kl r' : 'kl');
    const sec = (cls, title, items, pfx) => (items?.length
      ? `<div class="card ${cls}"><h2>${title}</h2><ul>${items.map((i, n) => {
          const k = pfx + n;
          return i.title
            ? `<li class="kv${isNew(k)}" data-k="${k}"><span class="${chipCls(cls)}">${esc(i.title)}</span><span class="kt">${reveal(k, i.content)}</span></li>`
            : `<li class="${isNew(k).trim()}" data-k="${k}">${reveal(k, i.content)}</li>`;
        }).join('')}</ul></div>`
      : '');
    nextTxt.st = st;
    body = `
      <div class="card main">
        <div><span class="pill grade ${grade}${isNew('st')}">${esc(st || '검토 중…')}</span></div>
        ${v.summary ? `<div class="sub${isNew('sum')}" data-k="sum">${reveal('sum', v.summary)}</div>` : ''}
      </div>
      ${sec('act', '잘 작성된 부분', v.strengths, 'st-')}
      ${sec('', '보완이 필요한 부분', v.improvements, 'im-')}
      ${sec('warn', '결재 전 확인사항', v.checks, 'ck-')}
      ${state.warn ? `<div class="notice">⚠ ${esc(state.warn)}</div>` : ''}
      <div class="disclaim">AI가 원문만 보고 작성한 참고 자료입니다. 결재 판단의 근거로 삼지 마세요 — 문서 본문에 검토 결과를 조작하려는 문구가 섞여 있을 수 있습니다.</div>`;
  }
  else if (state.result) {
    const r = state.result;
    // "2026-08-04" → 📅 2026. 8. 4.(화)까지 · D-5
    let deadline = '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.deadline || '');
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.round((d - today) / 86400000);
      const yoil = '일월화수목금토'[d.getDay()];
      const dday = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `기한 ${-diff}일 지남`;
      deadline = `<div class="deadline${diff <= 3 ? ' urgent' : ''}${isNew('dl')}" data-k="dl">📅 ${+m[1]}. ${+m[2]}. ${+m[3]}.(${yoil})까지 · <b>${dday}</b></div>`;
      nextTxt.dl = '1';
    }
    const actPill = r.action_required
      ? '<span class="pill need">조치 필요</span>'
      : '<span class="pill ref">참고</span>';
    const chip = (label, val) => (val ? `<span class="chip"><span class="cl">${esc(label)}</span>${esc(val)}</span>` : '');
    const chips = [
      chip('문서번호', r.doc_no),
      chip('발신', r.sender),
      chip('수신', r.receiver),
      chip('시행', r.sent_date),
    ].join('');
    body = `
      <div class="card main">
        <div><span class="pill type">${esc(r.doc_type || '문서')}</span>${actPill}</div>
        ${r.title ? `<div class="one ell" title="${esc(r.title)}" data-k="title">${reveal('title', r.title, esc)}</div>` : `<div class="one" data-k="one">${reveal('one', r.one_line, esc)}</div>`}
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        ${r.title ? `<div class="sub" data-k="sub">${reveal('sub', r.one_line, esc)}</div>` : ''}
        ${deadline}
      </div>
      <div class="card"><h2>핵심 내용</h2><ul>${kvList(r.key_points, 'kp')}</ul></div>
      ${r.actions?.length ? `<div class="card act"><h2>조치 사항</h2><ul>${list(r.actions, 'ac')}</ul></div>` : ''}
      ${r.cautions?.length ? `<div class="card warn"><h2>주의</h2><ul>${list(r.cautions, 'ca')}</ul></div>` : ''}
      ${state.warn ? `<div class="notice">⚠ ${esc(state.warn)}</div>` : ''}
      <div class="disclaim">AI 생성 요약입니다. 기한·금액·문서번호는 원문에서 다시 확인하세요.</div>`;
  }
  // 스트리밍 진행 표시 — 부분 결과 아래에 생성 중 인디케이터
  if (partial && (state.result || state.review)) {
    body += `<div class="gen"><span class="spin"></span>AI 생성 중…</div>`;
  }

  // 본문이 어디로 나갔는지 항상 보이게 — 설정 페이지의 정적 경고만으로는 실효성이 없다
  const isExternal = state.provider === 'gemini';
  const srcBadge = state.provider
    ? `<span class="src ${isExternal ? 'ext' : 'loc'}" title="${isExternal
        ? '문서 본문이 Google 서버(국외)로 전송되었습니다'
        : '문서가 지정한 로컬·내부 서버 밖으로 나가지 않았습니다'}">${isExternal ? 'Gemini · 외부 전송' : '로컬'}</span>`
    : '';

  // 재렌더 시 스크롤 위치 유지 (스트리밍 중 반복 렌더 대비)
  const prevScroll = root.querySelector('.panel')?.scrollTop || 0;
  root.innerHTML = `
    <style>
      .panel {
        all: initial; display: block; box-sizing: border-box;
        --ink: #0B1B33; --ink2: #3D4E66; --ink3: #7C8AA0;
        --line: rgba(11, 27, 51, .07);
        --brand: #0A4DA2; --teal: #00B8A9;
        --grad: linear-gradient(120deg, #0A4DA2, #0878A2 55%, #00B8A9);
        --danger: #E5484D;
        width: 412px; max-height: 84vh; overflow-y: auto;
        background:
          linear-gradient(rgba(248, 250, 253, .94), rgba(244, 248, 252, .96)) padding-box,
          linear-gradient(145deg, rgba(10, 77, 162, .62), rgba(255, 255, 255, .9) 42%, rgba(0, 184, 169, .58)) border-box;
        backdrop-filter: blur(16px) saturate(1.5); -webkit-backdrop-filter: blur(16px) saturate(1.5);
        color: var(--ink); border: 1px solid transparent; border-radius: 20px;
        box-shadow: 0 2px 3px rgba(11, 27, 51, .08), 0 24px 64px -16px rgba(11, 27, 51, .42), 0 0 0 1px rgba(255, 255, 255, .52) inset;
        font-family: 'Pretendard GovKR', Pretendard, 'Malgun Gothic', system-ui, sans-serif;
        font-size: ${fontSize}px; line-height: 1.62;
        font-feature-settings: 'kern' 1, 'tnum' 1;
        word-break: keep-all; overflow-wrap: break-word;
        transform-style: preserve-3d;
        animation: ${isFirstMount ? 'enter .48s cubic-bezier(.16, 1, .3, 1)' : 'none'};
      }
      @keyframes enter {
        from { opacity: 0; transform: perspective(900px) translateY(20px) rotateX(-7deg) scale(.965); }
        to { opacity: 1; transform: perspective(900px) translateY(0) rotateX(0) scale(1); }
      }
      @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
      .panel::-webkit-scrollbar { width: 5px; }
      .panel::-webkit-scrollbar-thumb { background: linear-gradient(#0A4DA2, #00B8A9); border-radius: 3px; }
      .head {
        display: flex; align-items: center; gap: 1px; padding: 13px 12px 11px 16px;
        position: sticky; top: 0; z-index: 1;
        background: linear-gradient(100deg, rgba(255,255,255,.91), rgba(245,249,253,.86)); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border-bottom: 1px solid rgba(10, 77, 162, .1); cursor: grab; user-select: none; border-radius: 20px 20px 0 0;
        box-shadow: 0 8px 24px -20px rgba(10, 77, 162, .55);
      }
      .head:active { cursor: grabbing; }
      .logo {
        width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; flex: none;
        background: var(--grad); box-shadow: 0 0 0 4px rgba(10, 77, 162, .08), 0 0 14px rgba(0, 184, 169, .65);
        animation: logoPulse 2.4s ease-in-out infinite;
      }
      @keyframes logoPulse { 50% { transform: scale(1.2); box-shadow: 0 0 0 7px rgba(10, 77, 162, 0), 0 0 20px rgba(0, 184, 169, .75); } }
      .head .t {
        font-weight: 850; font-size: 14px; letter-spacing: -.025em;
        background: linear-gradient(105deg, #082A55, #0A4DA2 65%, #008E86);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        text-shadow: 0 4px 18px rgba(10, 77, 162, .1);
      }
      .head .sp { flex: 1; }
      .src {
        flex: none; margin-left: 7px; padding: 3px 8px; border-radius: 999px;
        font-size: 10.5px; font-weight: 800; letter-spacing: .01em; white-space: nowrap; box-shadow: 0 1px 0 rgba(255,255,255,.7) inset;
      }
      .src.ext { background: rgba(229, 72, 77, .11); color: #C2410C; }
      .src.loc { background: rgba(18, 183, 106, .12); color: #0E9F6E; }
      .tbtn {
        all: initial; cursor: pointer; font-family: inherit; font-size: 11.5px; font-weight: 650;
        color: var(--ink3); padding: 6px 8px; border-radius: 8px; line-height: 1; white-space: nowrap;
        transition: transform .16s ease, box-shadow .16s ease, background .16s ease, color .16s ease;
      }
      .tbtn:hover { background: rgba(11, 27, 51, .06); color: var(--ink); transform: translateY(-1px); }
      .tbtn:active { background: rgba(11, 27, 51, .1); transform: translateY(1px) scale(.97); }
      .tbtn.on { background: rgba(10, 77, 162, .1); color: var(--brand); box-shadow: inset 0 0 0 1px rgba(10, 77, 162, .08); }
      .filebtn {
        all: initial; display: block; box-sizing: border-box; width: 100%; margin-top: 12px;
        padding: 10px 12px; border-radius: 10px; cursor: pointer; text-align: center;
        background: var(--grad); color: #fff; font-family: inherit; font-size: 12px; font-weight: 800;
        box-shadow: 0 8px 18px -10px rgba(10,77,162,.65), 0 1px 0 rgba(255,255,255,.28) inset;
        transition: transform .17s ease, box-shadow .17s ease, filter .17s ease;
      }
      .filebtn:hover { filter: brightness(1.04); transform: translateY(-1px); box-shadow: 0 12px 22px -11px rgba(10,77,162,.7), 0 1px 0 rgba(255,255,255,.28) inset; }
      .pill.grade.ok { background: rgba(18, 183, 106, .12); color: #0E9F6E; }
      .pill.grade.mid { background: rgba(245, 166, 35, .16); color: #B45309; }
      .pill.grade.chk { background: rgba(234, 88, 12, .13); color: #C2410C; }
      .pill.grade.bad { background: rgba(229, 72, 77, .12); color: #E5484D; }
      .muted { color: var(--ink3); font-size: .86em; }
      .gen { display: flex; align-items: center; gap: 8px; padding: 2px 4px; color: var(--ink3); font-size: .85em; }
      .disclaim { color: #718097; font-size: .75em; line-height: 1.55; padding: 9px 11px; border-radius: 10px; background: rgba(255,255,255,.52); border: 1px dashed rgba(10,77,162,.1); }
      /* 스트리밍 타이핑 연출: 새 꼬리 페이드인 · 새 항목 슬라이드인 · 타이핑 커서 */
      .tw { animation: twin .35s ease both; }
      @keyframes twin { from { opacity: 0; } }
      .new { animation: itemin .3s cubic-bezier(.21, 1.02, .55, 1) both; }
      @keyframes itemin { from { opacity: 0; transform: translateY(5px); } }
      .caret {
        display: inline-block; width: 2px; height: 1em; margin-left: 3px; vertical-align: -.12em;
        background: var(--brand); animation: blink .9s steps(2) infinite;
      }
      @keyframes blink { 50% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        .tw, .new, .caret, .logo, .card, .ai-orb, .ai-orb span, .progress i { animation: none; }
        .card:hover { transform: none; }
      }
      .bodywrap {
        display: flex; flex-direction: column; gap: 11px; padding: 14px 14px 16px;
        background:
          radial-gradient(circle at 92% 4%, rgba(0, 184, 169, .08), transparent 30%),
          radial-gradient(circle at 5% 48%, rgba(10, 77, 162, .055), transparent 34%);
      }
      .card {
        background: linear-gradient(145deg, rgba(255,255,255,.99), rgba(250,252,255,.96)); border: 1px solid rgba(11, 27, 51, .075); border-radius: 15px; padding: 15px 16px;
        box-shadow: 0 1px 2px rgba(11, 27, 51, .04), 0 10px 28px -18px rgba(11, 27, 51, .18);
        transform: translateZ(0); transform-origin: 50% 100%;
        transition: transform .22s cubic-bezier(.16, 1, .3, 1), box-shadow .22s ease, border-color .22s ease;
        animation: cardRise .42s cubic-bezier(.16, 1, .3, 1) both;
      }
      .card:nth-child(2) { animation-delay: .05s; }
      .card:nth-child(3) { animation-delay: .1s; }
      .card:nth-child(4) { animation-delay: .15s; }
      .card:hover { transform: perspective(800px) translateY(-2px) rotateX(1deg); border-color: rgba(10, 77, 162, .14); box-shadow: 0 4px 10px rgba(11, 27, 51, .06), 0 20px 34px -20px rgba(10, 77, 162, .35); }
      @keyframes cardRise { from { opacity: 0; transform: translateY(9px) scale(.985); } }
      .card.main { position: relative; overflow: hidden; background: linear-gradient(145deg, #fff 15%, #F4F9FF 72%, #F2FCFA); }
      .card.main::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--grad);
      }
      .card.main::after {
        content: ''; position: absolute; width: 120px; height: 120px; right: -62px; top: -72px; border-radius: 50%;
        background: radial-gradient(circle, rgba(0,184,169,.16), rgba(10,77,162,.04) 55%, transparent 70%); pointer-events: none;
      }
      .pill { display: inline-block; border-radius: 999px; padding: 4px 12px; font-weight: 800; font-size: .82em; letter-spacing: .015em; box-shadow: 0 1px 0 rgba(255,255,255,.75) inset; }
      .pill.type { background: var(--grad); color: #fff; box-shadow: 0 2px 8px rgba(10, 87, 208, .3); }
      .pill.need { background: rgba(229, 72, 77, .1); color: var(--danger); margin-left: 6px; }
      .pill.ref { background: rgba(11, 27, 51, .06); color: var(--ink2); margin-left: 6px; }
      .one { font-weight: 850; font-size: 1.11em; line-height: 1.42; letter-spacing: -.025em; margin-top: 11px; color: #091D38; text-wrap: balance; }
      .ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { margin-top: 8px; font-weight: 570; font-size: .94em; line-height: 1.68; color: #42536B; }
      .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
      .chip {
        display: inline-flex; align-items: center; gap: 6px;
        background: linear-gradient(180deg, rgba(255,255,255,.8), rgba(10,77,162,.055)); border: 1px solid rgba(10,77,162,.07); border-radius: 8px; padding: 4px 9px;
        font-size: .79em; font-weight: 680; color: var(--ink2); box-shadow: 0 3px 8px -7px rgba(10,77,162,.55);
      }
      .chip .cl { color: var(--ink3); font-weight: 600; font-size: .92em; }
      .deadline {
        margin-top: 10px; display: flex; align-items: center; gap: 6px;
        background: rgba(10, 87, 208, .07); color: var(--brand);
        border-radius: 10px; padding: 7px 11px; font-weight: 650; font-size: .95em;
      }
      .deadline.urgent { background: rgba(229, 72, 77, .09); color: var(--danger); position: relative; overflow: hidden; }
      .deadline.urgent::after {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(105deg, transparent 40%, rgba(255, 255, 255, .5) 50%, transparent 60%);
        animation: shimmer 2.8s ease-in-out infinite;
      }
      @keyframes shimmer { 0% { transform: translateX(-100%); } 55%, 100% { transform: translateX(100%); } }
      h2 {
        display: flex; align-items: center; gap: 8px; margin: 0 0 10px;
        font-size: .81em; font-weight: 850; letter-spacing: .055em; color: #52647C;
      }
      h2::before { content: ''; width: 4px; height: 13px; border-radius: 4px; background: var(--grad); box-shadow: 0 2px 7px rgba(10,77,162,.25); }
      .act h2::before { background: linear-gradient(180deg, #12B76A, #00B8A9); }
      .warn h2::before { background: var(--danger); }
      .warn h2 { color: var(--danger); }
      ul { margin: 0; padding: 0; list-style: none; }
      li { padding: 2px 2px 2px 15px; position: relative; margin-bottom: 7px; color: #34475F; line-height: 1.67; border-radius: 7px; transition: background .16s ease, color .16s ease; }
      li:hover { background: rgba(10,77,162,.035); color: #1E3450; }
      li:last-child { margin-bottom: 0; }
      li::before {
        content: ''; position: absolute; left: 0; top: .58em; width: 5px; height: 5px;
        border-radius: 50%; background: linear-gradient(135deg, #0A4DA2, #0878A2);
      }
      li b { color: #102642; font-weight: 800; letter-spacing: -.01em; }
      li.kv { display: flex; align-items: flex-start; gap: 8px; padding-left: 0; }
      li.kv::before { display: none; }
      .kl {
        flex: none; background: linear-gradient(180deg, rgba(255,255,255,.84), rgba(10,77,162,.085)); color: var(--brand);
        border: 1px solid rgba(10,77,162,.07); font-weight: 800; font-size: .77em; padding: 3px 9px; border-radius: 7px; margin-top: .12em;
        box-shadow: 0 3px 8px -7px rgba(10,77,162,.6);
      }
      .kl.g { background: rgba(18, 183, 106, .1); color: #0E9F6E; }
      .kl.r { background: rgba(229, 72, 77, .09); color: var(--danger); }
      .kt { min-width: 0; padding-top: 1px; }
      .act li::before { background: #12B76A; }
      .warn { background: #FFFBFB; border-color: rgba(229, 72, 77, .18); }
      .warn li { color: #A63A3E; }
      .warn li::before { background: var(--danger); }
      .notice { background: linear-gradient(135deg, rgba(255,249,231,.96), rgba(245,166,35,.1)); color: #805300; border: 1px solid rgba(245,166,35,.16); border-radius: 11px; padding: 9px 12px; font-size: .87em; box-shadow: 0 8px 18px -18px rgba(138,90,0,.5); }
      .status { position: relative; display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 16px 18px 18px; color: var(--ink2); overflow: hidden; }
      .status.error { color: var(--danger); word-break: break-all; }
      .status-copy { display: flex; flex-direction: column; min-width: 0; }
      .status-copy b { color: var(--ink); font-size: .96em; }
      .status-copy small { color: var(--ink3); font-size: .76em; margin-top: 2px; }
      .ai-orb { position: relative; width: 29px; height: 29px; flex: none; transform-style: preserve-3d; animation: orbFloat 2.1s ease-in-out infinite; }
      .ai-orb span { position: absolute; inset: 5px; border-radius: 50%; background: var(--grad); box-shadow: 0 5px 16px rgba(10, 77, 162, .32); }
      .ai-orb span:nth-child(2) { inset: 1px 11px; background: rgba(0, 184, 169, .48); animation: orbitA 1.7s linear infinite; }
      .ai-orb span:nth-child(3) { inset: 11px 1px; background: rgba(10, 77, 162, .42); animation: orbitB 2.2s linear infinite reverse; }
      @keyframes orbFloat { 50% { transform: translateY(-3px) rotateZ(5deg); } }
      @keyframes orbitA { to { transform: rotate(360deg) translateX(8px) rotate(-360deg); } }
      @keyframes orbitB { to { transform: rotate(360deg) translateY(8px) rotate(-360deg); } }
      .progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(10, 77, 162, .07); overflow: hidden; }
      .progress i { display: block; width: 42%; height: 100%; border-radius: 3px; background: var(--grad); box-shadow: 0 0 12px rgba(0, 184, 169, .7); animation: progressRun 1.8s cubic-bezier(.65, 0, .35, 1) infinite; }
      @keyframes progressRun { from { transform: translateX(-110%); } to { transform: translateX(350%); } }
      .spin {
        width: 14px; height: 14px; flex: none; border-radius: 50%;
        background: conic-gradient(from 0deg, transparent 15%, #0A4DA2, #00B8A9);
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2.5px));
        mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2.5px));
        animation: rot .8s linear infinite;
      }
      @keyframes rot { to { transform: rotate(360deg); } }
    </style>
    <div class="panel">
      <div class="head" id="dragHandle">
        <span class="logo"></span>
        <span class="t">${mode === 'expense' ? '지출 첨부 검사' : mode === 'review' ? 'AI 결재 검토' : 'AI 문서 요약'}</span>
        ${srcBadge}
        <span class="sp"></span>
        ${hasResult ? `
          <button class="tbtn" id="bCopy" title="결과 복사">복사</button>
          <button class="tbtn" id="bExport" title="마크다운(.md)으로 저장">저장</button>
          <button class="tbtn" id="bMinus" title="글자 작게">가−</button>
          <button class="tbtn" id="bPlus" title="글자 크게">가＋</button>` : ''}
        <button class="tbtn${mode === 'summary' ? ' on' : ''}" id="bSum" title="이 문서 AI 요약">요약</button>
        <button class="tbtn${mode === 'review' ? ' on' : ''}" id="bRev" title="결재 전 AI 검토">검토</button>
        <button class="tbtn${mode === 'expense' ? ' on' : ''}" id="bExpense" title="지출결의 첨부 전체 검사">첨부검사</button>
        <button class="tbtn" id="bRefresh" title="다시 실행 (캐시 무시하고 새로 분석)">↻</button>
        <button class="tbtn" id="bClose" title="닫기">✕</button>
      </div>
      ${state.status || state.error ? body : `<div class="bodywrap">${body}</div>`}
    </div>`;
  if (prevScroll) root.querySelector('.panel').scrollTop = prevScroll;

  // 타이핑 상태 저장 + 마지막으로 자란 요소 끝에 커서 부착
  host.__txt = nextTxt;
  if (partial && caretKey) {
    const typingEl = root.querySelector(`[data-k="${caretKey}"]`);
    if (typingEl) {
      const cur = document.createElement('span');
      cur.className = 'caret';
      (typingEl.querySelector('.kt') || typingEl).appendChild(cur);
    }
  }

  const $ = (id) => root.getElementById(id);
  // 합성 클릭(page script의 .click())으로 확장 기능이 돌지 않게 실제 사용자 조작만 수용.
  // 섀도루트가 closed라 페이지가 버튼에 닿을 수 없지만, 이중으로 막는다.
  const onClick = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', (e) => { if (e.isTrusted) fn(e); });
  };
  // 확장이 리로드·업데이트되면 페이지에 남은 패널의 런타임 연결이 끊긴다 —
  // 조용히 죽지 않고 무엇을 해야 하는지 알린다.
  const send = (msg) => {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch {
      const el = root.querySelector('.bodywrap') || root.querySelector('.panel');
      if (el) el.insertAdjacentHTML('afterbegin',
        '<div class="notice">확장이 업데이트되어 연결이 끊겼습니다. 페이지를 새로고침한 뒤 다시 시도하세요.</div>');
    }
  };

  onClick('bClose', () => host.remove());
  onClick('bSum', () => send({ type: 'edoc-summarize' }));
  onClick('bRev', () => send({ type: 'edoc-review' }));
  onClick('bExpense', () => send({ type: 'edoc-expense-check' }));
  onClick('bRefresh', () => send({
    type: mode === 'expense' ? 'edoc-expense-check' : mode === 'review' ? 'edoc-review' : 'edoc-summarize',
    force: true,
  }));
  onClick('bFiles', () => {
    const button = $('bFiles');
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.hwp,.hwpx,.pdf,.xls,.xlsx,.docx,.png,.jpg,.jpeg,.webp';
    input.style.display = 'none';
    root.appendChild(input);
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])].slice(0, 30);
      if (!files.length) { input.remove(); return; }
      button.disabled = true;
      const batchId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const ask = (message) => new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(message, (response) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else if (!response?.ok) reject(new Error(response?.error || '확장 백그라운드 처리 실패'));
            else resolve(response);
          });
        } catch (error) { reject(error); }
      });
      const encodeChunk = (bytes) => {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      };
      try {
        for (const [index, file] of files.entries()) {
          button.textContent = `로컬 검사 중… ${index + 1}/${files.length}`;
          const comparableName = (name) => String(name || '').toLowerCase().replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
          const match = (state.expenseCheck?.attachments || []).find((item) => comparableName(item.name) === comparableName(file.name));
          const uploadId = `${index}-${file.name}-${file.size}`;
          await ask({
            type: 'edoc-expense-upload-start', batchId, uploadId,
            attachmentId: match?.id || '', name: file.name, size: file.size,
          });
          const bytes = new Uint8Array(await file.arrayBuffer());
          const chunkBytes = 192 * 1024; // 3의 배수라 중간 base64 조각에 padding이 생기지 않음
          let sequence = 0;
          for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
            await ask({
              type: 'edoc-expense-upload-chunk', batchId, uploadId, sequence,
              chunk: encodeChunk(bytes.subarray(offset, offset + chunkBytes)),
            });
            sequence += 1;
          }
          await ask({ type: 'edoc-expense-upload-end', batchId, uploadId });
        }
        button.textContent = '선택 파일 결과 반영 중…';
        await ask({ type: 'edoc-expense-upload-commit', batchId });
      } catch (error) {
        send({ type: 'edoc-expense-upload-cancel', batchId });
        button.disabled = false;
        button.textContent = `직접 선택 검사 실패 — ${String(error.message || error).slice(0, 80)}`;
      } finally {
        input.remove();
      }
    }, { once: true });
    input.click();
  });
  if (hasResult) {
    onClick('bCopy', async () => {
      try {
        await navigator.clipboard.writeText(state.md || '');
        $('bCopy').textContent = '✓ 복사됨';
        setTimeout(() => { const b = $('bCopy'); if (b) b.textContent = '복사'; }, 1500);
      } catch {
        $('bCopy').textContent = '복사 실패';
      }
    });
    onClick('bExport', () => {
      const blob = new Blob([state.md || ''], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.fileName || 'AI요약.md';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    const setFs = (delta) => {
      const next = Math.min(18, Math.max(12, (+host.dataset.fs || 14) + delta));
      host.dataset.fs = next;
      root.querySelector('.panel').style.fontSize = next + 'px';
    };
    onClick('bMinus', () => setFs(-1));
    onClick('bPlus', () => setFs(1));
  }

  // 헤더 드래그로 패널 이동 (버튼 클릭은 제외).
  // 포인터를 캡처해 창 밖에서 놓거나 pointercancel이 나도 리스너가 남지 않게 한다.
  const handle = $('dragHandle');
  handle.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.target.closest('.tbtn')) return;
    const rect = host.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const move = (ev) => {
      host.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - offX)) + 'px';
      host.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY)) + 'px';
      host.style.right = 'auto';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try { handle.releasePointerCapture(e.pointerId); } catch { /* 이미 해제됨 */ }
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* 미지원 */ }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}
