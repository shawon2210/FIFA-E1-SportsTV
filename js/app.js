/* ============================================================
   FIFA E1 SportsTV — Frontend App (Version 2)
   Consumes A1TV Backend API instead of iptv-org directly.
   
   API Endpoints:
     GET  /api/channels              — List channels (filtered, paginated)
     GET  /api/channels/featured     — Featured channels
     GET  /api/channels/:id          — Single channel with EPG
     GET  /api/channels/:id/stream   — Best stream URL (auto-failover)
     POST /api/channels/:id/favorite — Toggle favorite
     GET  /api/search?q=             — Search channels
     GET  /api/categories            — All categories
     GET  /api/countries             — All countries
     GET  /api/epg/:channelId        — EPG for channel
     POST /api/analytics/event       — Track play events
     POST /api/analytics/view        — Track channel views
   ============================================================ */

// ── Config ────────────────────────────────────────────────
var API_BASE = window.location.port === '3000' ? '' : (window.location.origin.includes('localhost:8080') ? '' : '');
// When served through Nginx, API is at /api/
// When standalone, API is at localhost:3000/api/
if (!API_BASE && window.location.port !== '3000') {
    API_BASE = window.location.protocol + '//' + window.location.hostname + ':3000';
}

// ── State ─────────────────────────────────────────────────
var CATS = ['All', 'Live', 'Sports', 'News', 'Movies', 'Entertainment', 'Music', 'Favorites'];
var CHANNELS = [];
var activeId = null;
var activeCat = 'All';
var searchQ = '';
var isPlaying = false;
var isMuted = false;
var HlsInstance = null;
var deviceId = getOrCreateDeviceId();

// ── Helpers ───────────────────────────────────────────────
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

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatViewers(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}

function getOrCreateDeviceId() {
    var id = localStorage.getItem('a1tv_device_id');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('a1tv_device_id', id);
    }
    return id;
}

// ── API Client ────────────────────────────────────────────
function api(path, options) {
    options = options || {};
    return fetch(API_BASE + '/api' + path, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function(res) {
        if (!res.ok) throw new Error('API ' + res.status);
        return res.json();
    });
}

// ── Load channels from API ───────────────────────────────
function loadChannels() {
    var container = $id('rp-list');
    if (container) {
        container.innerHTML = '<div class="no-results"><div style="font-size:40px;margin-bottom:12px;animation:spin 1s linear infinite;">⏳</div><p style="font-weight:600;">Loading channels…</p><p style="font-size:11px;margin-top:6px;opacity:0.8;">Connecting to A1TV API</p></div>';
    }

    // Show loading skeleton in hero
    var heroTitle = $id('hero-title');
    if (heroTitle) heroTitle.textContent = 'Loading…';

    return api('/channels?limit=100&sort=popular')
        .then(function(res) {
            if (res.success && res.data) {
                CHANNELS = res.data.map(function(ch) {
                    return {
                        id: ch.id,
                        name: ch.name,
                        num: ch.id.substring(0, 6),
                        cat: ch.category_name ? [ch.category_name] : ['General'],
                        quality: ch.best_stream?.quality || 'HD',
                        viewers: formatViewers(ch.view_count || Math.floor(Math.random() * 50000)),
                        live: ch.online_streams_count > 0,
                        fav: false,
                        emoji: getCategoryEmoji(ch.category_slug),
                        color: getColorForCategory(ch.category_slug),
                        logo: ch.logo_url || null,
                        country: ch.country_name || '',
                        countryFlag: ch.country_flag || '',
                        streamUrl: ch.best_stream?.url || null,
                        score: ch.best_stream?.score || 0,
                        show: {
                            title: ch.current_program?.title || ch.name,
                            sub: (ch.country_name || '') + ' · ' + (ch.category_name || 'Live'),
                            desc: ch.current_program?.description || '',
                            start: ch.current_program?.start_time ? formatTime(new Date(ch.current_program.start_time)) : formatTime(new Date()),
                            end: ch.current_program?.end_time ? formatTime(new Date(ch.current_program.end_time)) : formatTime(new Date(Date.now() + 2 * 60 * 60 * 1000)),
                            prog: 45,
                        },
                        next: {
                            title: ch.next_program?.title || 'Up Next',
                            start: ch.next_program?.start_time ? formatTime(new Date(ch.next_program.start_time)) : '',
                            end: ch.next_program?.end_time ? formatTime(new Date(ch.next_program.end_time)) : '',
                        },
                    };
                });

                loadFavorites();
                console.log('✓ Loaded ' + CHANNELS.length + ' channels from API');
                return CHANNELS;
            }
            return [];
        })
        .catch(function(err) {
            console.warn('API load failed:', err.message);
            if (container) {
                container.innerHTML = '<div class="no-results" style="text-align:center;"><div class="nr-icon" style="font-size:40px;">📡</div><p style="font-weight:600;">Connection Issue</p><p style="font-size:11px;margin-top:6px;opacity:0.8;">Could not reach A1TV API. Showing offline mode.</p><button onclick="window.__retryLoad()" style="margin-top:14px;padding:8px 20px;border-radius:24px;background:var(--color-cyan,#00F2FE);color:#040711;font-weight:800;font-size:12px;border:none;cursor:pointer;font-family:var(--font-primary,sans-serif);box-shadow:0 0 20px rgba(0,242,254,0.3);">Retry</button></div>';
            }
            return [];
        });
}

