// 화면에서 수집한 라벨-값 후보를 지출 규칙 엔진이 사용하는 최소 컨텍스트로 정규화한다.
// 실제 화면 원문은 반환하지 않고 제목·유형·금액 후보만 남긴다.

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const LABELS = Object.freeze({
  title: /^(제목|지출\s*내용|결의\s*내용|적요|구매\s*내역|품명)$/i,
  type: /^(지출\s*유형|지출\s*구분|결의\s*유형|결의\s*구분|비용\s*유형)$/i,
  typeCode: /^(지출\s*유형\s*코드|결의\s*유형\s*코드|비용\s*코드)$/i,
  total: /^(합계|총액|총\s*금액|결의\s*금액|지출\s*금액|지급\s*금액)$/i,
});

const numberValue = (value) => {
  const matches = [...clean(value).matchAll(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:원)?/g)];
  if (!matches.length) return null;
  const number = Number(matches.at(-1)[1].replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
};

export function inferExpenseContext(frames = [], page = {}) {
  const pairs = frames.flatMap((frame) => Array.isArray(frame?.pairs) ? frame.pairs : []);
  const field = (key) => {
    const pattern = LABELS[key];
    return clean(pairs.find((pair) => pattern.test(clean(pair?.label)))?.value);
  };
  const totalRaw = field('total');
  const total = numberValue(totalRaw);
  return {
    page: {
      url: clean(page.url),
      title: clean(page.title),
    },
    expense: {
      title: field('title') || clean(page.title),
      type: field('type'),
      typeCode: field('typeCode'),
      total,
    },
  };
}

