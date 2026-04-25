/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Hidéyssy — 共通スクリプト
   main.js
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * 歌詞アコーディオンの開閉
 * @param {string} id     - lyrics-full要素のid
 * @param {HTMLElement} btn - トグルボタン要素
 */
function toggleLyrics(id, btn) {
    const full = document.getElementById(id);
    const label = btn.querySelector('.lyrics-toggle-label');
    const isOpen = full.classList.toggle('is-open');
    btn.classList.toggle('is-open', isOpen);
    btn.setAttribute('aria-expanded', isOpen);
    label.textContent = isOpen ? '閉じる' : 'すべての歌詞を見る';
}
