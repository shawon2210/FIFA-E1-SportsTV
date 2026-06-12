/* ============================================================
   A1TV v2 — Frontend App (Production)
   Features: virtualized channel list, rich EPG, recommendations,
             user accounts, PWA support, WebSocket updates.
   
   API: /api/v1/
   WS:  /socket.io/
   ============================================================ */

// ── Config ────────────────────────────────────────────────
var API_BASE = window.location.port === '3000' ? '' : (window.location.origin.includes('localhost:8080') ? '' : '');
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
var authToken = localStorage.getItem('a1tv_token') || null;
var currentUser = JSON.parse(localStorage.getItem('a1tv_user') || 'null');
var recommendations = { personalized: [], trending: [], similar: [] };
var epgData = {};
var viewerCounts = {};

// ── Virtualized List State ────────────────────────────────
var listContainer = null;
var listItems = [];
var itemHeight = 68; // px per channel card
var listPadding = 10; // extra items above/below viewport
var scrollTop = 0;
var containerHeight = 0;

// ── Helpers ───────────────────────────────────────────────
function $id(id) { return document.getElementById(id); }
function setCh(el, html) { if (!el) return; if (!html) { el.textContent = ''; return; } var isText = html.indexOf('<') === -1; if (isText) el.textContent = html; else el.innerHTML = html; }

function toast(msg, type) {
    type = type || 'ok';
    var wrap = $id('toast-wrap');
    if (!wrap) return;
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function() { t.style.transition = 'all 0.25s ease'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(function() { t.remove(); }, 260); }, 2800);
}

