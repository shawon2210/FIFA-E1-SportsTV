/* ============================================================
   FIFA E1 SportsTV — App Entry Point
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  showLoadingState();

  Data.init()
    .then(() => {
      hideLoadingState();
      Player.init();
      Nav.init();
      Channels.init();
      Channels.simulateViewerFluctuation();
    })
    .catch((err) => {
      console.error('Failed to initialize app:', err);
      hideLoadingState();
      Player.init();
      Nav.init();
      Channels.init();
      Channels.simulateViewerFluctuation();
    });

  console.log('%c A1TV LiveTV ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:14px; padding:4px 8px; border-radius:4px;');
  console.log('%c Powered by iptv-org — 10,000+ free channels ', 'color:#8292B0; font-size:11px;');
});

/* ── Loading / skeleton UI ────────────────────────────────── */

function showLoadingState() {
  const hero = document.getElementById('hero-player');
  if (hero) hero.classList.add('loading-pending');

  const rpList = document.getElementById('rp-list');
  if (rpList) {
    rpList.innerHTML = Array.from({ length: 8 }, () => `
      <div class="ch-card skeleton-card">
        <div class="ch-logo"><div class="skeleton" style="width:36px;height:36px;border-radius:var(--radius-xs);"></div></div>
        <div class="ch-info">
          <div class="skeleton" style="width:120px;height:12px;border-radius:4px;margin-bottom:6px;"></div>
          <div class="skeleton" style="width:80px;height:10px;border-radius:4px;"></div>
        </div>
      </div>
    `).join('');
  }

  const cardsRow = document.getElementById('cards-row');
  if (cardsRow) {
    cardsRow.innerHTML = Array.from({ length: 4 }, () => `
      <div class="video-card skeleton-card" style="pointer-events:none;">
        <div class="skeleton" style="aspect-ratio:16/10;"></div>
      </div>
    `).join('');
  }
}

function hideLoadingState() {
  const hero = document.getElementById('hero-player');
  if (hero) hero.classList.remove('loading-pending');
}