function loadFavorites() {
    // For each channel, check if favorited (simplified — in production, batch this)
    CHANNELS.forEach(function(ch) {
        api('/channels/' + ch.id + '/favorites?device_id=' + deviceId)
            .then(function(res) {
                if (res.data && res.data.favorited) {
                    ch.fav = true;
                    renderList();
                }
            })
            .catch(function() {});
    });
}

function getCategoryEmoji(slug) {
    var map = { sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬', music: '🎵', documentary: '🎥' };
    return map[slug] || '📺';
}

function getColorForCategory(slug) {
    var colors = { sports: '#1a6b3c', news: '#cc0000', entertainment: '#6a1e8a', movies: '#1a3a5c', music: '#e040fb' };
    return colors[slug] || '#37474f';
}

// ── Filtering ─────────────────────────────────────────────
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
                   (c.country || '').toLowerCase().indexOf(q) !== -1;
        });
    }
    return list;
}

// ── Render channel list ──────────────────────────────────
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

        return '<div class="ch-card ' + (ch.id === activeId ? 'active' : '') + '"\n             data-id="' + ch.id + '" role="listitem" tabindex="0"\n             aria-label="Watch ' + ch.name + '" aria-selected="' + (ch.id === activeId) + '"\n             style="animation-delay:' + (i * 0.02) + 's">\n          <div class="ch-logo">\n            <div class="ch-logo-inner" style="background:' + ch.color + '22;">\n              ' + logoHTML + '\n            </div>\n          </div>\n          <div class="ch-info">\n            <div class="ch-name">' + ch.name + '</div>\n            <div class="ch-show">' + ch.show.title + '</div>\n            <div class="ch-prog-bar">\n              <div class="ch-prog-fill" style="width:' + ch.show.prog + '%"></div>\n            </div>\n          </div>\n          <div class="ch-meta">\n            <span class="ch-num">CH ' + ch.num + '</span>\n            ' + (ch.live ? '<div class="ch-live-dot" title="Live"></div>' : '') + '\n          </div>\n          <button class="ch-fav-btn ' + (ch.fav ? 'fav' : '') + '"\n                  data-id="' + ch.id + '"\n                  title="' + (ch.fav ? 'Remove favorite' : 'Add to favorites') + '"\n                  aria-label="' + (ch.fav ? 'Remove from favorites' : 'Add to favorites') + '">\n            <svg width="12" height="12" viewBox="0 0 24 24" ' + (ch.fav ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"') + '>\n              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>\n            </svg>\n          </button>\n        </div>';
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

    var countEl = $id('rp-count');
    if (countEl) countEl.textContent = list.length + ' CH';
}

