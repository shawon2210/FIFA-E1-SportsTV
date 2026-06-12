/* ============================================================
   FIFA E1 SportsTV — Channel Data (Powered by iptv-org/iptv)
   Fetches real live TV channels from:
   https://github.com/iptv-org/iptv
   https://github.com/iptv-org/api
   ============================================================ */

// Global state — must be accessible to all modules
var CATS = ['All', 'Live', 'Sports', 'News', 'Movies', 'Entertainment', 'Music', 'Favorites'];
var CHANNELS = [];
var activeId = null;
var activeCat = 'All';
var searchQ = '';
var isPlaying = false;
var isMuted = false;
var HlsInstance = null;

/* ── Category display mapping ──────────────────────────── */
var CATEGORY_DISPLAY = {
  sports: 'Sports', news: 'News', entertainment: 'Entertainment',
  movies: 'Movies', music: 'Music', documentary: 'Documentary',
  business: 'Business', lifestyle: 'Lifestyle', family: 'Family',
  general: 'General', kids: 'Kids', animation: 'Animation',
};

var CATEGORY_EMOJI = {
  sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬',
  music: '🎵', documentary: '🎥', business: '💼', lifestyle: '🌿',
  family: '👨‍👩‍👧‍👦', general: '📺', kids: '🧸', animation: '🎨',
};

/* ── IPTV API Base URLs ────────────────────────────────── */
var IPTV_BASE = 'https://iptv-org.github.io';
var IPTV_API = IPTV_BASE + '/api';

/* ── Fetch with timeout ─────────────────────────────────── */
function fetchJSON(url, timeout) {
  timeout = timeout || 15000;
  return new Promise(function(resolve, reject) {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); reject(new Error('timeout')); }, timeout);
    fetch(url, { signal: ctrl.signal })
      .then(function(res) {
        clearTimeout(timer);
        if (!res.ok) return reject(new Error('HTTP ' + res.status));
        return res.json();
      })
      .then(resolve)
      .catch(reject);
  });
}