function formatTime(date) { return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function formatViewers(num) { if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'; if (num >= 1000) return (num / 1000).toFixed(1) + 'K'; return String(num); }
function getOrCreateDeviceId() { var id = localStorage.getItem('a1tv_device_id'); if (!id) { id = 'dev_' + Math.random().toString(36).substring(2, 15); localStorage.setItem('a1tv_device_id', id); } return id; }
function getCategoryEmoji(slug) { var m = { sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬', music: '🎵', documentary: '🎥' }; return m[slug] || '📺'; }
function getColorForCategory(slug) { var c = { sports: '#1a6b3c', news: '#cc0000', entertainment: '#6a1e8a', movies: '#1a3a5c', music: '#e040fb' }; return c[slug] || '#37474f'; }

// ── API Client ────────────────────────────────────────────
function api(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    return fetch(API_BASE + '/api/v1' + path, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function(res) {
        if (res.status === 401) { authToken = null; localStorage.removeItem('a1tv_token'); }
        if (!res.ok) throw new Error('API ' + res.status);
        return res.json();
    });
}

// ── Auth ──────────────────────────────────────────────────
function login(email, password) {
    return api('/auth/login', { method: 'POST', body: { email: email, password: password } })
        .then(function(res) {
            if (res.success) {
                authToken = res.data.tokens.accessToken;
                currentUser = res.data.user;
                localStorage.setItem('a1tv_token', authToken);
                localStorage.setItem('a1tv_user', JSON.stringify(currentUser));
                updateAuthUI();
            }
            return res;
        });
}

function register(email, username, password) {
    return api('/auth/register', { method: 'POST', body: { email: email, username: username, password: password } })
        .then(function(res) {
            if (res.success) {
                authToken = res.data.tokens.accessToken;
                currentUser = res.data.user;
                localStorage.setItem('a1tv_token', authToken);
                localStorage.setItem('a1tv_user', JSON.stringify(currentUser));
                updateAuthUI();
            }
            return res;
        });
}

function logout() {
    api('/auth/logout', { method: 'POST' }).catch(function() {});
    authToken = null; currentUser = null;
    localStorage.removeItem('a1tv_token');
    localStorage.removeItem('a1tv_user');
    updateAuthUI();
}

function updateAuthUI() {
    var avatar = $id('user-avatar');
    var loginBtn = $id('login-btn');
    if (currentUser) {
        if (avatar) { avatar.style.display = 'flex'; avatar.textContent = (currentUser.display_name || '?')[0].toUpperCase(); }
        if (loginBtn) { loginBtn.textContent = 'Logout'; loginBtn.onclick = logout; }
    } else {
        if (avatar) avatar.style.display = 'none';
        if (loginBtn) { loginBtn.textContent = 'Login'; loginBtn.onclick = function() { $id('auth-modal').classList.add('open'); }; }
    }
}

// ── Load channels from API ───────────────────────────────
function loadChannels() {
    var container = $id('rp-list');
    if (container) container.innerHTML = '<div class="no-results"><div style="font-size:48px;margin-bottom:16px;">📡</div><p>Loading live channels...</p><p style="font-size:11px;margin-top:8px;opacity:0.7;">Fetching from A1TV API</p></div>';

    return api('/channels?limit=500&sort=popular')
        .then(function(res) {
            if (res.success && res.data) {
                CHANNELS = res.data.map(function(ch) {
                    return {
                        id: ch.id, name: ch.name, num: ch.id.substring(0, 6),
                        cat: ch.category_name ? [ch.category_name] : ['General'],
                        quality: ch.best_stream?.quality || 'HD',
                        viewers: formatViewers(ch.view_count || Math.floor(Math.random() * 50000)),
                        live: ch.online_streams > 0, fav: false,
                        emoji: getCategoryEmoji(ch.category_slug),
                        color: getColorForCategory(ch.category_slug),
                        logo: ch.logo_url || null,
                        country: ch.country_name || '',
                        countryFlag: ch.country_flag || '',
                        streamUrl: ch.best_stream?.url || null,
                        score: ch.best_stream?.score || 0,
                        show: { title: ch.current_program?.title || ch.name, sub: (ch.country_name || '') + ' · ' + (ch.category_name || 'Live'), desc: ch.current_program?.description || '', start: ch.current_program?.start_time ? formatTime(ch.current_program.start_time) : formatTime(new Date()), end: ch.current_program?.end_time ? formatTime(ch.current_program.end_time) : formatTime(new Date(Date.now() + 2 * 60 * 60 * 1000)), prog: 45 },
                        next: { title: ch.next_program?.title || 'Up Next', start: ch.next_program?.start_time ? formatTime(ch.next_program.start_time) : '', end: ch.next_program?.end_time ? formatTime(ch.next_program.end_time) : '' },
                    };
                });
                loadFavorites();
                loadRecommendations();
                return CHANNELS;
            }
            return [];
        })
        .catch(function(err) {
            console.warn('API load failed:', err.message);
            if (container) container.innerHTML = '<div class="no-results"><div class="nr-icon">⚠️</div><p>Could not load channels</p><p style="font-size:11px;margin-top:8px;opacity:0.7;">Check your connection and refresh</p></div>';
            return [];
        });
}

function loadFavorites() {
    if (!authToken) return;
    api('/users/' + currentUser.id + '/favorites').then(function(res) {
        if (res.success) {
            var favIds = new Set(res.data.map(function(f) { return f.id; }));
            CHANNELS.forEach(function(ch) { ch.fav = favIds.has(ch.id); });
            renderVirtualList();
        }
    }).catch(function() {});
}

// ── Recommendations ──────────────────────────────────────
function loadRecommendations() {
    Promise.all([
        api('/recommendations/personalized'),
        api('/recommendations/trending?period=24h'),
    ]).then(function(results) {
        if (results[0].success) recommendations.personalized = results[0].data;
        if (results[1].success) recommendations.trending = results[1].data;
        renderRecommendations();
    }).catch(function() {});
}

function loadSimilarRecommendations(channelId) {
    api('/recommendations/similar/' + channelId).then(function(res) {
        if (res.success) {
            recommendations.similar = (res.data.direct || []).concat(res.data.sameCategory || []);
            renderRecommendations();
        }
    }).catch(function() {});
}

function renderRecommendations() {
    var container = $id('rec-section');
    if (!container) return;

    var html = '';
    if (recommendations.personalized.length > 0) {
        html += '<div class="rec-block"><div class="rec-title">Recommended For You</div><div class="rec-row">' + recommendations.personalized.slice(0, 6).map(function(ch) {
            return '<div class="rec-card" data-id="' + ch.id + '"><div class="rec-logo" style="background:' + getColorForCategory(ch.category_slug || '') + '22;">' + (ch.logo_url ? '<img src="' + ch.logo_url + '" onerror="this.style.display=\'none\'">' : '<span>' + getCategoryEmoji(ch.category_slug) + '</span>') + '</div><div class="rec-name">' + ch.name + '</div></div>';
        }).join('') + '</div></div>';
    }
    if (recommendations.trending.most_watched && recommendations.trending.most_watched.length > 0) {
        html += '<div class="rec-block"><div class="rec-title">Trending Now</div><div class="rec-row">' + recommendations.trending.most_watched.slice(0, 6).map(function(ch) {
            return '<div class="rec-card" data-id="' + ch.id + '"><div class="rec-logo" style="background:' + getColorForCategory(ch.category_slug || '') + '22;">' + (ch.logo_url ? '<img src="' + ch.logo_url + '" onerror="this.style.display=\'none\'">' : '<span>' + getCategoryEmoji(ch.category_slug) + '</span>') + '</div><div class="rec-name">' + ch.name + '</div><div class="rec-views">' + formatViewers(ch.views || 0) + ' views</div></div>';
        }).join('') + '</div></div>';
    }
    if (recommendations.similar.length > 0) {
        html += '<div class="rec-block"><div class="rec-title">Similar Channels</div><div class="rec-row">' + recommendations.similar.slice(0, 6).map(function(ch) {
            return '<div class="rec-card" data-id="' + ch.id + '"><div class="rec-logo" style="background:' + getColorForCategory(ch.category_slug || '') + '22;">' + (ch.logo_url ? '<img src="' + ch.logo_url + '" onerror="this.style.display=\'none\'">' : '<span>' + getCategoryEmoji(ch.category_slug) + '</span>') + '</div><div class="rec-name">' + ch.name + '</div></div>';
        }).join('') + '</div></div>';
    }

    container.innerHTML = html;
    container.querySelectorAll('.rec-card').forEach(function(card) {
        card.addEventListener('click', function() { selectChannel(card.dataset.id); });
    });
}

// ── EPG ──────────────────────────────────────────────────
function loadEPG(channelId) {
    api('/epg/' + channelId).then(function(res) {
        if (res.success) {
            epgData[channelId] = res.data;
            if (channelId === activeId) renderEPG(res.data);
        }
    }).catch(function() {});
}

function renderEPG(data) {
    var container = $id('epg-section');
    if (!container) return;

    var html = '';
    if (data.current) {
        var prog = data.current;
        var remaining = Math.max(0, Math.round((new Date(prog.end_time) - new Date()) / 60000));
        html += '<div class="epg-now"><div class="epg-label">NOW PLAYING</div><div class="epg-title">' + prog.title + '</div><div class="epg-time">' + formatTime(prog.start_time) + ' – ' + formatTime(prog.end_time) + ' (' + remaining + ' min left)</div>' + (prog.description ? '<div class="epg-desc">' + prog.description + '</div>' : '') + '</div>';
    }
    if (data.next && data.next.length > 0) {
        html += '<div class="epg-next"><div class="epg-label">NEXT</div>' + data.next.slice(0, 3).map(function(p) {
            return '<div class="epg-item"><span class="epg-time">' + formatTime(p.start_time) + '</span><span class="epg-title">' + p.title + '</span></div>';
        }).join('') + '</div>';
    }
    if (data.later && data.later.length > 0) {
        html += '<div class="epg-later"><div class="epg-label">LATER</div>' + data.later.slice(0, 5).map(function(p) {
            return '<div class="epg-item"><span class="epg-time">' + formatTime(p.start_time) + '</span><span class="epg-title">' + p.title + '</span></div>';
        }).join('') + '</div>';
    }

    container.innerHTML = html;
}

// ── Virtualized Channel List ─────────────────────────────
function getFiltered() {
    var list = CHANNELS;
    if (activeCat === 'Favorites') list = list.filter(function(c) { return c.fav; });
    else if (activeCat === 'Live') list = list.filter(function(c) { return c.live; });
    else if (activeCat !== 'All') list = list.filter(function(c) { return c.cat.indexOf(activeCat) !== -1; });
    if (searchQ.trim()) {
        var q = searchQ.toLowerCase();
        list = list.filter(function(c) {
            return (c.name || '').toLowerCase().indexOf(q) !== -1 ||
                   (c.show?.title || '').toLowerCase().indexOf(q) !== -1 ||
                   (c.country || '').toLowerCase().indexOf(q) !== -1;
        });
    }
    return list;
}

function renderVirtualList() {
    listContainer = $id('rp-list');
    if (!listContainer) return;

    listItems = getFiltered();
    containerHeight = listContainer.clientHeight || window.innerHeight - 200;

    if (!listItems.length) {
        listContainer.innerHTML = '<div class="no-results"><div class="nr-icon">📡</div>No channels found.<br><small style="font-size:11px;font-weight:400;">Try a different search or category.</small></div>';
        return;
    }

    // Set up scrollable container
    var totalHeight = listItems.length * itemHeight;
    listContainer.innerHTML = '<div style="position:relative;height:' + totalHeight + 'px;"></div>';
    var scrollContent = listContainer.firstElementChild;

    // Initial render
    renderVisibleItems(scrollContent, 0);

    // Scroll handler
    listContainer.onscroll = function() {
        scrollTop = listContainer.scrollTop;
        renderVisibleItems(scrollContent, scrollTop);
    };

    var countEl = $id('rp-count');
    if (countEl) countEl.textContent = listItems.length + ' CH';
}

function renderVisibleItems(scrollContent, scrollTop) {
    var startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - listPadding);
    var endIdx = Math.min(listItems.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + listPadding);

    var html = '';
    for (var i = startIdx; i <= endIdx; i++) {
        var ch = listItems[i];
        var top = i * itemHeight;
        var isActive = ch.id === activeId;

        var logoHTML = '📺';
        if (ch.logo && ch.logo.indexOf('http') === 0) {
            logoHTML = '<img src="' + ch.logo + '" alt="' + ch.name + '" style="width:28px;height:28px;object-fit:contain;border-radius:4px;" onerror="this.style.display=\'none\';this.nextElement.style.display=\'flex\'"><span style="font-size:19px;display:none;">' + ch.emoji + '</span>';
        } else {
            logoHTML = '<span style="font-size:19px;">' + ch.emoji + '</span>';
        }

        html += '<div class="ch-card ' + (isActive ? 'active' : '') + '" data-id="' + ch.id + '" style="position:absolute;top:' + 'top' + 'px;left:0;right:0;height:' + itemHeight + 'px;" role="listitem" tabindex="0">' +
            '<div class="ch-logo"><div class="ch-logo-inner" style="background:' + ch.color + '22;">' + logoHTML + '</div></div>' +
            '<div class="ch-info"><div class="ch-name">' + ch.name + '</div><div class="ch-show">' + (ch.show?.title || ch.name) + '</div><div class="ch-prog-bar"><div class="ch-prog-fill" style="width:' + (ch.show?.prog || 0) + '%"></div></div></div>' +
            '<div class="ch-meta"><span class="ch-num">CH ' + ch.num + '</span>' + (ch.live ? '<div class="ch-live-dot" title="Live"></div>' : '') + '</div>' +
            '<button class="ch-fav-btn ' + (ch.fav ? 'fav' : '') + '" data-id="' + ch.id + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" ' + (ch.fav ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"') + '><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>' +
            '</div>';
    }

    scrollContent.innerHTML = html;

    // Bind events
    scrollContent.querySelectorAll('.ch-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.ch-fav-btn')) return;
            selectChannel(card.dataset.id);
        });
    });
    scrollContent.querySelectorAll('.ch-fav-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) { e.stopPropagation(); toggleFav(btn.dataset.id); });
    });
}

