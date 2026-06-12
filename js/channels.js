/* ============================================================
   FIFA E1 SportsTV — Channels Module
   ============================================================ */

const Channels = (() => {
  let activeChannelId      = null;
  let activeCategory       = 'All';
  let searchQuery          = '';
  let viewerSimulationTick = null;

  function init() {
    renderCategoryTabs();
    renderChannelList();
    setupSearch();
  }

  /* ── Category Tabs ──────────────────────────────────────── */

  function renderCategoryTabs() {
    const container = document.getElementById('rp-cats');
    if (!container) return;

    container.innerHTML = CATEGORIES.map(cat => `
      <button class="cat-pill ${cat === activeCategory ? 'active' : ''}"
              data-cat="${cat}" role="tab" aria-selected="${cat === activeCategory}">
        ${cat}
      </button>
    `).join('');

    container.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        renderCategoryTabs();
        renderChannelList();
      });
    });
  }

  /* ── Search ─────────────────────────────────────────────── */

  function setupSearch() {
    const searchEl = document.getElementById('search-input');
    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderChannelList();
      });
      searchEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchEl.value = '';
          searchQuery = '';
          renderChannelList();
          searchEl.blur();
        }
      });
    }
  }

  /* ── Channel List Rendering ─────────────────────────────── */

  function renderChannelList() {
    const container = document.getElementById('rp-list');
    if (!container) return;

    const filtered = filterChannels(activeCategory, searchQuery);

    if (!filtered.length) {
      container.innerHTML = `
        <div class="no-results">
          <div class="nr-icon">📡</div>
          No channels found.<br>
          <small style="font-size:11px;font-weight:400;">Try a different search or category.</small>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map((ch, i) => renderChannelCard(ch, i)).join('');

    container.querySelectorAll('.ch-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.ch-fav-btn')) return;
        selectChannel(card.dataset.id);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectChannel(card.dataset.id);
        }
      });
    });

    container.querySelectorAll('.ch-fav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.id);
      });
    });
  }

  function renderChannelCard(ch, index) {
    const isActive = ch.id === activeChannelId;
    const favIcon  = ch.isFavorite
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
           <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
         </svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
         </svg>`;

    const showTitle = ch.currentShow
      ? ch.currentShow.title
      : 'Loading…';

    return `
      <div class="ch-card ${isActive ? 'active' : ''}"
           data-id="${ch.id}" role="listitem" tabindex="0"
           aria-label="Watch ${ch.name}"
           aria-selected="${isActive}"
           style="animation-delay:${index * 0.02}s">
        <div class="ch-logo">
          <div class="ch-logo-inner" style="background:${ch.color}22;">
            <span style="font-size:19px;">${ch.logo || '📺'}</span>
          </div>
        </div>
        <div class="ch-info">
          <div class="ch-name">${ch.name}</div>
          <div class="ch-show">${showTitle}</div>
          <div class="ch-prog-bar">
            <div class="ch-prog-fill" style="width:${ch.currentShow ? ch.currentShow.progress : 0}%"></div>
          </div>
        </div>
        <div class="ch-meta">
          <span class="ch-num">CH ${ch.number || ch.id.slice(-3)}</span>
          ${ch.isLive ? '<div class="ch-live-dot" title="Live"></div>' : ''}
        </div>
        <button class="ch-fav-btn ${ch.isFavorite ? 'fav' : ''}"
                data-id="${ch.id}"
                title="${ch.isFavorite ? 'Remove favorite' : 'Add to favorites'}"
                aria-label="${ch.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
          ${favIcon}
        </button>
      </div>`;
  }

  /* ── Channel Selection ──────────────────────────────────── */

  function selectChannel(id) {
    const ch = getChannelById(id);
    if (!ch) return;

    activeChannelId = ch.id;
    renderChannelList();

    updateHeroUI(ch);
    updateShowInfo(ch);

    Player.loadChannel(ch);
    Player.showToast(`📺 ${ch.name}`, 'ok');

    scrollToActive();
  }

  function updateHeroUI(ch) {
    setEl('hero-art', ch.logo || '📺');
    const glow = document.getElementById('hero-glow');
    if (glow) {
      glow.style.background =
        `radial-gradient(ellipse at center, ${ch.color}55 0%, ${ch.color}18 45%, transparent 75%)`;
    }

    const titleEl = document.getElementById('hero-title');
    if (titleEl) {
      titleEl.style.opacity   = '0';
      titleEl.style.transform = 'translateY(8px)';
      setTimeout(() => {
        titleEl.textContent    = ch.currentShow?.title || ch.name;
        titleEl.style.transition = 'all 0.3s ease';
        titleEl.style.opacity  = '1';
        titleEl.style.transform = 'translateY(0)';
      }, 100);
    }
    setEl('hero-subtitle', ch.currentShow?.subtitle || '');

    setEl('hero-quality', ch.quality || 'HD');

    const viewersEl = document.getElementById('hero-viewers');
    if (viewersEl) {
      viewersEl.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34-3-3-3-3z"/>
        </svg>
        ${ch.viewers || '--'}`;
    }

    const liveBadge = document.getElementById('hero-badges');
    if (liveBadge) {
      const badgeLive = liveBadge.querySelector('.badge-live');
      if (badgeLive) badgeLive.style.display = ch.isLive ? 'flex' : 'none';
    }

    if (ch.currentShow) {
      const fill = document.getElementById('hero-prog-fill');
      if (fill) fill.style.width = ch.currentShow.progress + '%';
      setEl('hero-time-start', ch.currentShow.startTime || '--:--');
      setEl('hero-time-end',   ch.currentShow.endTime   || '--:--');
    }

    const liveCountEl = document.getElementById('live-count');
    if (liveCountEl) {
      const count = window.CHANNELS.filter(c => c.isLive).length;
      liveCountEl.textContent = `${count} LIVE`;
    }

    renderCardRow(ch);
    renderScheduleBar(ch);
  }

  function renderCardRow(activeCh) {
    const container = document.getElementById('cards-row');
    if (!container) return;

    const others = window.CHANNELS.filter(c => c.id !== activeCh.id).slice(0, 4);
    container.innerHTML = others.map(ch => `
      <div class="video-card" data-id="${ch.id}" tabindex="0" role="button"
           aria-label="Switch to ${ch.name}">
        <div class="vc-bg" style="color:${ch.color};">${ch.logo || '📺'}</div>
        <div class="vc-top-badges">
          ${ch.isLive ? '<span class="vc-live-badge">Live</span>' : ''}
          <span class="vc-cat-badge">${ch.category ? ch.category[0] : 'Other'}</span>
        </div>
        <div class="vc-overlay">
          <div class="vc-ch-name">${ch.name}</div>
          <div class="vc-show-name">${ch.currentShow?.title || 'Loading…'}</div>
          <div class="vc-prog-bar">
            <div class="vc-prog-fill" style="width:${ch.currentShow ? ch.currentShow.progress : 0}%"></div>
          </div>
        </div>
        <div class="vc-play-overlay">
          <div class="vc-play-circle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.video-card').forEach(card => {
      card.addEventListener('click', () => selectChannel(card.dataset.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') selectChannel(card.dataset.id);
      });
    });
  }

  function renderScheduleBar(ch) {
    const bar = document.getElementById('schedule-bar');
    if (!bar) return;

    const items = [
      {
        time:    ch.currentShow?.startTime || '--:--',
        title:   ch.currentShow?.title    || 'Loading…',
        current: true
      },
      {
        time:    ch.nextShow?.startTime   || '--:--',
        title:   ch.nextShow?.title       || 'Up Next',
        current: false
      }
    ];

    bar.innerHTML = items.map(s => `
      <div class="sch-item ${s.current ? 'sch-current' : ''}">
        <span class="sch-time">${s.time}</span>
        <span class="sch-show">${s.title}</span>
        ${s.current ? '<span class="sch-tag">Now Showing</span>' : ''}
      </div>
    `).join('');
  }

  function updateShowInfo(ch) {
    setEl('show-title',       ch.currentShow?.title       || ch.name);
    setEl('show-subtitle',    ch.currentShow?.subtitle    || '');
    setEl('show-description', ch.currentShow?.description || '');
    setEl('show-channel-name',ch.name);
    setEl('show-time-range',
      `${ch.currentShow?.startTime || '--:--'} – ${ch.currentShow?.endTime || '--:--'}`);
    setEl('next-show-title',  ch.nextShow?.title          || '');
    setEl('next-show-time',
      ch.nextShow
        ? `${ch.nextShow.startTime} – ${ch.nextShow.endTime}`
        : '');
    setEl('stat-viewers', ch.viewers || '--');
    setEl('stat-quality', ch.quality || 'HD');
    setEl('stat-channel', `CH ${ch.number || ch.id.slice(-3)}`);

    const liveIndicator = document.getElementById('show-live-indicator');
    if (liveIndicator) {
      liveIndicator.style.display = ch.isLive ? 'flex' : 'none';
    }
  }

  /* ── Favorites ──────────────────────────────────────────── */

  function toggleFavorite(id) {
    const ch = window.CHANNELS.find(c => c.id === id);
    if (!ch) return;
    ch.isFavorite = !ch.isFavorite;
    renderChannelList();
    Player.showToast(
      ch.isFavorite ? `★ Added ${ch.name} to favorites` : `☆ Removed ${ch.name}`,
      'ok'
    );
  }

  /* ── Helpers ────────────────────────────────────────────── */

  function setEl(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const isText = typeof value === 'string' && !value.includes('<');
    isText ? el.textContent = value : el.innerHTML = value;
  }

  function scrollToActive() {
    const card = document.querySelector('.ch-card.active');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function simulateViewerFluctuation() {
    clearInterval(viewerSimulationTick);
    viewerSimulationTick = setInterval(() => {
      const ch = getChannelById(activeChannelId);
      if (!ch || ch.viewers === '--') return;
      const base  = parseFloat(ch.viewers.replace('K','')) * 1000;
      const delta = Math.floor((Math.random() - 0.5) * 300);
      const val   = Math.max(0, base + delta);
      const disp  = val >= 1000 ? (val/1000).toFixed(1)+'K' : String(val);
      ch.viewers  = disp;

      const viewersEl = document.getElementById('hero-viewers');
      if (viewersEl) viewersEl.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34-3-3-3-3-3z"/>
        </svg>
        ${disp}`;
    }, 7000);
  }

  return {
    init,
    onSearch:     (q) => { searchQuery = q; renderChannelList(); },
    selectChannel,
    scrollToActive,
    renderCategoryTabs,
    renderChannelList,
    simulateViewerFluctuation,
    getActiveId: () => activeChannelId
  };
})();
