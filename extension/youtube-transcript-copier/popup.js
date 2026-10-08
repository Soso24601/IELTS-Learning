const extractButton = document.getElementById('extract');
const openSiteButton = document.getElementById('open-site');
const statusElement = document.getElementById('status');
const learningSite = 'https://ielts.grincaq.info/';

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.className = `status ${kind}`.trim();
}

// This function is serialized by chrome.scripting into the active YouTube tab.
async function readTranscriptFromPage() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const parseTimeLabel = label => {
    const value = String(label || '').trim();
    if (/^\d+(?:\.\d+)?\s*s$/i.test(value)) return Number(value.replace(/\s*s$/i, ''));
    const match = value.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
    if (!match) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
  };
  const containerSelectors = [
    'ytd-transcript-renderer #segments-container',
    'ytd-transcript-search-panel-renderer #segments-container',
    '#engagement-panel-searchable-transcript #content'
  ];
  const rowSelector = 'ytd-transcript-segment-renderer, transcript-segment-view-model';
  const deepQueryAll = (root, selector) => {
    const found = new Set(root.querySelectorAll(selector));
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) for (const nested of deepQueryAll(element.shadowRoot, selector)) found.add(nested);
    }
    return [...found];
  };
  const findContainer = () => containerSelectors.map(selector => deepQueryAll(document, selector)[0]).find(Boolean) || null;
  let container = findContainer();
  const readRows = () => {
    const result = [];
    for (const row of deepQueryAll(container, rowSelector)) {
      const timeNode = row.querySelector('.segment-timestamp, [class*="segment-timestamp"], button');
      const textNode = row.querySelector('.segment-text, [class*="segment-text"], .yt-core-attributed-string');
      const fullText = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const inlineTime = fullText.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s+/);
      const seconds = parseTimeLabel(timeNode?.textContent?.trim()) ?? parseTimeLabel(inlineTime?.[1]);
      const text = (textNode?.textContent || (inlineTime ? fullText.slice(inlineTime[0].length) : '')).replace(/\s+/g, ' ').trim();
      if (seconds !== null && text) result.push({ seconds, text });
    }
    return result;
  };

  if (!container || !deepQueryAll(container, rowSelector).length) {
    throw new Error('没有找到文字稿。请先在 YouTube 视频菜单中选择「显示文字稿」，等字幕加载后再试。');
  }

  const previousScrollTop = container.scrollTop;
  const collected = new Map();
  let previousHeight = -1;
  let stableAtBottom = 0;
  let reachedBottom = false;
  try {
    container.scrollTop = 0;
    await sleep(180);
    for (let pass = 0; pass < 300; pass++) {
      for (const row of readRows()) collected.set(`${row.seconds}\n${row.text}`, row);
      if (!container.isConnected) container = findContainer() || container;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      const heightStable = previousHeight === container.scrollHeight;
      if (atBottom && heightStable) stableAtBottom++;
      else stableAtBottom = 0;
      if (stableAtBottom >= 3) {
        reachedBottom = true;
        break;
      }
      previousHeight = container.scrollHeight;
      container.scrollTop = Math.min(container.scrollTop + Math.max(160, container.clientHeight * 0.75), container.scrollHeight);
      await sleep(160);
    }
  } finally {
    container.scrollTop = previousScrollTop;
  }

  if (!reachedBottom) throw new Error('文字稿面板没有滚动到末尾，未复制可能不完整的字幕。请重新打开文字稿面板后重试。');
  const rows = [...collected.values()].sort((a, b) => a.seconds - b.seconds);
  if (!rows.length) throw new Error('没有读到字幕行。请确认文字稿面板已加载字幕后再试。');
  const duration = document.querySelector('video')?.duration;
  return rows.map((row, index) => {
    const nextStart = rows[index + 1]?.seconds;
    const end = nextStart > row.seconds ? nextStart : (index === rows.length - 1 && Number.isFinite(duration) ? duration : row.seconds + 3);
    return `[${row.seconds.toFixed(2)}-${end.toFixed(2)}] ${row.text}`;
  }).join('\n');
}

extractButton.addEventListener('click', async () => {
  extractButton.disabled = true;
  setStatus('正在读取 YouTube 文字稿…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\/(www\.)?youtube\.com\//i.test(tab.url || '')) {
      throw new Error('请先打开一个 YouTube 视频页面。');
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readTranscriptFromPage
    });
    if (!result) throw new Error('没有读取到字幕。');
    await navigator.clipboard.writeText(result);
    const count = result.split('\n').filter(Boolean).length;
    setStatus(`已复制 ${count} 条带时间戳字幕。回到学习网页，在文字稿框中粘贴。`, 'success');
  } catch (error) {
    setStatus(error?.message || '提取失败，请打开文字稿面板后重试。', 'error');
  } finally {
    extractButton.disabled = false;
  }
});

openSiteButton.addEventListener('click', () => chrome.tabs.create({ url: learningSite }));
