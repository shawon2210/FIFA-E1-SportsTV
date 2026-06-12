/* ============================================================
   FIFA E1 SportsTV — Navigation Module
   ============================================================ */

const Nav = (() => {
  let clockInterval;

  function init() {
    startLiveClock();
    bindSettings();
    bindSearchShortcut();
  }

  /* ── Clock ──────────────────────────────────────────────── */

  function startLiveClock() {
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
  }

  function updateClock() {
    const now    = new Date();
    const h      = String(now.getHours()).padStart(2, '0');
    const m      = String(now.getMinutes()).padStart(2, '0');
    const s      = String(now.getSeconds()).padStart(2, '0');
    const timeEl = document.getElementById('top-clock');
    if (timeEl) timeEl.textContent = `${h}:${m}:${s}`;
  }

  /* ── Settings Modal ─────────────────────────────────────── */

  function bindSettings() {
    const modal    = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('modal-close');

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSettings();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSettings);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSettings();
    });

    const btnSettings   = document.getElementById('btn-settings');
    const btnSidebarSet = document.getElementById('nav-settings-btn');
    [btnSettings, btnSidebarSet].forEach(b => b?.addEventListener('click', openSettings));
  }

  function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('open');
  }
  function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('open');
  }

  /* ── Search Keyboard Shortcut ───────────────────────────── */

  function bindSearchShortcut() {
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        const el = document.getElementById('search-input');
        if (el) el.focus();
      }
    });
  }

  /* ── Helpers ────────────────────────────────────────────── */

  function destroy() {
    clearInterval(clockInterval);
  }

  return { init, openSettings, closeSettings, destroy };
})();