// ── Category Tabs ─────────────────────────────────────────
function renderCats() {
    var el = $id('rp-cats');
    if (!el) return;
    el.innerHTML = CATS.map(function(c) {
        return '<button class="cat-pill ' + (c === activeCat ? 'active' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    el.querySelectorAll('.cat-pill').forEach(function(btn) {
        btn.addEventListener('click', function() { activeCat = btn.dataset.cat; renderCats(); renderVirtualList(); });
    });
}

// ── Select Channel ───────────────────────────────────────
function selectChannel(id) {
    var ch = CHANNELS.find(function(c) { return c.id === id; });
    if (!ch) return;
    activeId = id;

    var artEl = $id('hero-art'); if (artEl) artEl.textContent = ch.emoji;
    var glowEl = $id('hero-glow'); if (glowEl) glowEl.style.background = 'radial-gradient(ellipse at center, ' + ch.color + '55 0%, ' + ch.color + '18 45%, transparent 75%)';

    var titleEl = $id('hero-title');
    if (titleEl) { titleEl.style.opacity = '0'; titleEl.style.transform = 'translateY(8px)'; setTimeout(function() { titleEl.textContent = ch.show?.title || ch.name; titleEl.style.transition = 'all 0.3s ease'; titleEl.style.opacity = '1'; titleEl.style.transform = 'translateY(0)'; }, 100); }
    setCh($id('hero-subtitle'), ch.show?.sub || (ch.country + ' · ' + ch.cat[0]));

    var badgesEl = $id('hero-badges');
    if (badgesEl) { var liveEl = badgesEl.querySelector('.badge-live'); if (liveEl) liveEl.style.display = ch.live ? 'flex' : 'none'; }
    setCh($id('hero-quality'), ch.quality);
    var viewersEl = $id('hero-viewers');
    if (viewersEl) viewersEl.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>\n    ' + ch.viewers;

    var fill = $id('hero-prog-fill'); if (fill) fill.style.width = (ch.show?.prog || 0) + '%';
    setCh($id('hero-time-start'), ch.show?.start || ''); setCh($id('hero-time-end'), ch.show?.end || '');

    var liveCount = CHANNELS.filter(function(c) { return c.live; }).length;
    setCh($id('live-count'), liveCount + ' LIVE');

    renderSchedule(ch);
    renderVirtualList();
    loadEPG(ch.id);
    loadSimilarRecommendations(ch.id);
    loadStreamFromAPI(ch);

    // Record watch history
    api('/users/history', { method: 'POST', body: { channel_id: ch.id, quality: ch.quality } }).catch(function() {});

    toast('📺 ' + ch.name, 'ok');
}

function renderSchedule(ch) {
    var bar = $id('schedule-bar'); if (!bar) return;
    var items = [
        { time: 'Previous', title: 'Previous Program', current: false },
        { time: ch.show?.start || '', title: ch.show?.title || ch.name, current: true },
        { time: ch.next?.start || '', title: ch.next?.title || 'TBA', current: false },
    ];
    bar.innerHTML = items.map(function(s) {
        return '<div class="sch-item ' + (s.current ? 'sch-current' : '') + '"><span class="sch-time">' + s.time + '</span><span class="sch-show">' + s.title + '</span>' + (s.current ? '<span class="sch-tag">Now Showing</span>' : '') + '</div>';
    }).join('');
}

// ── Stream Playback ──────────────────────────────────────
function loadStreamFromAPI(ch) {
    api('/channels/' + ch.id + '/stream')
        .then(function(res) {
            if (res.success && res.data && res.data.streamUrl) {
                playStream(res.data.streamUrl, res.data.quality);
            } else {
                toast('⚠️ No stream available', 'err');
            }
        })
        .catch(function(err) {
            console.warn('Stream API error:', err.message);
            // Fallback to direct URL
            if (ch.streamUrl) playStream(ch.streamUrl, ch.quality);
            else toast('⚠️ Could not load stream', 'err');
        });
}

function playStream(streamUrl, quality) {
    var player = $id('hero-player'); if (!player) return;
    var video = player.querySelector('video');
    if (!video) {
        video = document.createElement('video');
        video.id = 'hls-video'; video.playsInline = true; video.autoplay = true; video.muted = isMuted;
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#040711;';
        player.insertBefore(video, player.firstChild);
    }
    if (HlsInstance) { HlsInstance.destroy(); HlsInstance = null; }

    if (Hls && Hls.isSupported() && streamUrl.indexOf('.m3u8') !== -1) {
        var hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90, maxBufferLength: 30 });
        hls.loadSource(streamUrl); hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().then(function() { isPlaying = true; updatePlayBtn(); }).catch(function() { isPlaying = false; }); });
        hls.on(Hls.Events.ERROR, function(event, data) {
            if (data.fatal) {
                api('/analytics/event', { method: 'POST', body: { channel_id: activeId, event_type: 'error', event_data: { error: data.type }, device_id: deviceId } }).catch(function() {});
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            }
        });
        HlsInstance = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl; video.play().then(function() { isPlaying = true; }).catch(function() { isPlaying = false; });
    } else {
        video.src = streamUrl; video.play().then(function() { isPlaying = true; }).catch(function() { toast('⚠️ Cannot play this stream', 'err'); isPlaying = false; });
    }
    updatePlayBtn();
}

