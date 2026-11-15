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
    const path = event.composedPath ? event.composedPath() : [];
    const btn = path.find((el) => el instanceof HTMLElement && el.matches('.lyrics-toggle'))
        || (event.target instanceof HTMLElement ? event.target.closest('.lyrics-toggle') : null)
        || (event.target.parentElement ? event.target.parentElement.closest('.lyrics-toggle') : null);

    if (!btn) return;

    event.preventDefault();
    toggleLyrics(btn);
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   カードの種類で絞り込み
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
(function () {
    const menuToggle = document.querySelector('.menu-toggle');
    const menu = document.querySelector('.header-menu');
    const cards = document.querySelectorAll('.timeline .card');
    const filterOptions = document.querySelectorAll('.filter-option');

    if (!menuToggle || !menu || !cards.length || !filterOptions.length) return;

    const closeMenu = () => {
        menu.hidden = true;
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-label', 'メニューを開く');
    };

    menuToggle.addEventListener('click', () => {
        const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
        menu.hidden = isOpen;
        menuToggle.setAttribute('aria-expanded', String(!isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'メニューを開く' : 'メニューを閉じる');
    });

    filterOptions.forEach((option) => {
        option.addEventListener('click', () => {
            const filter = option.dataset.filter;

            cards.forEach((card) => {
                const category = card.querySelector('.card-category');
                const cardType = category ? category.textContent.trim().toLowerCase() : '';
                card.hidden = filter !== 'all' && cardType !== filter;
            });

            filterOptions.forEach((filterOption) => {
                const isActive = filterOption === option;
                filterOption.classList.toggle('is-active', isActive);
                filterOption.setAttribute('aria-pressed', String(isActive));
            });

            closeMenu();
            menuToggle.focus();
        });
    });

    document.addEventListener('click', (event) => {
        if (!menu.hidden && !menu.contains(event.target) && !menuToggle.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) {
            closeMenu();
            menuToggle.focus();
        }
    });
})();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   スクロールフェードイン
   .timeline 内の .card に .scroll-fade を付与し、
   Intersection Observer で .is-visible を追加する
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
(function () {
    const cards = document.querySelectorAll('.timeline .card');
    if (!cards.length) return;

    cards.forEach((card) => card.classList.add('scroll-fade'));

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    cards.forEach((card) => observer.observe(card));
})();