/* ── Load IPTV data ─────────────────────────────────────── */
function loadIPTVData() {
  updateLoadingState();

  return Promise.all([
    fetchJSON(IPTV_API + '/channels.json', 20000).catch(function() { return []; }),
    fetchJSON(IPTV_API + '/streams.json', 20000).catch(function() { return []; }),
    fetchJSON(IPTV_API + '/categories.json', 10000).catch(function() { return []; }),
  ]).then(function(results) {
    var apiChannels = results[0];
    var apiStreams = results[1];
    var apiCats = results[2];

    // Build stream lookup
    var streamMap = {};
    apiStreams.forEach(function(s) {
      if (s.channel && s.url) {
        if (!streamMap[s.channel]) streamMap[s.channel] = [];
        streamMap[s.channel].push(s);
      }
    });

    // Target categories
    var targetCats = ['sports', 'news', 'entertainment', 'movies', 'music', 'documentary', 'business', 'lifestyle', 'family', 'general', 'kids', 'animation'];

    // Transform channels
    var usedCats = {};
    CHANNELS = [];

    for (var i = 0; i < apiChannels.length && CHANNELS.length < 300; i++) {
      var ch = apiChannels[i];
      if (!ch || !ch.id) continue;

      // Check if has stream
      var streams = streamMap[ch.id];
      if (!streams || streams.length === 0) continue;

      // Check category
      var chCats = ch.categories || [];
      if (!Array.isArray(chCats)) chCats = [];
      var matchedCat = null;
      for (var c = 0; c < chCats.length; c++) {
        var catId = (typeof chCats[c] === 'string' ? chCats[c] : (chCats[c].id || '')).toLowerCase();
        if (targetCats.indexOf(catId) !== -1) {
          matchedCat = catId;
          usedCats[catId] = true;
          break;
        }
      }
      if (!matchedCat) continue;

      // Get best stream (prefer non-geo, higher quality)
      var bestStream = streams[0];
      var qualityOrder = { '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
      streams.sort(function(a, b) {
        var aGeo = (a.label || '').toLowerCase().includes('geo') ? 1 : 0;
        var bGeo = (b.label || '').toLowerCase().includes('geo') ? 1 : 0;
        if (aGeo !== bGeo) return aGeo - bGeo;
        return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
      });
      bestStream = streams[0];

      var color = getColorForCategory(matchedCat);
      var emoji = CATEGORY_EMOJI[matchedCat] || '📺';
      var now = new Date();
      var endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      CHANNELS.push({
        id: ch.id,
        name: ch.name || ch.id,
        num: String(CHANNELS.length + 1).padStart(3, '0'),
        cat: [CATEGORY_DISPLAY[matchedCat] || matchedCat],
        quality: bestStream.quality || 'HD',
        viewers: formatViewers(Math.floor(Math.random() * 50000) + 1000),
        live: true,
        fav: false,
        emoji: emoji,
        color: color,
        logo: ch.logo || null,
        country: ch.country || '',
        streamUrl: bestStream.url || null,
        score: null,
        show: {
          title: bestStream.title || ch.name,
          sub: (ch.country || '') + ' · ' + (CATEGORY_DISPLAY[matchedCat] || matchedCat),
          desc: (ch.name || '') + ' is a ' + (CATEGORY_DISPLAY[matchedCat] || matchedCat) + ' channel.',
          start: formatTime(now),
          end: formatTime(endTime),
          prog: Math.floor(Math.random() * 60) + 20,
        },
        next: {
          title: 'Up Next',
          start: formatTime(endTime),
          end: formatTime(new Date(endTime.getTime() + 2 * 60 * 60 * 1000)),
        },
      });
    }

    // Build categories list
    CATS = ['All', 'Live', 'Favorites'];
    var catKeys = Object.keys(usedCats).sort();
    catKeys.forEach(function(k) {
      if (CATEGORY_DISPLAY[k]) CATS.push(CATEGORY_DISPLAY[k]);
    });

    console.log(
      '%c IPTV: ' + CHANNELS.length + ' channels loaded ',
      'background:#00F2FE; color:#040711; font-weight:900; font-size:12px; padding:4px 8px; border-radius:4px;'
    );

    return CHANNELS;
  }).catch(function(err) {
    console.warn('IPTV API failed:', err);
    return [];
  });
}

function updateLoadingState() {
  var container = document.getElementById('rp-list');
  if (container) {
    container.innerHTML = '<div class="no-results"><div style="font-size:48px;margin-bottom:16px;">📡</div><p>Loading live channels...</p><p style="font-size:11px;margin-top:8px;opacity:0.7;">Fetching from iptv-org/iptv API</p></div>';
  }
}

function getColorForCategory(cat) {
  var colors = {
    sports: '#1a6b3c', news: '#cc0000', entertainment: '#6a1e8a',
    movies: '#1a3a5c', music: '#e040fb', documentary: '#0d47a1',
    business: '#37474f', lifestyle: '#2e7d32', family: '#f57c00',
    general: '#37474f', kids: '#e91e63', animation: '#ff6f00',
  };
  return colors[cat] || '#37474f';
}

function formatViewers(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* ── Helpers ────────────────────────────────────────────── */
function $id(id) { return document.getElementById(id); }

function setCh(el, html) {
  if (!el) return;
  if (!html) { el.textContent = ''; return; }
  var isText = html.indexOf('<') === -1;
  if (isText) el.textContent = html;
  else el.innerHTML = html;
}

function toast(msg, type) {
  type = type || 'ok';
  var wrap = $id('toast-wrap');
  if (!wrap) return;
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(function() {
    t.style.transition = 'all 0.25s ease';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(function() { t.remove(); }, 260);
  }, 2800);
}

function getFiltered() {
  var list = CHANNELS;
  if (activeCat === 'Favorites') list = list.filter(function(c) { return c.fav; });
  else if (activeCat === 'Live') list = list.filter(function(c) { return c.live; });
  else if (activeCat !== 'All') list = list.filter(function(c) { return c.cat.indexOf(activeCat) !== -1; });
  if (searchQ.trim()) {
    var q = searchQ.toLowerCase();
    list = list.filter(function(c) {
      return (c.name || '').toLowerCase().indexOf(q) !== -1 ||
             (c.show.title || '').toLowerCase().indexOf(q) !== -1 ||
             c.cat.some(function(x) { return x.toLowerCase().indexOf(q) !== -1; });
    });
  }
  return list;
}

/* ── Render channel list ────────────────────────────────── */
function renderList() {
  var list = getFiltered();
  var container = $id('rp-list');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = '<div class="no-results"><div class="nr-icon">📡</div>No channels found.<br><small style="font-size:11px;font-weight:400;">Try a different search or category.</small></div>';
    return;
  }

  container.innerHTML = list.map(function(ch, i) {
    var logoHTML = '📺';
    if (ch.logo && ch.logo.indexOf('http') === 0) {
      logoHTML = '<img src="' + ch.logo + '" alt="' + ch.name + '" style="width:28px;height:28px;object-fit:contain;border-radius:4px;" onerror="this.style.display=\'none\';this.nextElement.style.display=\'flex\'"><span style="font-size:19px;display:none;">' + ch.emoji + '</span>';
    } else {
      logoHTML = '<span style="font-size:19px;">' + ch.emoji + '</span>';
    }

    return '<div class="ch-card ' + (ch.id === activeId ? 'active' : '') + '"\n         data-id="' + ch.id + '" role="listitem" tabindex="0"\n         aria-label="Watch ' + ch.name + '" aria-selected="' + (ch.id === activeId) + '"\n         style="animation-delay:' + (i * 0.02) + 's">\n      <div class="ch-logo">\n        <div class="ch-logo-inner" style="background:' + ch.color + '22;">\n          ' + logoHTML + '\n        </div>\n      </div>\n      <div class="ch-info">\n        <div class="ch-name">' + ch.name + '</div>\n        <div class="ch-show">' + ch.show.title + '</div>\n        <div class="ch-prog-bar">\n          <div class="ch-prog-fill" style="width:' + ch.show.prog + '%"></div>\n        </div>\n      </div>\n      <div class="ch-meta">\n        <span class="ch-num">CH ' + ch.num + '</span>\n        ' + (ch.live ? '<div class="ch-live-dot" title="Live"></div>' : '') + '\n      </div>\n      <button class="ch-fav-btn ' + (ch.fav ? 'fav' : '') + '"\n              data-id="' + ch.id + '"\n              title="' + (ch.fav ? 'Remove favorite' : 'Add to favorites') + '"\n              aria-label="' + (ch.fav ? 'Remove from favorites' : 'Add to favorites') + '">\n        <svg width="12" height="12" viewBox="0 0 24 24" ' + (ch.fav ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"') + '>\n          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>\n        </svg>\n      </button>\n    </div>';
  }).join('');

  // Bind events
  container.querySelectorAll('.ch-card').forEach(function(card) {
    card.addEventListener('click', function(e) {
      if (e.target.closest('.ch-fav-btn')) return;
      selectChannel(card.dataset.id);
    });
    card.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectChannel(card.dataset.id);
      }
    });
  });
  container.querySelectorAll('.ch-fav-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleFav(btn.dataset.id);
    });
  });

  // Update count
  var countEl = $id('rp-count');
  if (countEl) countEl.textContent = list.length + ' CH';
}