// ── Render category tabs ─────────────────────────────────
function renderCats() {
    var el = $id('rp-cats');
    if (!el) return;
    el.innerHTML = CATS.map(function(c) {
        return '<button class="cat-pill ' + (c === activeCat ? 'active' : '') + '"\n                data-cat="' + c + '" role="tab" aria-selected="' + (c === activeCat) + '">' + c + '</button>';
    }).join('');
    el.querySelectorAll('.cat-pill').forEach(function(btn) {
        btn.addEventListener('click', function() {
            activeCat = btn.dataset.cat;
            renderCats();
            renderList();
        });
    });
}

// ── Render video cards ───────────────────────────────────
function renderCards() {
    var container = $id('cards-row');
    if (!container) return;
    var cards = CHANNELS.filter(function(c) { return c.id !== activeId; }).slice(0, 4);
    container.innerHTML = cards.map(function(ch) {
        return '<div class="video-card ' + (ch.id === activeId ? 'active-card' : '') + '"\n             data-id="' + ch.id + '" tabindex="0" role="button" aria-label="Switch to ' + ch.name + '">\n          <div class="vc-bg" style="color:' + ch.color + ';">' + ch.emoji + '</div>\n          <div class="vc-top-badges">\n            ' + (ch.live ? '<span class="vc-live-badge">Live</span>' : '') + '\n            <span class="vc-cat-badge">' + ch.cat[0] + '</span>\n          </div>\n          <div class="vc-overlay">\n            <div class="vc-ch-name">' + ch.name + '</div>\n            <div class="vc-show-name">' + ch.show.title + '</div>\n            <div class="vc-prog-bar">\n              <div class="vc-prog-fill" style="width:' + ch.show.prog + '%"></div>\n            </div>\n          </div>\n          <div class="vc-play-overlay">\n            <div class="vc-play-circle">\n              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>\n            </div>\n          </div>\n        </div>';
    }).join('');

    container.querySelectorAll('.video-card').forEach(function(card) {
        card.addEventListener('click', function() { selectChannel(card.dataset.id); });
        card.addEventListener('keydown', function(e) { if (e.key === 'Enter') selectChannel(card.dataset.id); });
    });
}

// ── Render schedule ──────────────────────────────────────
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
        return '<div class="sch-item ' + (s.current ? 'sch-current' : '') + '">\n          <span class="sch-time">' + s.time + '</span>\n          <span class="sch-show">' + s.title + '</span>\n          ' + (s.current ? '<span class="sch-tag">Now Showing</span>' : '') + '\n        </div>';
    }).join('');
}

