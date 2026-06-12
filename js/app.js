/* ============================================================
   FIFA E1 SportsTV — App Entry Point
   Loads real IPTV channels from iptv-org/iptv API
   https://github.com/iptv-org/iptv
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ── Show loading state ────────────────────────────────── */
  const container = document.getElementById('channel-list');
  if (container) {
    container.innerHTML = `
      <div class="no-results" style="padding:60px 16px;">
        <div style="font-size:48px;margin-bottom:16px;animation:pulse 1.5s ease infinite;">📡</div>
        <p>Loading live channels...</p>
        <p style="font-size:11px;margin-top:8px;opacity:0.7;">Fetching from iptv-org/iptv API</p>
      </div>`;
  }

  /* ── Load IPTV API data ───────────────────────────────── */
  try {
    await initChannelData();
  } catch (err) {
    console.error('Failed to load IPTV data:', err);
  }

  /* ── Get default channel ──────────────────────────────── */
  const defaultChannel = CHANNELS && CHANNELS.length > 0 ? CHANNELS[0] : null;

  /* ── Initialize modules ────────────────────────────────── */
  Player.init();
  Nav.init();
  Channels.init();

  /* ── Load initial channel ──────────────────────────────── */
  if (defaultChannel) {
    Channels.selectChannel(defaultChannel.id);
    setTimeout(() => Channels.scrollToActive(), 100);
  }

  /* ── Viewer count animation ────────────────────────────── */
  simulateViewerCount();

  /* ── Page visibility: pause on hide ────────────────────── */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Optionally pause when tab is hidden
    }
  });

  console.log('%c FIFA E1 SportsTV ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:14px; padding:4px 8px; border-radius:4px;');
  console.log(`%c ${CHANNELS.length} Live Channels • Powered by iptv-org/iptv `, 'color:#8292B0; font-size:11px;');
});

/* ── Viewer count simulation ────────────────────────────── */
function simulateViewerCount() {
  setInterval(() => {
    const viewerEl = document.getElementById('stat-viewers');
    if (!viewerEl || !CHANNELS || CHANNELS.length === 0) return;
    const ch = CHANNELS.find(c => c.id === (window._activeChannelId || ''));
    if (!ch) return;
    const base = parseFloat(ch.viewers) * 1000;
    if (isNaN(base)) return;
    const delta = Math.floor((Math.random() - 0.5) * 200);
    const newVal = Math.max(0, base + delta);
    viewerEl.textContent = newVal >= 1000
      ? (newVal / 1000).toFixed(1) + 'K'
      : String(newVal);
  }, 8000);
}
