/* ============================================================
   FIFA E1 SportsTV — Self-Contained Frontend (iptv-org + localStorage)
   ============================================================ */

// ── Config ────────────────────────────────────────────────
var IPTV_ORG = 'https://iptv-org.github.io/api';

// ── State ─────────────────────────────────────────────────
var CHANNELS = [];
var activeId = null;
var activeCat = 'All';
var searchQ = '';
var isPlaying = false;
var isMuted = false;
var HlsInstance = null;

// ── Helpers ───────────────────────────────────────────────
function $id(id) { return document.getElementById(id); }
function setCh(el, html) {
    if (!el) return;
    el.innerHTML = html;
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

// ── IPTV Fetch ────────────────────────────────────────────
function fetchJSON(url, timeout) {
    timeout = timeout || 20000;
    return new Promise(function(resolve, reject) {
        var ctrl = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); reject(new Error('timeout')); }, timeout);
        fetch(url, { signal: ctrl.signal })
            .then(function(res) {
                clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(resolve)
            .catch(function(err) { clearTimeout(timer); reject(err); });
    });
}

function loadChannelsFromIPTV() {
    var container = $id('rp-list');
    if (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="font-size:40px;animation:spin 1s linear infinite;">⏳</div><p style="font-weight:600;margin-top:12px;">Loading channels…</p><p style="font-size:11px;opacity:0.7;margin-top:6px;">Fetching from iptv-org</p></div>';
    }

    Promise.all([
        fetchJSON(IPTV_ORG + '/channels.json'),
        fetchJSON(IPTV_ORG + '/streams.json')
    ]).then(function(results) {
        var apiChannels = results[0];
        var apiStreams = results[1];

        var streamMap = {};
        (apiStreams || []).forEach(function(s) {
            if (s.channel && s.url) {
                if (!streamMap[s.channel]) streamMap[s.channel] = [];
                streamMap[s.channel].push(s);
            }
        });

        var targetCats = ['sports', 'news', 'entertainment', 'movies', 'music', 'documentary', 'business', 'lifestyle', 'family', 'general', 'kids', 'animation'];
        var catDisplay = { sports: 'Sports', news: 'News', entertainment: 'Entertainment', movies: 'Movies', music: 'Music', documentary: 'Entertainment', business: 'News', lifestyle: 'Entertainment', family: 'Entertainment', general: 'General', kids: 'Entertainment', animation: 'Entertainment' };
        var catEmoji = { sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬', music: '🎵', documentary: '🎥', business: '💼', lifestyle: '🌿', family: '👨‍👩‍👧‍👦', general: '📺', kids: '🧸', animation: '🎨' };
        var catColors = { sports: '#1a6b3c', news: '#cc0000', entertainment: '#6a1e8a', movies: '#1a3a5c', music: '#e040fb' };

        CHANNELS = [];
        var usedCats = {};

        for (var i = 0; i < apiChannels.length && CHANNELS.length < 200; i++) {
            var ch = apiChannels[i];
            if (!ch || !ch.id) continue;
            var streams = streamMap[ch.id];
            if (!streams || streams.length === 0) continue;

            var chCats = ch.categories || [];
            var matchedCat = null;
            for (var c = 0; c < chCats.length; c++) {
                var catId = (typeof chCats[c] === 'string' ? chCats[c] : (chCats[c].id || '')).toLowerCase();
                if (targetCats.indexOf(catId) !== -1) {
                    matchedCat = catId;
                    usedCats[catId] = true;
                    break;
                }
            }
            if (!matchedCat) matchedCat = 'general';

            var qualityOrder = { '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
            streams.sort(function(a, b) {
                var aGeo = (a.label || '').toLowerCase().includes('geo') ? 1 : 0;
                var bGeo = (b.label || '').toLowerCase().includes('geo') ? 1 : 0;
                if (aGeo !== bGeo) return aGeo - bGeo;
                return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
            });
            var best = streams[0];

            var now = new Date();
            var endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

            CHANNELS.push({
                id: ch.id,
                name: ch.name || ch.id,
                num: String(CHANNELS.length + 1).padStart(3, '0'),
                cat: [catDisplay[matchedCat] || matchedCat],
                quality: best.quality || 'HD',
                viewers: formatViewers(Math.floor(Math.random() * 50000) + 1000),
                live: true,
                fav: JSON.parse(localStorage.getItem('a1tv_favs') || '[]').indexOf(ch.id) !== -1,
                emoji: catEmoji[matchedCat] || '📺',
                color: catColors[matchedCat] || '#37474f',
                logo: ch.logo || null,
                country: ch.country || '',
                streamUrl: best.url || null,
                score: null,
                show: {
                    title: ch.name || 'Live Stream',
                    sub: (ch.country || '') + ' · ' + (catDisplay[matchedCat] || 'Live'),
                    desc: (ch.name || '') + ' — Live broadcast.',
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

        console.log('✓ Loaded ' + CHANNELS.length + ' channels from iptv-org');
        if (container) container.innerHTML = '';
        renderCats();
        renderList();
        if (CHANNELS.length > 0) selectChannel(CHANNELS[0].id);

    }).catch(function(err) {
        console.warn('iptv-org load failed:', err.message);
        if (container) {
            container.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="font-size:40px;">📡</div><p style="font-weight:600;margin-top:8px;">Connection Issue</p><p style="font-size:11px;opacity:0.8;margin-top:4px;">Could not reach iptv-org. Retrying in 10s…</p></div>';
        }
        setTimeout(loadChannelsFromIPTV, 10000);
    });
}

function toggleFav(id) {
    var favs = JSON.parse(localStorage.getItem('a1tv_favs') || '[]');
    var idx = favs.indexOf(id);
    if (idx === -1) favs.push(id);
    else favs.splice(idx, 1);
    localStorage.setItem('a1tv_favs', JSON.stringify(favs));

    var ch = CHANNELS.find(function(c) { return c.id === id; });
    if (ch) {
        ch.fav = idx === -1;
        renderList();
        toast(ch.fav ? '★ Added to favorites' : '☆ Removed from favorites', 'ok');
    }
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
        container.innerHTML = '<div style="text-align:center;padding:30px;opacity:0.6;">📡<br><small>No channels found</small></div>';
        return;
    }

    container.innerHTML = list.map(function(ch, i) {
        var logoHTML = ch.logo ? '<img src="' + ch.logo + '" style="width:28px;height:28px;object-fit:contain;" onerror="this.style.display=\'none\'" />' : ('<span style="font-size:19px;">' + ch.emoji + '</span>');
        return '<div class="ch-card ' + (ch.id === activeId ? 'active' : '') + '" data-id="' + ch.id + '" role="listitem" tabindex="0" aria-label="Watch ' + ch.name + '" style="animation-delay:' + (i * 0.02) + 's">' +
          '<div class="ch-logo"><div class="ch-logo-inner" style="background:' + ch.color + '22;">' + logoHTML + '</div></div>' +
          '<div class="ch-info"><div class="ch-name">' + ch.name + '</div><div class="ch-show">' + ch.show.title + '</div>' +
          '<div class="ch-prog-bar"><div class="ch-prog-fill" style="width:' + ch.show.prog + '%"></div></div></div>' +
          '<div class="ch-meta"><span class="ch-num">CH ' + ch.num + '</span>' + (ch.live ? '<div class="ch-live-dot" title="Live"></div>' : '') + '</div>' +
          '<button class="ch-fav-btn ' + (ch.fav ? 'fav' : '') + '" data-id="' + ch.id + '" title="' + (ch.fav ? 'Remove' : 'Favorite') + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" ' + (ch.fav ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"') + '><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button></div>';
    }).join('');

    container.querySelectorAll('.ch-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.ch-fav-btn')) return;
            selectChannel(card.dataset.id);
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

// ── Category tabs ─────────────────────────────────────────
function renderCats() {
    var el = $id('rp-cats');
    if (!el) return;
    el.innerHTML = CATS.map(function(c) {
        return '<button class="cat-pill ' + (c === activeCat ? 'active' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    el.querySelectorAll('.cat-pill').forEach(function(btn) {
        btn.addEventListener('click', function() {
            activeCat = btn.dataset.cat;
            renderCats();
            renderList();
        });
    });
}

// ── Video cards ───────────────────────────────────────────
function renderCards() {
    var container = $id('cards-row');
    if (!container) return;
    var cards = CHANNELS.filter(function(c) { return c.id !== activeId; }).slice(0, 4);
    container.innerHTML = cards.map(function(ch) {
        return '<div class="video-card" data-id="' + ch.id + '" tabindex="0" role="button" aria-label="Switch to ' + ch.name + '">' +
          '<div class="vc-bg" style="color:' + ch.color + ';">' + ch.emoji + '</div>' +
          '<div class="vc-top-badges">' + (ch.live ? '<span class="vc-live-badge">Live</span>' : '') + '<span class="vc-cat-badge">' + ch.cat[0] + '</span></div>' +
          '<div class="vc-overlay"><div class="vc-ch-name">' + ch.name + '</div><div class="vc-show-name">' + ch.show.title + '</div>' +
          '<div class="vc-prog-bar"><div class="vc-prog-fill" style="width:' + ch.show.prog + '%"></div></div></div>' +
          '<div class="vc-play-overlay"><div class="vc-play-circle"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div></div>';
    }).join('');
    container.querySelectorAll('.video-card').forEach(function(card) {
        card.addEventListener('click', function() { selectChannel(card.dataset.id); });
    });
}

// ── Schedule ──────────────────────────────────────────────
function renderSchedule(ch) {
    var bar = $id('schedule-bar');
    if (!bar) return;
    var items = [
        { time: ch.show.start, title: ch.show.title, current: true },
        { time: ch.show.end, title: ch.next.title, current: false },
    ];
    bar.innerHTML = items.map(function(s) {
        return '<div class="sch-item ' + (s.current ? 'sch-current' : '') + '">' +
          '<span class="sch-time">' + s.time + '</span><span class="sch-show">' + s.title + '</span>' +
          (s.current ? '<span class="sch-tag">Now Showing</span>' : '') + '</div>';
    }).join('');
}

// ── Select channel ───────────────────────────────────────
function selectChannel(id) {
    var ch = CHANNELS.find(function(c) { return c.id === id; });
    if (!ch) return;
    if (activeId === id) return;
    activeId = id;

    var artEl = $id('hero-art');
    if (artEl) artEl.textContent = ch.emoji;

    var glowEl = $id('hero-glow');
    if (glowEl) glowEl.style.background = 'radial-gradient(ellipse at center, ' + ch.color + '55 0%, ' + ch.color + '18 45%, transparent 75%)';

    var titleEl = $id('hero-title');
    if (titleEl) {
        titleEl.style.opacity = '0';
        titleEl.style.transform = 'translateY(8px)';
        setTimeout(function() {
            titleEl.textContent = ch.show.title;
            titleEl.style.transition = 'all 0.35s ease';
            titleEl.style.opacity = '1';
            titleEl.style.transform = 'translateY(0)';
        }, 80);
    }
    setCh($id('hero-subtitle'), ch.show.sub);
    setCh($id('hero-quality'), ch.quality);
    setCh($id('hero-viewers'), ch.viewers);

    var fill = $id('hero-prog-fill');
    if (fill) fill.style.width = ch.show.prog + '%';
    setCh($id('hero-time-start'), ch.show.start);
    setCh($id('hero-time-end'), ch.show.end);

    setCh($id('live-count'), CHANNELS.filter(function(c) { return c.live; }).length + ' LIVE');

    renderSchedule(ch);
    renderCards();
    renderList();

    // Load stream directly from iptv-org
    loadStreamDirect(ch);

    toast('📺 ' + ch.name, 'ok');
}

// ── HLS Player (direct iptv-org stream) ──────────────────
function loadStreamDirect(ch) {
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

    if (HlsInstance) {
        try { HlsInstance.destroy(); } catch(e) {}
        HlsInstance = null;
    }

    var url = ch.streamUrl;
    if (!url) {
        showStreamError('No stream URL available for this channel.');
        return;
    }

    // Try HLS.js
    if (window.Hls && Hls.isSupported() && url.indexOf('.m3u8') !== -1) {
        var hls = new Hls({ enableWorker: true, maxBufferLength: 30, startLevel: -1 });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
            video.play().then(function() { isPlaying = true; updatePlayBtn(); }).catch(function() {
                showStreamError('Tap play to start.');
            });
        });
        hls.on(Hls.Events.ERROR, function(_, data) {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    toast('🔄 Reconnecting…', 'ok');
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    showStreamError('Stream error. Try another channel.');
                }
            }
        });
        HlsInstance = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(function() { showStreamError('Tap play to start.'); });
    } else {
        video.src = url;
        video.play().catch(function() { toast('⚠️ Cannot play stream', 'err'); });
    }

    updatePlayBtn();
}

function showStreamError(msg) {
    var existing = document.getElementById('stream-error-overlay');
    if (existing) existing.remove();

    var player = $id('hero-player');
    if (!player) return;

    var overlay = document.createElement('div');
    overlay.id = 'stream-error-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(4,7,17,0.85);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#8292B0;font-family:sans-serif;text-align:center;padding:24px;gap:12px;border-radius:12px;';
    overlay.innerHTML = '<div style="font-size:48px;">⚠️</div><div style="font-size:14px;font-weight:700;color:#F8FAFC;">Playback Issue</div><div style="font-size:12px;max-width:260px;line-height:1.6;">' + msg + '</div>' +
      '<button id="retry-stream-btn" style="margin-top:8px;padding:8px 20px;border-radius:20px;background:#00F2FE;color:#040711;font-weight:800;font-size:12px;border:none;cursor:pointer;">Retry</button>';
    player.appendChild(overlay);

    document.getElementById('retry-stream-btn').addEventListener('click', function() {
        overlay.remove();
        var ch = CHANNELS.find(function(c) { return c.id === activeId; });
        if (ch) loadStreamDirect(ch);
    });
}

// ── Player controls ──────────────────────────────────────
function togglePlay() {
    var video = document.querySelector('#hero-player video');
    if (!video) return;
    if (video.paused) { video.play(); isPlaying = true; }
    else { video.pause(); isPlaying = false; }
    updatePlayBtn();
}

function updatePlayBtn() {
    var btn = $id('play-btn');
    if (!btn) return;
    btn.innerHTML = isPlaying
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><span id="play-label">Pause</span>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span id="play-label">Play</span>';
}

function toggleMute() {
    isMuted = !isMuted;
    var video = document.querySelector('#hero-player video');
    if (video) video.muted = isMuted;
    var vol = $id('vol-slider');
    if (vol) vol.value = isMuted ? 0 : 0.75;
    updateMuteBtn();
}

function updateMuteBtn() {
    var btn = $id('mute-btn');
    if (!btn) return;
    btn.innerHTML = isMuted
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
}

function toggleFullscreen() {
    var player = $id('hero-player');
    if (!player) return;
    if (!document.fullscreenElement) player.requestFullscreen().catch(function() {});
    else document.exitFullscreen();
}

function skipProgress(delta) {
    var fill = $id('hero-prog-fill');
    if (!fill) return;
    var cur = parseFloat(fill.style.width) || 0;
    fill.style.width = Math.max(0, Math.min(100, cur + delta)) + '%';
}

// ── Settings ──────────────────────────────────────────────
function openSettings() { $id('settings-modal') && $id('settings-modal').classList.add('open'); }
function closeSettings() { $id('settings-modal') && $id('settings-modal').classList.remove('open'); }

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    loadChannelsFromIPTV();

    setInterval(function() {
        var now = new Date();
        setCh($id('top-clock'), String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0'));
    }, 1000);

    $id('play-btn') && $id('play-btn').addEventListener('click', togglePlay);
    $id('skip-back-btn') && $id('skip-back-btn').addEventListener('click', function() { skipProgress(-5); });
    $id('skip-fwd-btn') && $id('skip-fwd-btn').addEventListener('click', function() { skipProgress(5); });
    $id('mute-btn') && $id('mute-btn').addEventListener('click', toggleMute);
    $id('vol-slider') && $id('vol-slider').addEventListener('input', function(e) {
        var v = document.querySelector('#hero-player video');
        if (v) v.volume = parseFloat(e.target.value);
    });
    $id('hero-fs-btn') && $id('hero-fs-btn').addEventListener('click', toggleFullscreen);
    $id('hero-fs-btn2') && $id('hero-fs-btn2').addEventListener('click', toggleFullscreen);
    $id('btn-settings') && $id('btn-settings').addEventListener('click', openSettings);
    $id('nav-settings-btn') && $id('nav-settings-btn').addEventListener('click', openSettings);
    $id('modal-close') && $id('modal-close').addEventListener('click', closeSettings);
    $id('settings-modal') && $id('settings-modal').addEventListener('click', function(e) {
        if (e.target === e.currentTarget) closeSettings();
    });

    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT') return;
        if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        if (e.key === 'm' || e.key === 'M') toggleMute();
        if (e.key === 'f' || e.key === 'F') toggleFullscreen();
        if (e.key === 'ArrowRight') { e.preventDefault(); skipProgress(5); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); skipProgress(-5); }
        if (e.key === '/') { e.preventDefault(); var s = $id('search-input'); if (s) s.focus(); }
        if (e.key === 'Escape') closeSettings();
    });

    // Search
    var searchInput = $id('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            searchQ = e.target.value;
            renderList();
        });
    }

    console.log('%c A1TV Standalone — Powered by iptv-org ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:14px; border-radius:4px; padding:4px 10px;');
});
