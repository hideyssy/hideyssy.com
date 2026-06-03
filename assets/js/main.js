/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hidéyssy — 共通スクリプト
main.js
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * 歌詞アコーディオンの開閉
 * @param {HTMLElement} btn - トグルボタン要素
 */
function toggleLyrics(btn) {
    const block = btn.closest('.lyrics-block');
    const full = block ? block.querySelector('.lyrics-full') : null;
    const label = btn.querySelector('.lyrics-toggle-label');

    if (!full || !label) return;

    const isOpen = full.classList.toggle('is-open');
    btn.classList.toggle('is-open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    label.textContent = isOpen ? '閉じる' : 'すべての歌詞を見る';
}

document.addEventListener('click', (event) => {
    const btn = event.target.closest('.lyrics-toggle');

    if (!btn) return;

    event.preventDefault();
    toggleLyrics(btn);
});
