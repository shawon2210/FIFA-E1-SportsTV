/* ============================================================
   FIFA E1 SportsTV — Channels Module
   Works with IPTV API data (data.js)
   ============================================================ */

const Channels = (() => {
  let activeChannelId = null;
  let activeCategory  = 'All';
  let searchQuery     = '';

  /* ── Initialize ────────────────────────────────────────── */
  function init() {
    renderChannelList();
    setupCategoryTabs();
  }

  /* ── Rendering ─────────────────────────────────────────── */

  function renderChannelList() {
    const container = document.getElementById('channel-list');
    if (!container) return;

    const filtered = filterChannels(activeCategory, searchQuery);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="no-results">
          <div class="nr-icon">📡</div>
          <p>No channels found</p>
          <p style="font-size:11px; margin-top:4px; opacity:0.7;">
            ${CHANNELS.length === 0 ? 'Loading channels from API...' : 'Try a different search or category'}
          </p>
        </div>`      ;
      return;
    }

    container.innerHTML = filtered.map(ch => renderChannelCard(ch)).join('');

    // Bind events
    container.querySelectorAll('.channel-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.channel-favorite-btn') || e.target.closest('.ch-fav-btn')) return;
        selectChannel(card.dataset.channelId);
      });
    });

    container.querySelectorAll('.channel-favorite-btn, .ch-fav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.channelId);
      });
    });
  }

  function renderChannelCard(ch) {
    const isActive   = ch.id === activeChannelId;
    const favIcon    = ch.isFavorite || ch._isFavorite
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;

    // Use logo URL if available, otherwise emoji
    const logoHTML = ch.logo && ch.logo.startsWith('http')
      ? `<img src="${ch.logo}" alt="${ch.name}" style="width:28px;height:28px;object-fit:contain;border-radius:4px;" onerror="this.style.display='none';this.nextElement.style.display='flex'"><span style="font-size:18px;display:none;">${getCategoryEmoji(ch.category)}</span>`
      : `<span style="font-size:18px;">${typeof ch.logo === 'string' && ch.logo.length <= 4 ? ch.logo : getCategoryEmoji(ch.category)}</span>`;

    return `
      <div class="channel-card ${isActive ? 'active' : ''}" data-channel-id="${ch.id}"
           role="button" tabindex="0" aria-label="Watch ${ch.name}">
        <div class="channel-logo">
          <div class="channel-logo-inner" style="background: ${ch.color}22;">
            ${logoHTML}
          </div>
        </div>
        <div class="channel-info">
          <div class="channel-name">${ch.name}</div>
          <div class="channel-show">${ch.currentShow?.title || ch.name}</div>
        </div>
        <div class="channel-meta">
          <span class="channel-number">CH ${ch.number}</span>
          ${ch.isLive ? '<div class="channel-live-dot" title="Live"></div>' : ''}
        </div>
        <button class="channel-favorite-btn ${ch.isFavorite || ch._isFavorite ? 'favorited' : ''}"
                data-channel-id="${ch.id}"
                aria-label="${ch.isFavorite || ch._isFavorite ? 'Remove from favorites' : 'Add to favorites'}"
                title="${ch.isFavorite || ch._isFavorite ? 'Remove favorite' : 'Add to favorites'}">
          ${favIcon}
        </button>
        <div class="channel-progress-bar">
          <div class="channel-progress-fill" style="width: ${ch.currentShow?.progress || 0}%"></div>
        </div>
      </div>`;
  }

  function getCategoryEmoji(categories) {
    const emojiMap = {
      sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬',
      music: '🎵', documentary: '🎥', business: '💼', lifestyle: '🌿',
      family: '👨‍👩‍👧‍👦', general: '📺', kids: '🧸', animation: '🎨',
    };
    if (categories && categories.length > 0) {
      for (const cat of categories) {
        if (emojiMap[cat]) return emojiMap[cat];
      }
    }
    return '📺';
  }

  /* ── Category Tabs ─────────────────────────────────────── */

  function setupCategoryTabs() {
    const tabContainer = document.getElementById('category-tabs');
    if (!tabContainer) return;

    tabContainer.innerHTML = CATEGORIES.map(cat => `
      <button class="tab-item ${cat === activeCategory ? 'active' : ''}"
              data-category="${cat}"
              aria-pressed="${cat === activeCategory}">
        ${cat}
      </button>
    `).join('');

    tabContainer.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.category;
        tabContainer.querySelectorAll('.tab-item').forEach(b => {
          b.classList.toggle('active', b.dataset.category === activeCategory);
          b.setAttribute('aria-pressed', b.dataset.category === activeCategory);
        });
        renderChannelList();
        scrollToActive();
      });
    });
  }

  /* ── Search ────────────────────────────────────────────── */

  function onSearch(query) {
    searchQuery = query;
    renderChannelList();
  }

  /* ── Channel Selection ─────────────────────────────────── */

  function selectChannel(id) {
    const channel = getChannelById(id);
    if (!channel) return;

    activeChannelId = id;
    renderChannelList();
    updatePlayerUI(channel);
    updateShowInfo(channel);
    updateScheduleBar(channel);

    // Load into player (real stream)
    Player.loadChannel(channel);
    Player.showToast(`📺 Switched to ${channel.name}`, 'success');

    // On mobile, close drawer
    const drawer = document.getElementById('sidebar-drawer');
    if (drawer && drawer.classList.contains('open')) {
      Nav.closeMobileDrawer();
    }
  }

  /* ── Favorites ─────────────────────────────────────────── */

  function toggleFavorite(id) {
    const channel = toggleFavoriteById(id);
    if (!channel) return;
    renderChannelList();
    Player.showToast(
      channel._isFavorite ? `★ Added ${channel.name} to favorites` : `☆ Removed from favorites`,
      'success'
    );
  }

  /* ── Player UI Update ──────────────────────────────────── */

  function updatePlayerUI(channel) {
    // Channel art / emoji
    const art    = document.getElementById('player-channel-art') || document.getElementById('hero-art');
    const artBg  = document.getElementById('player-art-bg') || document.getElementById('hero-glow');
    const artColor = channel.color || '#08101F';

    if (art) {
      const emojiEl = art.querySelector('.player-art-emoji') || art;
      if (emojiEl) emojiEl.textContent = typeof channel.logo === 'string' && channel.logo.length <= 4 ? channel.logo : getCategoryEmoji(channel.category);
      art.style.color = artColor;
    }
    if (artBg) {
      artBg.style.background = `radial-gradient(circle at center, ${artColor}66 0%, ${artColor}11 60%, transparent 100%)`;
    }

    // Badges
    setEl('player-live-badge', channel.isLive
      ? `<div class="live-badge">Live</div>` : '');
    setEl('player-quality-badge',
      `<span class="quality-badge">${channel.streamQuality || channel.quality || 'HD'}</span>`);
    setEl('player-viewers-badge',
      `<span class="viewers-badge">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" opacity="0.7">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        ${channel.viewers || '1K'}
      </span>`);

    setEl('player-channel-name', channel.name);

    // Title
    const titleEl = document.getElementById('player-title') || document.getElementById('hero-title');
    if (titleEl) {
      titleEl.textContent = channel.currentShow?.title || channel.name;
      titleEl.classList.remove('player-switch');
      void titleEl.offsetWidth; // reflow
      titleEl.classList.add('player-switch');
    }

    const subtitleEl = document.getElementById('player-subtitle') || document.getElementById('hero-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = channel.currentShow?.subtitle || `${channel.countryName} · Live`;
    }

    const descEl = document.getElementById('player-description');
    if (descEl) {
      descEl.textContent = channel.currentShow?.description || '';
    }

    // Progress
    const progFill = document.getElementById('player-progress-fill') || document.getElementById('hero-prog-fill');
    if (progFill) {
      progFill.style.width = (channel.currentShow?.progress || 0) + '%';
    }
    const timeEl = document.getElementById('player-current-time') || document.getElementById('hero-time-start');
    if (timeEl && channel.currentShow) {
      timeEl.textContent = `${channel.currentShow.startTime} – ${channel.currentShow.endTime}`;
    }

    // Update hero badges
    const heroQuality = document.getElementById('hero-quality');
    if (heroQuality) heroQuality.textContent = channel.streamQuality || channel.quality || 'HD';

    const heroViewers = document.getElementById('hero-viewers');
    if (heroViewers) {
      heroViewers.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        ${channel.viewers || '1K'}
      `;
    }
  }

  function updateShowInfo(channel) {
    setEl('show-title',       channel.currentShow?.title || channel.name);
    setEl('show-subtitle',    channel.currentShow?.subtitle || `${channel.countryName} · Live`);
    setEl('show-description', channel.currentShow?.description || '');
    setEl('show-channel-name', channel.name);
    setEl('show-time-range',
      channel.currentShow ? `${channel.currentShow.startTime} – ${channel.currentShow.endTime}` : '');
    setEl('next-show-title',
      channel.nextShow?.title || 'No schedule available');
    setEl('next-show-time',
      channel.nextShow ? `${channel.nextShow.startTime} – ${channel.nextShow.endTime}` : '');
    setEl('stat-viewers', channel.viewers || '1K');
    setEl('stat-quality', channel.streamQuality || channel.quality || 'HD');
    setEl('stat-channel', `CH ${channel.number}`);

    const liveIndicator = document.getElementById('show-live-indicator');
    if (liveIndicator) {
      liveIndicator.style.display = channel.isLive ? 'flex' : 'none';
    }
  }

  function updateScheduleBar(channel) {
    const bar = document.getElementById('schedule-bar');
    if (!bar) return;

    const shows = [];
    const now = new Date();
    const currentShow = channel.currentShow;

    if (currentShow) {
      // Previous show
      shows.push({
        time: formatTime(new Date(now - 2 * 60 * 60 * 1000)),
        title: 'Previous Program',
        current: false,
      });
      // Current show
      shows.push({
        time: currentShow.startTime,
        title: currentShow.title,
        current: true,
      });
      // Next show
      if (channel.nextShow) {
        shows.push({
          time: channel.nextShow.startTime,
          title: channel.nextShow.title,
          current: false,
        });
        shows.push({
          time: formatTime(new Date(now + 4 * 60 * 60 * 1000)),
          title: 'Up Next',
          current: false,
        });
      }
    }

    bar.innerHTML = shows.map(s => `
      <div class="schedule-item ${s.current ? 'current' : ''}">
        <span class="schedule-time">${s.time}</span>
        <span class="schedule-show">${s.title}</span>
        ${s.current ? '<span class="sch-tag">NOW SHOWING</span>' : ''}
      </div>
    `).join('');
  }

  function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  /* ── Helpers ───────────────────────────────────────────── */

  function setEl(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = html;
    } else {
      const isText = !html.includes('<');
      if (isText) el.textContent = html;
      else el.innerHTML = html;
    }
  }

  function scrollToActive() {
    const activeCard = document.querySelector('.channel-card.active');
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  return { init, onSearch, selectChannel, scrollToActive };
})();