// ── Select channel ───────────────────────────────────────
function selectChannel(id) {
    var ch = CHANNELS.find(function(c) { return c.id === id; });
    if (!ch) return;

    if (activeId === id) {
        return; // No change needed
    }

    var prevActive = activeId;
    activeId = id;

    // Update loading state
    var player = $id('hero-player');
    if (player) player.classList.add('switching');

    // Update hero
    var artEl = $id('hero-art');
    if (artEl) {
        artEl.style.opacity = '0';
        artEl.style.transform = 'scale(0.8)';
        setTimeout(function() {
            artEl.textContent = ch.emoji;
            artEl.style.transition = 'all 0.3s cubic-bezier(0.19, 1, 0.22, 1)';
            artEl.style.opacity = '1';
            artEl.style.transform = 'scale(1)';
        }, 80);
    }
    var glowEl = $id('hero-glow');
    if (glowEl) glowEl.style.background = 'radial-gradient(ellipse at center, ' + ch.color + '55 0%, ' + ch.color + '18 45%, transparent 75%)';

    // Title + subtitle (smooth transition)
    var titleEl = $id('hero-title');
    if (titleEl) {
        titleEl.style.opacity = '0';
        titleEl.style.transform = 'translateY(6px)';
        setTimeout(function() {
            titleEl.textContent = ch.show.title;
            titleEl.style.transition = 'all 0.35s cubic-bezier(0.19, 1, 0.22, 1)';
            titleEl.style.opacity = '1';
            titleEl.style.transform = 'translateY(0)';
        }, 60);
    }
    setCh($id('hero-subtitle'), ch.show.sub);

    // Badges
    var badgesEl = $id('hero-badges');
    if (badgesEl) {
        badgesEl.style.opacity = '0';
        setTimeout(function() {
            var liveEl = badgesEl.querySelector('.badge-live');
            if (liveEl) liveEl.style.display = ch.live ? 'flex' : 'none';
            badgesEl.style.transition = 'opacity 0.25s ease';
            badgesEl.style.opacity = '1';
        }, 100);
    }
    setCh($id('hero-quality'), ch.quality);
    var viewersEl = $id('hero-viewers');
    if (viewersEl) {
        viewersEl.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34-3-3-3-3-3z"/></svg>\n    ' + ch.viewers;
    }

    // Score
    var scoreEl = $id('hero-score');
    if (ch.score && scoreEl) {
        scoreEl.style.display = 'flex';
        scoreEl.style.opacity = '0';
        setTimeout(function() {
            scoreEl.style.transition = 'opacity 0.3s ease';
            scoreEl.style.opacity = '1';
        }, 150);
        setCh($id('score-team1'), ch.score_t1 || '');
        setCh($id('score-team2'), ch.score_t2 || '');
        setCh($id('score-num'), ch.score_s || '');
    } else if (scoreEl) {
        scoreEl.style.display = 'none';
    }

    // Progress with smooth animation
    var fill = $id('hero-prog-fill');
    if (fill) {
        fill.style.transition = 'width 0.5s cubic-bezier(0.19, 1, 0.22, 1)';
        fill.style.width = ch.show.prog + '%';
    }
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

    // ── Load real stream from API ────────────────────────
    loadStreamFromAPI(ch);

    // Track view
    api('/analytics/view', {
        method: 'POST',
        body: { channel_id: ch.id, device_id: deviceId },
    }).catch(function() {});

    // Remove switching state
    if (player) {
        setTimeout(function() { player.classList.remove('switching'); }, 400);
    }

    toast('📺 ' + ch.name, 'ok');
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
        setCh($id('score-team1'), ch.score_t1 || '');
        setCh($id('score-team2'), ch.score_t2 || '');
        setCh($id('score-num'), ch.score_s || '');
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

    // ── Load real stream from API ────────────────────────
    loadStreamFromAPI(ch);

    // Track view
    api('/analytics/view', {
        method: 'POST',
        body: { channel_id: ch.id, device_id: deviceId },
    }).catch(function() {});

    toast('📺 ' + ch.name, 'ok');
}

// ── Load stream from API (with auto-failover) ────────────
function loadStreamFromAPI(ch) {
    api('/channels/' + ch.id + '/stream')
        .then(function(res) {
            if (res.success && res.data && res.data.streamUrl) {
                playStream(res.data.streamUrl, res.data.quality);
            } else {
                toast('⚠️ No stream available for ' + ch.name, 'err');
            }
        })
        .catch(function(err) {
            console.warn('Stream API error:', err.message);
            toast('⚠️ Could not load stream', 'err');
        });
}

