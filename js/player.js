/* ============================================================
   FIFA E1 SportsTV — Player Module (with HLS.js)
   Supports real HLS/m3u8 stream playback
   Requires: https://cdn.jsdelivr.net/npm/hls.js@latest
   ============================================================ */

const Player = (() => {
  let state = {
    isPlaying: false,
    isMuted: false,
    volume: 0.75,
    isFullscreen: false,
    currentChannel: null,
    progress: 0,
    hls: null,
    video: null,
  };

  // DOM references
  let playBtn, muteBtn, fullscreenBtn, volumeSlider,
      progressFill, progressTrack, currentTimeEl;
  let controlsTimer;

  /* ── Initialize ────────────────────────────────────────── */
  function init() {
    // Create video element if not exists
    setupVideoElement();

    playBtn       = document.getElementById('player-play-btn') || document.getElementById('play-btn');
    muteBtn       = document.getElementById('player-mute-btn');
    fullscreenBtn = document.getElementById('player-fullscreen-btn') || document.getElementById('hero-fs-btn');
    volumeSlider  = document.getElementById('player-volume');
    progressFill  = document.getElementById('player-progress-fill') || document.getElementById('hero-prog-fill');
    progressTrack = document.getElementById('player-progress-track') || document.getElementById('hero-prog-track');
    currentTimeEl = document.getElementById('player-current-time') || document.getElementById('hero-time-start');

    if (playBtn)       playBtn.addEventListener('click', togglePlay);
    if (muteBtn)       muteBtn.addEventListener('click', toggleMute);
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
    if (volumeSlider)  volumeSlider.addEventListener('input', onVolumeChange);
    if (progressTrack) progressTrack.addEventListener('click', onProgressClick);

    const playerContainer = document.querySelector('.player-container') || document.querySelector('.hero-player');
    if (playerContainer) {
      playerContainer.addEventListener('mousemove', showControlsTemporarily);
      playerContainer.addEventListener('mouseleave', () => {
        if (state.isPlaying) {
          playerContainer.classList.remove('show-controls');
        }
      });
      playerContainer.addEventListener('click', (e) => {
        if (e.target.closest('.player-btn') || e.target.closest('.player-volume-group') || e.target.closest('.player-progress-track') || e.target.closest('.hero-controls')) {
          return;
        }
        togglePlay();
      });
      showControlsTemporarily();
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeyDown);

    // Start progress simulation for non-HLS channels
    startProgressSimulation();
  }

  /* ── Setup video element ───────────────────────────────── */
  function setupVideoElement() {
    const container = document.querySelector('.player-container') || document.querySelector('.hero-player');
    if (!container) return;

    // Check if video already exists
    let video = container.querySelector('video');
    if (video) {
      state.video = video;
      return;
    }

    // Create video element
    video = document.createElement('video');
    video.id = 'hls-video';
    video.playsInline = true;
    video.autoplay = false;
    video.muted = false;
    video.controls = false;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#040711;';

    // Insert as first child of container
    container.insertBefore(video, container.firstChild);
    state.video = video;
  }

  /* ── Load channel stream ───────────────────────────────── */
  function loadChannel(channel) {
    if (!channel) return;

    state.currentChannel = channel;
    state.progress = channel.currentShow?.progress || 0;

    const video = state.video;
    if (!video) {
      setupVideoElement();
      return loadChannel(channel);
    }

    // Destroy previous HLS instance
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }

    const streamUrl = channel.streamUrl;

    if (!streamUrl) {
      showToast('⚠️ No stream available for this channel', 'error');
      return;
    }

    // Try HLS.js first, then native playback
    if (Hls.isSupported() && streamUrl.includes('.m3u8')) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().then(() => {
          state.isPlaying = true;
          updatePlayBtn();
          showControlsTemporarily();
        }).catch(() => {
          // Autoplay blocked — user needs to click play
          state.isPlaying = false;
          updatePlayBtn();
        });
        showToast(`📺 Now playing: ${channel.name}`, 'success');
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              showToast('⚠️ Network error — retrying...', 'error');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              showToast('⚠️ Media error — recovering...', 'error');
              hls.recoverMediaError();
              break;
            default:
              showToast('⚠️ Stream error — try another channel', 'error');
              hls.destroy();
              break;
          }
        }
      });

      state.hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = streamUrl;
      video.play().then(() => {
        state.isPlaying = true;
        updatePlayBtn();
      }).catch(() => {
        state.isPlaying = false;
        updatePlayBtn();
      });
    } else {
      // Try direct playback (some mp4/webm streams)
      video.src = streamUrl;
      video.play().then(() => {
        state.isPlaying = true;
        updatePlayBtn();
      }).catch(() => {
        showToast('⚠️ Cannot play this stream format', 'error');
        state.isPlaying = false;
        updatePlayBtn();
      });
    }

    // Update UI
    updatePlayBtn();
    updateProgressUI();

    const playerContainer = document.querySelector('.player-container') || document.querySelector('.hero-player');
    if (playerContainer) {
      playerContainer.classList.remove('paused');
      showControlsTemporarily();
    }

    // Update time display
    if (currentTimeEl && channel.currentShow) {
      currentTimeEl.textContent = channel.currentShow.startTime;
    }
  }

  /* ── Controls ──────────────────────────────────────────── */

  function togglePlay() {
    const video = state.video;
    if (!video) return;

    if (video.paused) {
      video.play().then(() => {
        state.isPlaying = true;
      }).catch(() => {});
    } else {
      video.pause();
      state.isPlaying = false;
    }

    updatePlayBtn();

    const playerContainer = document.querySelector('.player-container') || document.querySelector('.hero-player');
    if (playerContainer) {
      if (state.isPlaying) {
        playerContainer.classList.remove('paused');
        showControlsTemporarily();
      } else {
        playerContainer.classList.add('paused');
        playerContainer.classList.add('show-controls');
        clearTimeout(controlsTimer);
      }
    }
  }

  function updatePlayBtn() {
    const btn = document.getElementById('player-play-btn') || document.getElementById('play-btn');
    if (!btn) return;

    const icon = state.isPlaying
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

    // Handle both icon-only and play-btn-hero (with label)
    const label = btn.querySelector('span') || btn.querySelector('#play-label');
    if (label) {
      btn.innerHTML = icon;
      const span = document.createElement('span');
      span.textContent = state.isPlaying ? 'Pause' : 'Play';
      btn.appendChild(span);
    } else {
      btn.innerHTML = icon;
    }

    // Update play label if exists
    const playLabel = document.getElementById('play-label');
    if (playLabel) playLabel.textContent = state.isPlaying ? 'Pause' : 'Play';
  }

  function toggleMute() {
    const video = state.video;
    if (video) {
      video.muted = !video.muted;
      state.isMuted = video.muted;
    } else {
      state.isMuted = !state.isMuted;
    }
    if (volumeSlider) {
      volumeSlider.value = state.isMuted ? 0 : state.volume;
    }
    updateMuteBtn();
  }

  function updateMuteBtn() {
    if (!muteBtn) return;
    const icon = state.isMuted
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    muteBtn.innerHTML = icon;
  }

  function onVolumeChange(e) {
    const val = parseFloat(e.target.value);
    state.volume = val;
    state.isMuted = val === 0;
    const video = state.video;
    if (video) {
      video.volume = val;
      video.muted = val === 0;
    }
    updateMuteBtn();
  }

  function toggleFullscreen() {
    const playerSection = document.getElementById('player-section') || document.querySelector('.hero-player');
    if (!playerSection) return;

    if (!document.fullscreenElement) {
      playerSection.requestFullscreen().catch(() => {});
      state.isFullscreen = true;
    } else {
      document.exitFullscreen();
      state.isFullscreen = false;
    }
    updateFullscreenBtn();
  }

  function updateFullscreenBtn() {
    if (!fullscreenBtn) return;
    fullscreenBtn.innerHTML = state.isFullscreen
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
  }

  function skipForward() {
    const video = state.video;
    if (video) {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    }
    state.progress = Math.min(100, state.progress + 5);
    updateProgressUI();
  }

  function skipBack() {
    const video = state.video;
    if (video) {
      video.currentTime = Math.max(0, video.currentTime - 10);
    }
    state.progress = Math.max(0, state.progress - 5);
    updateProgressUI();
  }

  function onProgressClick(e) {
    const video = state.video;
    const rect = progressTrack.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;

    if (video && video.duration) {
      video.currentTime = pct * video.duration;
    }
    state.progress = Math.max(0, Math.min(100, pct * 100));
    updateProgressUI();
  }

  function updateProgressUI() {
    if (progressFill) {
      progressFill.style.width = state.progress + '%';
    }
  }

  /* ── Keyboard shortcuts ────────────────────────────────── */
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'ArrowRight':
        e.preventDefault();
        skipForward();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        skipBack();
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustVolume(0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustVolume(-0.1);
        break;
    }
  }

  function adjustVolume(delta) {
    const video = state.video;
    if (video) {
      video.volume = Math.max(0, Math.min(1, video.volume + delta));
      state.volume = video.volume;
      if (volumeSlider) volumeSlider.value = video.volume;
    }
  }

  /* ── Controls visibility ───────────────────────────────── */
  function showControlsTemporarily() {
    const playerContainer = document.querySelector('.player-container') || document.querySelector('.hero-player');
    if (!playerContainer) return;

    playerContainer.classList.add('show-controls');
    clearTimeout(controlsTimer);

    if (state.isPlaying) {
      controlsTimer = setTimeout(() => {
        playerContainer.classList.remove('show-controls');
      }, 3000);
    }
  }

  /* ── Progress simulation (fallback) ────────────────────── */
  function startProgressSimulation() {
    setInterval(() => {
      if (!state.isPlaying) return;
      if (state.currentChannel && !state.hls && !state.video?.src) {
        // Only simulate if no real video is playing
        const ch = state.currentChannel;
        state.progress = ch.currentShow?.progress || 0;
      }
    }, 30000);
  }

  /* ── Toast notifications ───────────────────────────────── */
  function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  /* ── Cleanup ───────────────────────────────────────────── */
  function destroy() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    if (state.video) {
      state.video.pause();
      state.video.src = '';
      state.video = null;
    }
  }

  return {
    init,
    loadChannel,
    showToast,
    getState: () => state,
    destroy,
  };
})();