/* ── Render category tabs ───────────────────────────────── */
function renderCats() {
  var el = $id('rp-cats');
  if (!el) return;
  el.innerHTML = CATS.map(function(c) {
    return '<button class="cat-pill ' + (c === activeCat ? 'active' : '') + '"\n            data-cat="' + c + '" role="tab" aria-selected="' + (c === activeCat) + '">' + c + '</button>';
  }).join('');
  el.querySelectorAll('.cat-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      activeCat = btn.dataset.cat;
      renderCats();
      renderList();
    });
  });
}

/* ── Render video cards ─────────────────────────────────── */
function renderCards() {
  var container = $id('cards-row');
  if (!container) return;
  var cards = CHANNELS.filter(function(c) { return c.id !== activeId; }).slice(0, 4);
  container.innerHTML = cards.map(function(ch) {
    return '<div class="video-card ' + (ch.id === activeId ? 'active-card' : '') + '"\n         data-id="' + ch.id + '" tabindex="0" role="button" aria-label="Switch to ' + ch.name + '">\n      <div class="vc-bg" style="color:' + ch.color + ';">' + ch.emoji + '</div>\n      <div class="vc-top-badges">\n        ' + (ch.live ? '<span class="vc-live-badge">Live</span>' : '') + '\n        <span class="vc-cat-badge">' + ch.cat[0] + '</span>\n      </div>\n      <div class="vc-overlay">\n        <div class="vc-ch-name">' + ch.name + '</div>\n        <div class="vc-show-name">' + ch.show.title + '</div>\n        <div class="vc-prog-bar">\n          <div class="vc-prog-fill" style="width:' + ch.show.prog + '%"></div>\n        </div>\n      </div>\n      <div class="vc-play-overlay">\n        <div class="vc-play-circle">\n          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>\n        </div>\n      </div>\n    </div>';
  }).join('');

  container.querySelectorAll('.video-card').forEach(function(card) {
    card.addEventListener('click', function() { selectChannel(card.dataset.id); });
    card.addEventListener('keydown', function(e) { if (e.key === 'Enter') selectChannel(card.dataset.id); });
  });
}