// ── Player Controls ──────────────────────────────────────
function togglePlay() { var v = document.querySelector('#hero-player video'); if (v) { if (v.paused) { v.play(); isPlaying = true; } else { v.pause(); isPlaying = false; } } else { isPlaying = !isPlaying; } updatePlayBtn(); toast(isPlaying ? '▶ Playing' : '⏸ Paused', 'ok'); }
function updatePlayBtn() { var b = $id('play-btn'); var l = $id('play-label'); if (b) b.innerHTML = isPlaying ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><span id="play-label">Pause</span>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span id="play-label">Play</span>'; }
function toggleMute() { isMuted = !isMuted; var v = document.querySelector('#hero-player video'); if (v) v.muted = isMuted; var vol = $id('vol-slider'); var btn = $id('mute-btn'); if (vol) vol.value = isMuted ? 0 : 0.75; if (btn) btn.innerHTML = isMuted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>'; }
function toggleFullscreen() { var p = $id('hero-player'); if (!p) return; if (!document.fullscreenElement) p.requestFullscreen().catch(function() {}); else document.exitFullscreen(); }
function skipProgress(delta) { var f = $id('hero-prog-fill'); if (!f) return; var c = parseFloat(f.style.width) || 0; f.style.width = Math.max(0, Math.min(100, c + delta)) + '%'; }

// ── Favorite Toggle ──────────────────────────────────────
function toggleFav(id) {
    api('/channels/' + id + '/favorite', { method: 'POST', body: { device_id: deviceId } })
        .then(function(res) {
            var ch = CHANNELS.find(function(c) { return c.id === id; });
            if (ch) { ch.fav = res.data.favorited; renderVirtualList(); toast(ch.fav ? '★ Added ' + ch.name : '☆ Removed', 'ok'); }
        })
        .catch(function() { var ch = CHANNELS.find(function(c) { return c.id === id; }); if (ch) { ch.fav = !ch.fav; renderVirtualList(); } });
}

// ── Clock ────────────────────────────────────────────────
function updateClock() { var now = new Date(); setCh($id('top-clock'), String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0')); }

// ── Settings Modal ───────────────────────────────────────
function openSettings() { var m = $id('settings-modal'); if (m) m.classList.add('open'); }
function closeSettings() { var m = $id('settings-modal'); if (m) m.classList.remove('open'); }

// ── PWA Service Worker Registration ──────────────────────
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(function(reg) {
            console.log('PWA: Service worker registered', reg.scope);
        }).catch(function(err) {
            console.log('PWA: Service worker registration failed:', err);
        });
    }
}

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    loadChannels().then(function(channels) {
        if (channels && channels.length > 0) {
            renderCats();
            renderVirtualList();
            selectChannel(channels[0].id);
        }
    });

    updateAuthUI();
    updateClock();
    setInterval(updateClock, 1000);
    registerServiceWorker();

    // Controls
    $id('play-btn') && $id('play-btn').addEventListener('click', togglePlay);
    $id('skip-back-btn') && $id('skip-back-btn').addEventListener('click', function() { skipProgress(-5); });
    $id('skip-fwd-btn') && $id('skip-fwd-btn').addEventListener('click', function() { skipProgress(5); });
    $id('mute-btn') && $id('mute-btn').addEventListener('click', toggleMute);
    $id('vol-slider') && $id('vol-slider').addEventListener('input', function(e) { var v = document.querySelector('#hero-player video'); if (v) v.volume = parseFloat(e.target.value); });
    var fs1 = $id('hero-fs-btn'), fs2 = $id('hero-fs-btn2');
    if (fs1) fs1.addEventListener('click', toggleFullscreen);
    if (fs2) fs2.addEventListener('click', toggleFullscreen);
    $id('hero-prog-track') && $id('hero-prog-track').addEventListener('click', function(e) { var r = e.currentTarget.getBoundingClientRect(); var p = (e.clientX - r.left) / r.width * 100; var f = $id('hero-prog-fill'); if (f) f.style.width = Math.max(0, Math.min(100, p)) + '%'; });

    // Settings
    $id('btn-settings') && $id('btn-settings').addEventListener('click', openSettings);
    $id('nav-settings-btn') && $id('nav-settings-btn').addEventListener('click', openSettings);
    $id('modal-close') && $id('modal-close').addEventListener('click', closeSettings);
    $id('settings-modal') && $id('settings-modal').addEventListener('click', function(e) { if (e.target === e.currentTarget) closeSettings(); });

    // Help
    $id('btn-help') && $id('btn-help').addEventListener('click', function() { toast('Space=Play  M=Mute  F=Fullscreen  /=Search  ←→=Skip', 'ok'); });
    $id('footer-help-btn') && $id('footer-help-btn').addEventListener('click', function() { toast('Space=Play  M=Mute  F=Fullscreen  /=Search  ←→=Skip', 'ok'); });

    // Share
    $id('btn-share') && $id('btn-share').addEventListener('click', function() { navigator.clipboard && navigator.clipboard.writeText(location.href).then(function() { toast('🔗 Link copied!', 'ok'); }); });

    // Search
    $id('search-input') && $id('search-input').addEventListener('input', function(e) { searchQ = e.target.value; renderVirtualList(); });

    // See all
    $id('see-all-btn') && $id('see-all-btn').addEventListener('click', function() { activeCat = 'All'; searchQ = ''; renderCats(); renderVirtualList(); toast('Showing all channels', 'ok'); });

    // Hero fav
    $id('hero-fav-btn') && $id('hero-fav-btn').addEventListener('click', function() { if (activeId) toggleFav(activeId); });

    // Sidebar nav
    document.querySelectorAll('.nav-icon-btn').forEach(function(btn) { btn.addEventListener('click', function() { document.querySelectorAll('.nav-icon-btn').forEach(function(b) { b.classList.remove('active'); }); btn.classList.add('active'); }); });

    // Modal pills
    document.querySelectorAll('.modal-section').forEach(function(sec) { sec.querySelectorAll('.modal-pill').forEach(function(pill) { pill.addEventListener('click', function() { sec.querySelectorAll('.modal-pill').forEach(function(p) { p.classList.remove('active'); }); pill.classList.add('active'); }); }); });

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
        var base = parseFloat(ch.viewers) * 1000; if (isNaN(base)) return;
        var delta = Math.floor((Math.random() - 0.5) * 300);
        var val = Math.max(0, base + delta);
        var el = $id('hero-viewers');
        if (el) el.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>\n      ' + (val >= 1000 ? (val/1000).toFixed(1)+'K' : val);
    }, 7000);

    console.log('%c A1TV v2.0 — Content Intelligence Layer ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:14px; border-radius:4px; padding:4px 10px;');
});
