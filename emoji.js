/* ============================================================
 * emoji.js - Twemojiで絵文字をSVG画像化（絵文字フォントのないPCでも表示可）
 * 動的なDOM変更にも自動対応
 * ============================================================ */
(function(){
  const BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@v15.1.0/assets/';

  function parse(node) {
    if (typeof twemoji === 'undefined' || !node) return;
    try {
      twemoji.parse(node, { folder: 'svg', ext: '.svg', base: BASE });
    } catch(e) { console.warn('twemoji.parse failed:', e); }
  }

  function initAfterReady() {
    parse(document.body);
    // 動的に追加された要素も絵文字化する（患者リスト、台帳、ステータスバー等）
    const observer = new MutationObserver((records) => {
      const toParse = new Set();
      for (const r of records) {
        if (r.type === 'characterData' && r.target.parentNode) {
          const parent = r.target.parentNode;
          if (parent.classList && !parent.classList.contains('emoji')) {
            toParse.add(parent);
          }
        } else if (r.type === 'childList') {
          for (const n of r.addedNodes) {
            if (n.nodeType === 1) {
              // 要素ノード：twemoji由来の.emoji以外を処理
              if (!n.classList || !n.classList.contains('emoji')) toParse.add(n);
            } else if (n.nodeType === 3 && n.parentNode) {
              // テキストノード（textContent代入等で追加される）：親要素をparse
              // → setStatus でステータスバーの文字が差し替わった時もここで拾う
              const parent = n.parentNode;
              if (parent.classList && !parent.classList.contains('emoji')) {
                toParse.add(parent);
              }
            }
          }
        }
      }
      toParse.forEach(parse);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAfterReady);
  } else {
    initAfterReady();
  }
})();
