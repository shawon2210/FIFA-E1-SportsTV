/* ============================================================
   A1TV — Player Module
   ============================================================ */

var Player = (function() {
    var hls = null;
    var video = null;
    var state = { playing: false, muted: true, volume: 0.75 };

    function init() {
        ensureVideoElement();
        bindControls();
    }

    function ensureVideoElement() {
        var hero = document.getElementById('hero-player');
        if (!hero) return;
        video = hero.querySelector('video');
        if (!video) {
            video = document.createElement('video');
            video.id = 'hero-video';
            video.muted = true;
            video.volume = 0.75;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#040711;';
            hero.insertBefore(video, hero.firstChild);
        }
    }

    function bindControls() {
        var playBtn = document.getElementById('play-btn');
        var muteBtn = document.getElementById('mute-btn');
        var volSlider = document.getElementById('vol-slider');

        if (playBtn) {
            playBtn.addEventListener('click', function() {
                if (!video) return;
                if (video.paused || video.ended) {
                    video.play().then(function() {
                        state.playing = true;
                        updatePlayBtn();
                    }).catch(function() {
                        showStreamError('Tap play to start the stream.');
                    });
                } else {
                    video.pause();
                    state.playing = false;
                    updatePlayBtn();
                }
            });
        }

        if (muteBtn) {
            muteBtn.addEventListener('click', function() {
                state.muted = !state.muted;
                if (video) video.muted = state.muted;
                if (volSlider) volSlider.value = state.muted ? 0 : state.volume;
                updateMuteBtn();
            });
        }

        if (volSlider) {
            volSlider.addEventListener('input', function(e) {
                state.volume = parseFloat(e.target.value);
                state.muted = state.volume === 0;
                if (video) {
                    video.volume = state.volume;
                    video.muted = state.muted;
                }
                updateMuteBtn();
            });
        }
    }

    function loadStreamDirect(channel) {
        if (!video || !channel) return;
        destroyHls();

        var url = channel.streamUrl;
        if (!url) {
            showStreamError('No stream URL available for this channel.');
            return;
        }

        if (window.Hls && Hls.isSupported() && url.indexOf('.m3u8') !== -1) {
            hls = new Hls({ enableWorker: true, maxBufferLength: 30, startLevel: -1 });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                video.play().then(function() {
                    state.playing = true;
                    updatePlayBtn();
                }).catch(function() {
                    showStreamError('Autoplay blocked. Tap play to start.');
                });
            });
            hls.on(Hls.Events.ERROR, function(_, data) {
                if (!data.fatal) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    showToast('Reconnecting stream…', 'ok');
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    showStreamError('Stream error. Try another channel.');
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', function() {
                video.play().catch(function() {
                    showStreamError('Tap play to start.');
                });
            }, { once: true });
        } else {
            video.src = url;
            video.play().catch(function() {
                showToast('Cannot play this stream', 'err');
            });
        }
    }

    function destroyHls() {
        if (hls) {
            try { hls.destroy(); } catch (e) {}
            hls = null;
        }
    }

    function updatePlayBtn() {
        var btn = document.getElementById('play-btn');
        if (!btn) return;
        btn.innerHTML = state.playing
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><span id="play-label">Pause</span>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span id="play-label">Play</span>';
    }

    function updateMuteBtn() {
        var btn = document.getElementById('mute-btn');
        if (!btn) return;
        var pathMuted = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
        var pathUnmuted = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="' + (state.muted ? pathMuted : pathUnmuted) + '"/></svg>';
    }

    function showStreamError(msg) {
        var existing = document.getElementById('stream-error-overlay');
        if (existing) existing.remove();

        var hero = document.getElementById('hero-player');
        if (!hero) return;

        var overlay = document.createElement('div');
        overlay.id = 'stream-error-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(4,7,17,0.85);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#8292B0;font-family:sans-serif;text-align:center;padding:24px;gap:12px;border-radius:12px;';
        overlay.innerHTML = '<div style="font-size:48px;">⚠️</div><div style="font-size:14px;font-weight:700;color:#F8FAFC;">Playback Issue</div><div style="font-size:12px;max-width:260px;line-height:1.6;">' + msg + '</div>' +
          '<button id="retry-stream-btn" style="margin-top:8px;padding:8px 20px;border-radius:20px;background:#00F2FE;color:#040711;font-weight:800;font-size:12px;border:none;cursor:pointer;">Retry</button>';
        hero.appendChild(overlay);

        document.getElementById('retry-stream-btn').addEventListener('click', function() {
            overlay.remove();
            if (window.ActiveChannelId && Data.getChannelById) {
                var ch = Data.getChannelById(window.ActiveChannelId);
                if (ch) loadStreamDirect(ch);
            }
        });
    }

    function showToast(message, type) {
        type = type || 'ok';
        var wrap = document.getElementById('toast-wrap');
        if (!wrap) return;
        var t = document.createElement('div');
        t.className = 'toast ' + type;
        t.textContent = message;
        wrap.appendChild(t);
        setTimeout(function() {
            t.style.transition = 'all 0.25s ease';
            t.style.opacity = '0';
            t.style.transform = 'translateY(8px)';
            setTimeout(function() { t.remove(); }, 260);
        }, 2800);
    }

    return {
        init: init,
        loadStreamDirect: loadStreamDirect,
        showToast: showToast,
        destroyHls: destroyHls,
        getState: function() { return state; }
    };
})();
