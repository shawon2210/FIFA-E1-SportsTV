/* ============================================================
   FIFA E1 SportsTV — Player Module (HLS.js)
   ============================================================ */

const Player = (() => {
  let state = {
    isPlaying: false,
    isMuted: false,
    volume: 0.75,
    isFullscreen: false,
    currentChannel: null,
    progress: 0,
    hls: null
  };

  let videoEl = null;
  let playBtn, muteBtn, volumeSlider, progressFill, progressTrack;
  let controlsTimer;
  let errorShown = false;
  let skipShown = false;

  function init() {
    setupVideoElement();
    bindControls();
    setupKeyboard();
    startProgressSimulation();
  }

  function setupVideoElement() {
    const hero = document.getElementById('hero-player');
    if (!hero) return;

    videoEl = document.createElement('video');
    videoEl.id = 'hero-video';
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');
    videoEl.style.cssText = `
      position:absolute; inset:0; width:100%; height:100%;
      object-fit:cover; z-index:0; background:#000;
    `;
    videoEl.muted = true;
    videoEl.volume = 0.75;
    hero.insertBefore(videoEl, hero.firstChild);
  }

  function bindControls() {
    playBtn       = document.getElementById('play-btn');
    muteBtn       = document.getElementById('mute-btn');
    volumeSlider  = document.getElementById('vol-slider');
    progressFill  = document.getElementById('hero-prog-fill');
    progressTrack = document.getElementById('hero-prog-track');

    if (playBtn)       playBtn.addEventListener('click', togglePlay);
    if (muteBtn)       muteBtn.addEventListener('click',toggleMute);
    if (volumeSlider)  volumeSlider.addEventListener('input', onVolumeChange);
    if (progressTrack) progressTrack.addEventListener('click', onProgressClick);

    const hero = document.getElementById('hero-player');
    if (hero) {
      hero.addEventListener('mousemove', showControlsTemporarily);
      hero.addEventListener('mouseleave', () => {
        if (state.isPlaying) hero.classList.remove('show-controls');
      });
      hero.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.hero-prog-track')) return;
        togglePlay();
      });
      showControlsTemporarily();
    }
  }

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':  e.preventDefault(); togglePlay(); break;
        case 'KeyM':   toggleMute(); break;
        case 'KeyF':   toggleFullscreen(); break;
        case 'ArrowRight': e.preventDefault(); skipForward(); break;
        case 'ArrowLeft':  e.preventDefault(); skipBack(); break;
      }
    });
  }

  function loadChannel(channel) {
    if (!videoEl) return;

    state.currentChannel = channel;
    state.progress = channel.currentShow?.progress || 0;
    state.isPlaying = true;
    errorShown = false;
    skipShown = false;
    updatePlayBtn();
    updateProgressUI();

    const url = channel.streamUrl;
    if (!url) {
      videoEl.removeAttribute('src');
      videoEl.load();
      if (state.hls) { state.hls.destroy(); state.hls = null; }
      videoEl.style.display = 'none';
      return;
    }

    videoEl.style.display = 'block';

    if (window.Hls && Hls.isSupported()) {
      if (state.hls) state.hls.destroy();
      state.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60
      });
      state.hls.loadSource(url);
      state.hls.attachMedia(videoEl);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
      state.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal && !errorShown) {
          errorShown = true;
          const ch = getChannelById(channel.id);
          const chName = ch ? ch.name : channel.id;
          showToast(`Stream unavailable: ${chName}`, 'error');
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = url;
      videoEl.addEventListener('loadedmetadata', () => {
        videoEl.play().catch(() => {});
      }, { once: true });
    } else {
      videoEl.src = url;
    }

    videoEl.muted = state.isMuted;
    videoEl.volume = state.isMuted ? 0 : state.volume;
  }

  function togglePlay() {
    if (!videoEl || videoEl.style.display === 'none') return;

    if (videoEl.paused) {
      videoEl.play().then(() => {
        state.isPlaying = true;
        updatePlayBtn();
        showControlsTemporarily();
      }).catch(() => {});
    } else {
      videoEl.pause();
      state.isPlaying = false;
      updatePlayBtn();
      const hero = document.getElementById('hero-player');
      if (hero) hero.classList.add('show-controls');
    }
  }

  function updatePlayBtn() {
    if (!playBtn) return;
    const icon = state.isPlaying
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><span id="play-label">Pause</span>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span id="play-label">Play</span>`;
    playBtn.innerHTML = icon;
  }

  function toggleMute() {
    state.isMuted = !state.isMuted;
    if (videoEl) {
      videoEl.muted = state.isMuted;
    }
    if (volumeSlider) {
      volumeSlider.value = state.isMuted ? 0 : state.volume;
    }
    updateMuteBtn();
  }

  function updateMuteBtn() {
    if (!muteBtn) return;
    muteBtn.innerHTML = state.isMuted
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
  }

  function onVolumeChange(e) {
    state.volume = parseFloat(e.target.value);
    state.isMuted = state.volume === 0;
    if (videoEl) {
      videoEl.volume = state.volume;
      videoEl.muted  = state.isMuted;
    }
    updateMuteBtn();
  }

  function toggleFullscreen() {
    const player = document.getElementById('hero-player');
    if (!player) return;
    if (!document.fullscreenElement) {
      player.requestFullscreen().catch(() => {});
      state.isFullscreen = true;
    } else {
      document.exitFullscreen();
      state.isFullscreen = false;
    }
  }

  function skipForward() {
    state.progress = Math.min(100, state.progress + 5);
    updateProgressUI();
    if (!skipShown) {
      skipShown = true;
      showToast('⏭ +5%', 'ok');
      setTimeout(() => { skipShown = false; }, 1200);
    }
  }
  function skipBack() {
    state.progress = Math.max(0, state.progress - 5);
    updateProgressUI();
    if (!skipShown) {
      skipShown = true;
      showToast('⏪ -5%', 'ok');
      setTimeout(() => { skipShown = false; }, 1200);
    }
  }

  function onProgressClick(e) {
    const rect = progressTrack.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    state.progress = Math.max(0, Math.min(100, pct * 100));
    updateProgressUI();
  }

  function updateProgressUI() {
    if (progressFill) {
      progressFill.style.width = state.progress + '%';
    }
  }

  function startProgressSimulation() {
    setInterval(() => {
      if (!state.isPlaying || !state.currentChannel) return;
      const ch = state.currentChannel;
      state.progress = (ch.currentShow?.progress || 0);
      updateProgressUI();
    }, 30000);
  }

  function showControlsTemporarily() {
    const hero = document.getElementById('hero-player');
    if (!hero) return;
    hero.classList.add('show-controls');
    clearTimeout(controlsTimer);
    if (state.isPlaying) {
      controlsTimer = setTimeout(() => {
        hero.classList.remove('show-controls');
      }, 3000);
    }
  }

  function showToast(message, type = 'ok') {
    const container = document.getElementById('toast-wrap');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function destroy() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
  }

  return {
    init, loadChannel, showToast,
    getState: () => state,
    destroy,
    togglePlay,
    toggleFullscreen
  };
})();