/* ── Render schedule ────────────────────────────────────── */
function renderSchedule(ch) {
  var bar = $id('schedule-bar');
  if (!bar) return;
  var parts = (ch.show.start || '00:00').split(':');
  var h = parseInt(parts[0]) || 0;
  var m = parseInt(parts[1]) || 0;
  var prevH = ((h - 2 + 24) % 24);
  var prevTime = String(prevH).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  var nextParts = ((ch.next && ch.next.end) || '00:00').split(':');
  var nh = parseInt(nextParts[0]) || 0;
  var nm = parseInt(nextParts[1]) || 0;
  var afterTime = String((nh + 1) % 24).padStart(2, '0') + ':' + String(nm).padStart(2, '0');

  var items = [
    { time: prevTime, title: 'Previous Program', current: false },
    { time: ch.show.start, title: ch.show.title, current: true },
    { time: (ch.next && ch.next.start) || '', title: (ch.next && ch.next.title) || 'TBA', current: false },
    { time: afterTime, title: 'Up Next', current: false },
  ];

  bar.innerHTML = items.map(function(s) {
    return '<div class="sch-item ' + (s.current ? 'sch-current' : '') + '">\n      <span class="sch-time">' + s.time + '</span>\n      <span class="sch-show">' + s.title + '</span>\n      ' + (s.current ? '<span class="sch-tag">Now Showing</span>' : '') + '\n    </div>';
  }).join('');
}

/* ── Select channel ─────────────────────────────────────── */
function selectChannel(id) {
  var ch = CHANNELS.find(function(c) { return c.id === id; });
  if (!ch) return;
  activeId = id;

  // Update hero art
  var artEl = $id('hero-art');
  if (artEl) artEl.textContent = ch.emoji;
  var glowEl = $id('hero-glow');
  if (glowEl) glowEl.style.background = 'radial-gradient(ellipse at center, ' + ch.color + '55 0%, ' + ch.color + '18 45%, transparent 75%)';

  // Title + subtitle (animate)
  var titleEl = $id('hero-title');
  if (titleEl) {
    titleEl.style.opacity = '0';
    titleEl.style.transform = 'translateY(8px)';
    setTimeout(function() {
      titleEl.textContent = ch.show.title;
      titleEl.style.transition = 'all 0.3s ease';
      titleEl.style.opacity = '1';
      titleEl.style.transform = 'translateY(0)';
    }, 100);
  }
  setCh($id('hero-subtitle'), ch.show.sub);

  // Badges
  var badgesEl = $id('hero-badges');
  if (badgesEl) {
    var liveEl = badgesEl.querySelector('.badge-live');
    if (liveEl) liveEl.style.display = ch.live ? 'flex' : 'none';
  }
  setCh($id('hero-quality'), ch.quality);
  var viewersEl = $id('hero-viewers');
  if (viewersEl) {
    viewersEl.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>\n    ' + ch.viewers;
  }

  // Score
  var scoreEl = $id('hero-score');
  if (ch.score && scoreEl) {
    scoreEl.style.display = 'flex';
    setCh($id('score-team1'), ch.score.t1);
    setCh($id('score-team2'), ch.score.t2);
    setCh($id('score-num'), ch.score.s);
    var vsEl = scoreEl.querySelector('.score-vs');
    if (vsEl) vsEl.textContent = 'LIVE ' + ch.score.min;
  } else if (scoreEl) {
    scoreEl.style.display = 'none';
  }

  // Progress
  var fill = $id('hero-prog-fill');
  if (fill) fill.style.width = ch.show.prog + '%';
  setCh($id('hero-time-start'), ch.show.start);
  setCh($id('hero-time-end'), ch.show.end);

  // Live count
  var liveCount = CHANNELS.filter(function(c) { return c.live; }).length;
  setCh($id('live-count'), liveCount + ' LIVE');

  // Schedule & cards
  renderSchedule(ch);
  renderCards();
  renderList();

  // Scroll active into view
  setTimeout(function() {
    var activeCard = document.querySelector('.ch-card.active');
    if (activeCard) activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);

  // ── Load real stream ──────────────────────────────────
  loadStream(ch);

  toast('📺 ' + ch.name, 'ok');
}

/* ── Load HLS stream ────────────────────────────────────── */
function loadStream(ch) {
  var streamUrl = ch.streamUrl;
  if (!streamUrl) {
    toast('⚠️ No stream URL for ' + ch.name, 'err');
    return;
  }

  // Find or create video element
  var player = $id('hero-player');
  if (!player) return;

  var video = player.querySelector('video');
  if (!video) {
    video = document.createElement('video');
    video.id = 'hls-video';
    video.playsInline = true;
    video.autoplay = true;
    video.muted = isMuted;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#040711;';
    player.insertBefore(video, player.firstChild);
  }

  // Destroy previous HLS
  if (HlsInstance) {
    HlsInstance.destroy();
    HlsInstance = null;
  }

  if (Hls && Hls.isSupported() && streamUrl.indexOf('.m3u8') !== -1) {
    var hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      maxBufferLength: 30,
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      video.play().then(function() {
        isPlaying = true;
        updatePlayBtn();
      }).catch(function() {
        isPlaying = false;
        updatePlayBtn();
      });
    });
    hls.on(Hls.Events.ERROR, function(event, data) {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          toast('⚠️ Network error — retrying...', 'err');
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          toast('⚠️ Stream error — try another channel', 'err');
          hls.destroy();
        }
      }
    });
    HlsInstance = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.play().then(function() { isPlaying = true; updatePlayBtn(); }).catch(function() { isPlaying = false; });
  } else {
    video.src = streamUrl;
    video.play().then(function() { isPlaying = true; updatePlayBtn(); }).catch(function() {
      toast('⚠️ Cannot play this stream format', 'err');
      isPlaying = false;
    });
  }
}