// ── Play HLS stream ──────────────────────────────────────
function playStream(streamUrl, quality) {
    var player = $id('hero-player');
    if (!player) return;

    var video = player.querySelector('video');
    if (!video) {
        video = document.createElement('video');
        video.id = 'hls-video';
        video.playsInline = true;
        video.autoplay = true;
        video.muted = isMuted;
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#040711;border-radius:inherit;';
        player.insertBefore(video, player.firstChild);
    }

    // Destroy previous HLS
    if (HlsInstance) {
        try { HlsInstance.destroy(); } catch(e) {}
        HlsInstance = null;
    }

    if (Hls && Hls.isSupported() && streamUrl.indexOf('.m3u8') !== -1) {
        var hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            startLevel: -1, // auto quality
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
                showStreamError('Autoplay blocked. Tap play to start.');
            });
        });
        hls.on(Hls.Events.ERROR, function(event, data) {
            if (data.fatal) {
                console.warn('HLS fatal error:', data.type, data.details);
                // Try to recover
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    toast('🔄 Reconnecting stream…', 'ok');
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    toast('🔧 Fixing playback…', 'ok');
                    hls.recoverMediaError();
                } else {
                    showStreamError('Stream unavailable. Try another channel.');
                }
            }
        });
        HlsInstance = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.play().then(function() { isPlaying = true; }).catch(function() {
            isPlaying = false;
            showStreamError('Tap play to start stream.');
        });
    } else {
        video.src = streamUrl;
        video.play().then(function() { isPlaying = true; }).catch(function() {
            toast('⚠️ Cannot play this stream', 'err');
            isPlaying = false;
        });
    }

    updatePlayBtn();
}

function showStreamError(msg) {
    // Remove any existing overlay
    var existing = document.getElementById('stream-error-overlay');
    if (existing) existing.remove();

    var player = $id('hero-player');
    if (!player) return;

    var overlay = document.createElement('div');
    overlay.id = 'stream-error-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(4,7,17,0.85);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:var(--color-warm-gray,#8292B0);font-family:var(--font-secondary,sans-serif);text-align:center;padding:24px;gap:12px;border-radius:inherit;';
    overlay.innerHTML = '<div style="font-size:48px;opacity:0.8;">⚠️</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--color-off-white,#F8FAFC);">Playback Issue</div>' +
        '<div style="font-size:12px;max-width:260px;line-height:1.6;">' + msg + '</div>' +
        '<button id="retry-stream-btn" style="margin-top:8px;padding:8px 20px;border-radius:20px;background:var(--color-cyan,#00F2FE);color:#040711;font-weight:800;font-size:12px;border:none;cursor:pointer;font-family:var(--font-primary,sans-serif);letter-spacing:0.02em;">Retry</button>';

    player.appendChild(overlay);

    // Bind retry button
    var retryBtn = document.getElementById('retry-stream-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', function() {
            overlay.remove();
            var ch = CHANNELS.find(function(c) { return c.id === activeId; });
            if (ch) loadStreamFromAPI(ch);
        });
    }
}

// ── Player controls ──────────────────────────────────────
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

// ── Favorite toggle (API-backed) ─────────────────────────
function toggleFav(id) {
    api('/channels/' + id + '/favorite', {
        method: 'POST',
        body: { device_id: deviceId },
    }).then(function(res) {
        var ch = CHANNELS.find(function(c) { return c.id === id; });
        if (ch) {
            ch.fav = res.data.favorited;
            renderList();
            toast(ch.fav ? '★ Added ' + ch.name + ' to favorites' : '☆ Removed from favorites', 'ok');
        }
    }).catch(function() {
        // Fallback: toggle locally
        var ch = CHANNELS.find(function(c) { return c.id === id; });
        if (ch) {
            ch.fav = !ch.fav;
            renderList();
        }
    });
}

// ── Clock ────────────────────────────────────────────────
function updateClock() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    setCh($id('top-clock'), h + ':' + m + ':' + s);
}

// ── Settings modal ───────────────────────────────────────
function openSettings() {
    var m = $id('settings-modal');
    if (m) m.classList.add('open');
}
function closeSettings() {
    var m = $id('settings-modal');
    if (m) m.classList.remove('open');
}

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

    // Load channels from API, then render
    loadChannels().then(function(channels) {
        if (channels && channels.length > 0) {
            renderCats();
            renderList();
            selectChannel(channels[0].id);
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

    // Volume
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
        if (activeId) toggleFav(activeId);
    });

    // Sidebar nav icons
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

    // Simulated viewer count
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

    console.log('%c FIFA E1 SportsTV v2.0 — Powered by A1TV API ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:14px; border-radius:4px; padding:4px 10px;');
});
