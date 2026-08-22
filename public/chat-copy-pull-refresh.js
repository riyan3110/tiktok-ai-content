(() => {
  'use strict';
  if (window.__AIADS_CHAT_COPY_PULL_REFRESH__) return;
  window.__AIADS_CHAT_COPY_PULL_REFRESH__ = true;

  const COPY_REQUEST = /(?:\b(?:buat(?:kan)?|bikin(?:in)?|tulis(?:kan)?|susun|rapikan|generate|kasih|beri)\b[\s\S]{0,100}\b(?:prompt|teks|text|caption|script|skrip|kode|code|template|deskripsi|judul|bio|tagar|hashtag|pesan|email|surat)\b|\b(?:prompt|teks|text|caption|script|skrip|kode|code|template)\b[\s\S]{0,80}\b(?:copy|salin)\b|\b(?:bisa|biar|agar)\s+(?:di\s*)?(?:copy|salin)\b)/i;
  const COPY_RESPONSE = /(?:```[\s\S]*```|(?:^|\n)\s*(?:\*\*)?(?:prompt(?:\s+(?:gambar|video|iklan))?|caption|script|skrip|kode|code|template|teks|text)(?:\*\*)?\s*:|^[\s\t]*["“'][\s\S]{60,}["”'][\s\t]*$)/i;

  const style = document.createElement('style');
  style.textContent = `
    .aiads-chat-bubble.assistant.aiads-copyable{position:relative;padding-bottom:42px}
    .aiads-chat-copy{position:absolute;right:9px;bottom:8px;border:1px solid rgba(255,255,255,.16);background:rgba(10,10,14,.72);color:#f5f3ff;border-radius:9px;padding:6px 9px;font:600 11px/1 system-ui,-apple-system,sans-serif;cursor:pointer;backdrop-filter:blur(8px)}
    .aiads-chat-copy:active{transform:scale(.96)}
    .aiads-pull-refresh{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top));z-index:10020;transform:translate(-50%,-70px);opacity:0;pointer-events:none;background:rgba(18,18,24,.94);color:#f5f3ff;border:1px solid rgba(139,92,246,.38);border-radius:999px;padding:8px 13px;font:600 12px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);transition:opacity .16s ease,transform .16s ease}
    .aiads-pull-refresh.visible{opacity:1}
    html,body{overscroll-behavior-y:contain}
  `;
  document.head.appendChild(style);

  function cleanBubbleText(bubble) {
    const clone = bubble.cloneNode(true);
    clone.querySelectorAll('.aiads-chat-meta,.aiads-chat-message-attachments,.aiads-chat-media,.aiads-chat-media-actions,[data-aiads-copy]').forEach(node => node.remove());
    return String(clone.textContent || '').trim();
  }

  function previousUserText(bubble) {
    let node = bubble.previousElementSibling;
    while (node) {
      if (node.classList?.contains('aiads-chat-bubble') && node.classList.contains('user')) return cleanBubbleText(node);
      node = node.previousElementSibling;
    }
    return '';
  }

  function isCopyableBubble(bubble) {
    if (!bubble?.classList?.contains('assistant') || bubble.classList.contains('aiads-chat-thinking')) return false;
    if (bubble.querySelector('.aiads-chat-media')) return false;
    const answer = cleanBubbleText(bubble);
    if (!answer) return false;
    const request = previousUserText(bubble);
    return COPY_REQUEST.test(request) || COPY_RESPONSE.test(answer);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function enhanceCopyButtons(root = document) {
    root.querySelectorAll?.('.aiads-chat-bubble.assistant:not([data-aiads-copy-checked])').forEach(bubble => {
      bubble.dataset.aiadsCopyChecked = '1';
      if (!isCopyableBubble(bubble)) return;
      bubble.classList.add('aiads-copyable');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'aiads-chat-copy';
      button.dataset.aiadsCopy = '1';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', 'Copy teks');
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const text = cleanBubbleText(bubble);
        if (!text) return;
        const original = button.textContent;
        try {
          await copyText(text);
          button.textContent = 'Copied ✓';
        } catch (_) {
          button.textContent = 'Gagal copy';
        }
        setTimeout(() => { button.textContent = original; }, 1400);
      });
      bubble.appendChild(button);
    });
  }

  enhanceCopyButtons();
  const copyObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.addedNodes.length) {
        enhanceCopyButtons(document);
        break;
      }
    }
  });
  copyObserver.observe(document.body, { childList: true, subtree: true });

  const indicator = document.createElement('div');
  indicator.className = 'aiads-pull-refresh';
  indicator.textContent = 'Tarik untuk refresh';
  document.body.appendChild(indicator);

  let tracking = false;
  let startY = 0;
  let distance = 0;
  const threshold = 82;

  function blockedTarget(target) {
    return Boolean(target?.closest?.('.aiads-chat-panel,input,textarea,select,button,a,[contenteditable="true"]'));
  }

  function resetPull() {
    tracking = false;
    startY = 0;
    distance = 0;
    indicator.classList.remove('visible');
    indicator.style.transform = 'translate(-50%,-70px)';
    indicator.textContent = 'Tarik untuk refresh';
  }

  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || window.scrollY > 0 || blockedTarget(event.target)) return;
    tracking = true;
    startY = event.touches[0].clientY;
    distance = 0;
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (!tracking || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - startY;
    if (delta <= 0 || window.scrollY > 0) {
      resetPull();
      return;
    }
    if (delta < 8) return;
    event.preventDefault();
    distance = Math.min(120, delta * 0.58);
    const ready = distance >= threshold;
    indicator.classList.add('visible');
    indicator.textContent = ready ? 'Lepas untuk refresh' : 'Tarik untuk refresh';
    indicator.style.transform = `translate(-50%,${Math.min(18, -42 + distance * 0.58)}px)`;
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!tracking) return;
    const reload = distance >= threshold;
    if (!reload) {
      resetPull();
      return;
    }
    tracking = false;
    indicator.classList.add('visible');
    indicator.textContent = 'Memuat ulang…';
    indicator.style.transform = 'translate(-50%,10px)';
    setTimeout(() => window.location.reload(), 90);
  }, { passive: true });

  document.addEventListener('touchcancel', resetPull, { passive: true });
})();
