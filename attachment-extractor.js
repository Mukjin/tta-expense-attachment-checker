// 현재 프레임의 DOM에서 첨부파일 후보를 읽는다.
// 파일을 다운로드하거나 버튼을 누르지 않으며, executeScript 결과로 메타데이터만 반환한다.
(() => {
  const FILE_RE = /([^\\/:*?"<>|\r\n]{1,180}\.(?:pdf|hwp|hwpx|xls|xlsx|doc|docx|ppt|pptx|png|jpe?g|gif|bmp|tiff?|txt|csv|zip))/gi;
  const SIZE_RE = /(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB))/i;
  const URL_ATTRS = ['href', 'data-url', 'data-download-url', 'data-file-url', 'data-href'];
  const ID_ATTRS = ['data-file-id', 'data-attach-id', 'data-atch-file-id', 'data-doc-id', 'data-id'];

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absoluteUrl = (value) => {
    const raw = clean(value);
    if (!raw || /^javascript:/i.test(raw) || raw === '#') return '';
    try { return new URL(raw, location.href).href; } catch { return ''; }
  };
  const nearestContainer = (element) => element?.closest?.(
    'tr, li, [role="row"], [class*="file" i], [class*="attach" i], [id*="file" i], [id*="attach" i]'
  ) || element?.parentElement || element;
  const findAttribute = (element, names) => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      for (const name of names) {
        const value = node.getAttribute?.(name);
        if (value) return value;
      }
    }
    return '';
  };
  // 레거시 그룹웨어는 href 대신 onclick="download('/path/file?...')" 형태가 많음.
  // 페이지 코드를 실행하지 않고, 따옴표 안의 URL 리터럴만 보수적으로 추출한다.
  const urlFromJavascript = (value) => {
    const script = clean(value);
    if (!script || !/(?:down|attach|file)/i.test(script)) return '';
    const quoted = /['"]([^'"]{2,1000})['"]/g;
    let match;
    while ((match = quoted.exec(script))) {
      const candidate = match[1].replace(/&amp;/g, '&');
      if (!/[/?=&]/.test(candidate) || !/(?:down|attach|file|atch)/i.test(candidate)) continue;
      const url = absoluteUrl(candidate);
      if (url) return url;
    }
    return '';
  };
  const findHref = (element, container) => {
    const anchor = element?.closest?.('a') || container?.querySelector?.('a[href], [data-download-url], [data-file-url]');
    const direct = absoluteUrl(findAttribute(anchor || element, URL_ATTRS));
    if (direct) return direct;
    const interactive = element?.closest?.('[onclick], button, a')
      || container?.querySelector?.('[onclick], button[onclick], a[onclick]');
    for (let node = interactive || element; node && node !== document.documentElement; node = node.parentElement) {
      const url = urlFromJavascript(node.getAttribute?.('onclick'));
      if (url) return url;
      if (node === container) break;
    }
    return '';
  };
  const findSelected = (container) => {
    const checkbox = container?.matches?.('input[type="checkbox"]')
      ? container
      : container?.querySelector?.('input[type="checkbox"]');
    return checkbox?.checked === true;
  };

  const found = [];
  const pushMatches = (text, element) => {
    const value = clean(text);
    if (!value || value.length > 1000) return;
    FILE_RE.lastIndex = 0;
    let match;
    while ((match = FILE_RE.exec(value))) {
      const name = clean(match[1]);
      const container = nearestContainer(element);
      const rowText = clean(container?.textContent || value);
      const href = findHref(element, container);
      const id = clean(findAttribute(container, ID_ATTRS));
      found.push({
        id,
        name,
        extension: name.split('.').pop()?.toLowerCase() || '',
        href,
        sizeText: SIZE_RE.exec(rowText)?.[1] || '',
        selected: findSelected(container),
        sourceUrl: location.href,
        sourceOrigin: (typeof self !== 'undefined' && self.origin) || location.origin || '',
      });
    }
  };

  // 텍스트 노드 기준 탐색은 파일명이 링크가 아닌 span/label에 그려지는 레거시 화면도 처리한다.
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (/\.(?:pdf|hwp|hwpx|xls|xlsx|doc|docx|ppt|pptx|png|jpe?g|gif|bmp|tiff?|txt|csv|zip)\b/i.test(node.nodeValue || '')) {
      pushMatches(node.nodeValue, node.parentElement);
    }
  }

  // 파일명이 data 속성에만 있는 경우를 추가로 수집한다.
  document.querySelectorAll('[data-file-name], [data-filename], [download]').forEach((element) => {
    pushMatches(
      element.getAttribute('data-file-name') || element.getAttribute('data-filename')
        || element.getAttribute('download') || element.textContent,
      element,
    );
  });

  const seen = new Set();
  const attachments = found.filter((item) => {
    const key = item.id ? `id:${item.id}` : item.href ? `url:${item.href}` : `name:${item.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    origin: (typeof self !== 'undefined' && self.origin) || location.origin || '',
    url: location.href,
    isTop: window === window.top,
    attachments,
  };
})();