/* ── Player controls ────────────────────────────────────── */
function togglePlay() {
  var video = document.querySelector('#hero-player video');
  if (video) {
    if (video.paused) { video.play(); isPlaying = true; }
    else { video.pause(); isPlaying = false; }
  } else {
    isPlaying = !isPlaying;
  }
  updatePlayBtn();
  toast(isPlaying ? '▶ Playing' : '⏸ Paused', 'ok');
}

function updatePlayBtn() {
  var btn = $id('play-btn');
  var label = $id('play-label');
  if (btn) {
    btn.innerHTML = isPlaying
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><span id="play-label">Pause</span>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span id="play-label">Play</span>';
  }
}

function toggleMute() {
  isMuted = !isMuted;
  var video = document.querySelector('#hero-player video');
  if (video) video.muted = isMuted;
  var vol = $id('vol-slider');
  var btn = $id('mute-btn');
  if (vol) vol.value = isMuted ? 0 : 0.75;
  if (btn) {
    btn.innerHTML = isMuted
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  }
}

function toggleFullscreen() {
  var player = $id('hero-player');
  if (!player) return;
  if (!document.fullscreenElement) {
    player.requestFullscreen().catch(function() {});
  } else {
    document.exitFullscreen();
  }
}

function skipProgress(delta) {
  var fill = $id('hero-prog-fill');
  if (!fill) return;
  var cur = parseFloat(fill.style.width) || 0;
  fill.style.width = Math.max(0, Math.min(100, cur + delta)) + '%';
}

/* ── Favorite toggle ────────────────────────────────────── */
function toggleFav(id) {
  var ch = CHANNELS.find(function(c) { return c.id === id; });
  if (!ch) return;
  ch.fav = !ch.fav;
  renderList();
  toast(ch.fav ? '★ Added ' + ch.name + ' to favorites' : '☆ Removed from favorites', 'ok');
}

/* ── Clock ──────────────────────────────────────────────── */
function updateClock() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, '0');
  var m = String(now.getMinutes()).padStart(2, '0');
  var s = String(now.getSeconds()).padStart(2, '0');
  setCh($id('top-clock'), h + ':' + m + ':' + s);
}

/* ── Settings modal ─────────────────────────────────────── */
function openSettings() {
  var m = $id('settings-modal');
  if (m) m.classList.add('open');
}
function closeSettings() {
  var m = $id('settings-modal');
  if (m) m.classList.remove('open');
}

/* ── INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {

  // Load IPTV data then render
  loadIPTVData().then(function(channels) {
    if (channels && channels.length > 0) {
      renderCats();
      renderList();
      selectChannel(channels[0].id);
    } else {
      // Show error state
      var container = $id('rp-list');
      if (container) {
        container.innerHTML = '<div class="no-results"><div class="nr-icon">⚠️</div><p>Could not load channels</p><p style="font-size:11px;margin-top:8px;opacity:0.7;">Check your internet connection and refresh</p></div>';
      }
    }
  });

  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Play button
  $id('play-btn') && $id('play-btn').addEventListener('click', togglePlay);

  // Skip
  $id('skip-back-btn') && $id('skip-back-btn').addEventListener('click', function() { skipProgress(-5); });
  $id('skip-fwd-btn') && $id('skip-fwd-btn').addEventListener('click', function() { skipProgress(5); });

  // Mute
  $id('mute-btn') && $id('mute-btn').addEventListener('click', toggleMute);

  // Volume slider
  $id('vol-slider') && $id('vol-slider').addEventListener('input', function(e) {
    var video = document.querySelector('#hero-player video');
    if (video) video.volume = parseFloat(e.target.value);
  });

  // Fullscreen
  var fsBtn1 = $id('hero-fs-btn');
  var fsBtn2 = $id('hero-fs-btn2');
  if (fsBtn1) fsBtn1.addEventListener('click', toggleFullscreen);
  if (fsBtn2) fsBtn2.addEventListener('click', toggleFullscreen);

  // Progress bar click
  $id('hero-prog-track') && $id('hero-prog-track').addEventListener('click', function(e) {
    var rect = e.currentTarget.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width * 100;
    var fill = $id('hero-prog-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  });

  // Settings
  $id('btn-settings') && $id('btn-settings').addEventListener('click', openSettings);
  $id('nav-settings-btn') && $id('nav-settings-btn').addEventListener('click', openSettings);
  $id('modal-close') && $id('modal-close').addEventListener('click', closeSettings);
  $id('settings-modal') && $id('settings-modal').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Help
  $id('btn-help') && $id('btn-help').addEventListener('click', function() {
    toast('Space=Play  M=Mute  F=Fullscreen  /=Search  ←→=Skip', 'ok');
  });
  $id('footer-help-btn') && $id('footer-help-btn').addEventListener('click', function() {
    toast('Space=Play  M=Mute  F=Fullscreen  /=Search  ←→=Skip', 'ok');
  });

  // Share
  $id('btn-share') && $id('btn-share').addEventListener('click', function() {
    navigator.clipboard && navigator.clipboard.writeText(location.href).then(function() {
      toast('🔗 Link copied!', 'ok');
    });
  });

  // Search
  $id('search-input') && $id('search-input').addEventListener('input', function(e) {
    searchQ = e.target.value;
    renderList();
  });

  // See all
  $id('see-all-btn') && $id('see-all-btn').addEventListener('click', function() {
    activeCat = 'All'; searchQ = '';
    renderCats(); renderList();
    toast('Showing all channels', 'ok');
  });

  // Hero fav btn
  $id('hero-fav-btn') && $id('hero-fav-btn').addEventListener('click', function() {
    if (activeId) {
      var ch = CHANNELS.find(function(c) { return c.id === activeId; });
      if (ch) { ch.fav = !ch.fav; renderList(); toast(ch.fav ? '★ Added ' + ch.name : '☆ Removed', 'ok'); }
    }
  });

  // Sidebar nav icons (cosmetic)
  document.querySelectorAll('.nav-icon-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.nav-icon-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });

  // Modal pills
  document.querySelectorAll('.modal-section').forEach(function(sec) {
    sec.querySelectorAll('.modal-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        sec.querySelectorAll('.modal-pill').forEach(function(p) { p.classList.remove('active'); });
        pill.classList.add('active');
      });
    });
  });

  // Keyboard
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'm' || e.key === 'M') toggleMute();
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'ArrowRight') { e.preventDefault(); skipProgress(5); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); skipProgress(-5); }
    if (e.key === '/') { e.preventDefault(); $id('search-input') && $id('search-input').focus(); }
    if (e.key === 'Escape') closeSettings();
  });

  // Simulated viewer count fluctuation
  setInterval(function() {
    var ch = CHANNELS.find(function(c) { return c.id === activeId; });
    if (!ch) return;
    var base = parseFloat(ch.viewers) * 1000;
    if (isNaN(base)) return;
    var delta = Math.floor((Math.random() - 0.5) * 300);
    var val = Math.max(0, base + delta);
    var disp = val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val;
    var el = $id('hero-viewers');
    if (el) {
      el.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>\n      ' + disp;
    }
  }, 7000);

  console.log('%c FIFA E1 SportsTV — Powered by iptv-org/iptv ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:14px; border-radius:4px; padding:4px 10px;');
});
