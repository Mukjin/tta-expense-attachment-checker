// 현재 프레임에서 지출규칙 판정에 필요한 라벨-값 쌍만 수집한다.
// 계좌·사번·본문 전문은 수집하지 않는다.
(() => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const LABEL = /^(제목|지출\s*내용|결의\s*내용|적요|구매\s*내역|품명|지출\s*유형|지출\s*구분|결의\s*유형|결의\s*구분|비용\s*유형|지출\s*유형\s*코드|결의\s*유형\s*코드|비용\s*코드|합계|총액|총\s*금액|결의\s*금액|지출\s*금액|지급\s*금액)$/i;
  const pairs = [];
  const add = (label, value) => {
    const key = clean(label).replace(/[:：*]$/, '').trim();
    const val = clean(value);
    if (LABEL.test(key) && val && val.length <= 500) pairs.push({ label: key, value: val });
  };

  document.querySelectorAll('tr').forEach((row) => {
    const cells = [...row.querySelectorAll(':scope > th, :scope > td')];
    for (let index = 0; index < cells.length - 1; index += 1) {
      add(cells[index].textContent, cells[index + 1].textContent);
    }
  });
  document.querySelectorAll('dt').forEach((term) => add(term.textContent, term.nextElementSibling?.textContent));
  document.querySelectorAll('label').forEach((label) => {
    const target = label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input,select,textarea');
    const value = target?.tagName === 'SELECT'
      ? target.selectedOptions?.[0]?.textContent
      : target?.value;
    add(label.textContent, value);
  });
  document.querySelectorAll('input, select, textarea').forEach((field) => {
    const hint = clean(`${field.name || ''} ${field.id || ''} ${field.getAttribute('aria-label') || ''}`);
    const value = field.tagName === 'SELECT' ? field.selectedOptions?.[0]?.textContent : field.value;
    if (/expense.*type|spend.*type|지출.*유형|결의.*유형/i.test(hint)) add('지출유형', value);
    else if (/total.*amount|expense.*amount|결의.*금액|지출.*금액/i.test(hint)) add('지출금액', value);
  });

  const seen = new Set();
  return {
    origin: (typeof self !== 'undefined' && self.origin) || location.origin || '',
    pairs: pairs.filter((pair) => {
      const key = `${pair.label}\0${pair.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40),
  };
})();

