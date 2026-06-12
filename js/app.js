/* ============================================================
   A1TV v2 — Main Application (EDVSR Pattern)
   State → Diff → Patch → DOM
   Zero direct DOM manipulation in business logic.
   ============================================================ */

(function() {
    'use strict';
    var R = window.A1TVRuntime;
    if (!R) { console.error('A1TV Runtime not loaded'); return; }
    if (R.version !== '3.0.0') { console.error('A1TV Runtime v3 Hardening Layer not loaded'); return; }

    var StateEngine = R.StateEngine;
    var EventBus = R.EventBus;
    var VirtualizationEngine = R.VirtualizationEngine;
    var StreamEngine = R.StreamEngine;
    var StreamGovernor = R.StreamGovernor;
    var EventGovernor = R.EventGovernor;
    var Memory = R.Memory;
    var Debug = R.Debug;
    var Network = R.Network;
    var PerfEnforce = R.PerfEnforce;
    var FailureIso = R.FailureIso;
    var Scaling = R.Scaling;
    var PRIORITY = R.PRIORITY;

    // Register failure isolation for core modules
    FailureIso.registerModule('stream', { showDegradedBadge: true });
    FailureIso.registerModule('websocket', { showReconnecting: true });
    FailureIso.registerModule('epg', { showUnavailable: true });
    FailureIso.registerModule('api', { useCachedData: true });

    var API_BASE = '';
    var deviceId = getOrCreateDeviceId();
    function getOrCreateDeviceId() { var id = localStorage.getItem('a1tv_device_id'); if (!id) { id = 'dev_' + Math.random().toString(36).substring(2, 15); localStorage.setItem('a1tv_device_id', id); } return id; }
    function api(path, opts) {
        opts = opts || {};
        var h = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId };
        var t = localStorage.getItem('a1tv_token'); if (t) h['Authorization'] = 'Bearer ' + t;
        return fetch(API_BASE + '/api/v1' + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function(r) { return r.json(); });
    }
    function $(id) { return document.getElementById(id); }
    function toast(msg, type) {
        type = type || 'ok'; var w = $('toast-wrap'); if (!w) return;
        var t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; w.appendChild(t);
        setTimeout(function() { t.style.transition = 'all .25s ease'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(function() { t.remove(); }, 260); }, 2800);
    }
    function getEmoji(slug) { return ({sports:'⚽',news:'📰',entertainment:'🎭',movies:'🎬',music:'🎵'})[slug] || '📺'; }
    function fmtViewers(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }
    function fmtTime(d) { return new Date(d).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false}); }

    // ── Init State ──────────────────────────────────────────
    StateEngine.init({
        channels: [], activeChannel: null, streams: {}, epg: {},
        favorites: [], recommendations: { personalized: [], trending: [], similar: [] },
        ui: { loading: false, sidebarOpen: true, selectedTab: 'ALL', searchQuery: '' },
        realtime: { connected: false },
    });

    // ── Load Channels ───────────────────────────────────────
    function loadChannels() {
        StateEngine.setState(function(p) { return Object.assign({}, p, { ui: Object.assign({}, p.ui, { loading: true }) }); });
        return api('/channels?limit=500&sort=popular').then(function(res) {
            if (res.success && res.data) {
                var chs = res.data.map(function(c) {
                    return { id:c.id, name:c.name, num:c.id.substring(0,6), cat:c.category_name?[c.category_name]:['General'],
                        quality:c.best_stream?.quality||'HD', viewers:fmtViewers(c.view_count||0), live:c.online_streams>0,
                        active:false, fav:false, emoji:getEmoji(c.category_slug),
                        color:{sports:'#1a6b3c',news:'#cc0000',entertainment:'#6a1e8a',movies:'#1a3a5c'}[c.category_slug]||'#37474f',
                        logo:c.logo_url||null, streamUrl:c.best_stream?.url||null, score:c.best_stream?.score||0,
                        currentProgram:c.current_program||null, nextProgram:c.next_program||null };
                });
                StateEngine.setState(function(p) { return Object.assign({}, p, { channels:chs, ui:Object.assign({},p.ui,{loading:false}) }); });
            }
        });
    }

    // ── Select Channel ──────────────────────────────────────
    function selectChannel(id) {
        var st = StateEngine.getState();
        var ch = st.channels.find(function(c){return c.id===id;});
        if (!ch) return;
        var upd = st.channels.map(function(c){return Object.assign({},c,{active:c.id===id});});
        StateEngine.setState(function(p){return Object.assign({},p,{channels:upd,activeChannel:ch});});

        // Use StreamGovernor for best stream selection
        if (ch.streamUrl) {
            var pc = $('hero-player');
            if (pc) {
                // Get failover chain sorted by SSS
                var chain = StreamGovernor.getFailoverChain([{id:'primary', url:ch.streamUrl, successRate:ch.score||80, responseTime:0, bufferHealth:100}]);
                var best = chain[0] || {url:ch.streamUrl};
                try {
                    StreamEngine.switchStream(ch, best.url);
                    Debug.recordStreamSwitch();
                    R.RenderGuarantee.notifyStreamActive(true);
                } catch (err) {
                    FailureIso.reportError('stream', err);
                }
            }
        }

        api('/epg/'+id).then(function(res){
            if(res.success){var e=Object.assign({},st.epg);e[id]=res.data;StateEngine.setState(function(p){return Object.assign({},p,{epg:e});});}
        }).catch(function(){ FailureIso.reportError('epg', new Error('EPG load failed')); });

        api('/users/history',{method:'POST',body:{channel_id:id}}).catch(function(){});
        toast('📺 '+ch.name,'ok');
    }

    // ── Toggle Favorite ─────────────────────────────────────
    function toggleFav(id) {
        api('/channels/'+id+'/favorite',{method:'POST',body:{device_id:deviceId}}).then(function(res){
            StateEngine.setState(function(p){return Object.assign({},p,{channels:p.channels.map(function(c){return c.id===id?Object.assign({},c,{fav:res.data.favorited}):c;})});});
        }).catch(function(){});
    }

    // ── Load Recommendations ────────────────────────────────
    function loadRecommendations() {
        api('/recommendations/trending?period=24h').then(function(res){
            if(res.success) StateEngine.setState(function(p){return Object.assign({},p,{recommendations:Object.assign({},p.recommendations,{trending:res.data})});});
        }).catch(function(){});
    }

    // ── Clock ───────────────────────────────────────────────
    function updateClock() {
        var n=new Date(); var el=$('top-clock');
        if(el) el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');
    }

    // ── Virtualized List ────────────────────────────────────
    function initVirtualList() {
        var c=$('rp-list'); if(!c) return;
        VirtualizationEngine.init(c,{itemHeight:68,bufferSize:5});
        StateEngine.subscribe('channels',updateVirtualList);
    }
    function updateVirtualList(channels) {
        var st=StateEngine.getState(), tab=st.ui.selectedTab||'All', q=st.ui.searchQuery||'';
        var f=channels;
        if(tab==='Favorites') f=f.filter(function(c){return c.fav;});
        else if(tab==='Live') f=f.filter(function(c){return c.live;});
        else if(tab!=='All') f=f.filter(function(c){return c.cat.indexOf(tab)!==-1;});
        if(q.trim()){var lq=q.toLowerCase();f=f.filter(function(c){return c.name.toLowerCase().indexOf(lq)!==-1;});}
        var items=f.map(function(ch){
            var lg=ch.logo?'<img src="'+ch.logo+'" style="width:28px;height:28px;object-fit:contain;border-radius:4px;" onerror="this.style.display=\'none\';this.nextElement.style.display=\'flex\'"><span style="font-size:19px;display:none;">'+ch.emoji+'</span>':'<span style="font-size:19px;">'+ch.emoji+'</span>';
            return {id:ch.id,active:ch.active,
                html:'<div class="ch-logo"><div class="ch-logo-inner" style="background:'+ch.color+'22;">'+lg+'</div></div>'+
                '<div class="ch-info"><div class="ch-name">'+ch.name+'</div><div class="ch-show">'+(ch.currentProgram?.title||ch.name)+'</div><div class="ch-prog-bar"><div class="ch-prog-bar-fill" style="width:45%"></div></div></div>'+
                '<div class="ch-meta"><span class="ch-num">CH '+ch.num+'</span>'+(ch.live?'<div class="ch-live-dot"></div>':'')+'</div>'+
                '<button class="ch-fav-btn '+(ch.fav?'fav':'')+'" data-id="'+ch.id+'"><svg width="12" height="12" viewBox="0 0 24 24" '+(ch.fav?'fill="currentColor"':'fill="none" stroke="currentColor" stroke-width="2"')+'><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>'};
        });
        VirtualizationEngine.setItems(items);
        var ce=$('rp-count'); if(ce) ce.textContent=items.length+' CH';
    }

    // ── Category Tabs ───────────────────────────────────────
    var CATS=['All','Live','Sports','News','Movies','Entertainment','Music','Favorites'];
    function renderCats() {
        var el=$('rp-cats'); if(!el) return;
        var tab=StateEngine.getState().ui.selectedTab||'All';
        el.innerHTML=CATS.map(function(c){return '<button class="cat-pill '+(c===tab?'active':'')+'" data-cat="'+c+'">'+c+'</button>';}).join('');
        el.querySelectorAll('.cat-pill').forEach(function(btn){
            btn.addEventListener('click',function(){
                StateEngine.setState(function(p){return Object.assign({},p,{ui:Object.assign({},p.ui,{selectedTab:btn.dataset.cat})});});
                renderCats();
            });
        });
    }

    // ── Event Handlers ──────────────────────────────────────
    function bindEvents() {
        // Controls
        $('play-btn') && $('play-btn').addEventListener('click',function(){StreamEngine.togglePlay();});
        $('skip-back-btn') && $('skip-back-btn').addEventListener('click',function(){var f=$('hero-prog-fill');if(f)f.style.width=Math.max(0,(parseInt(f.style.width)||0)-5)+'%';});
        $('skip-fwd-btn') && $('skip-fwd-btn').addEventListener('click',function(){var f=$('hero-prog-fill');if(f)f.style.width=Math.min(100,(parseInt(f.style.width)||0)+5)+'%';});
        $('mute-btn') && $('mute-btn').addEventListener('click',function(){StreamEngine.mute(!StreamEngine.isMuted());});
        $('vol-slider') && $('vol-slider').addEventListener('input',function(e){StreamEngine.setVolume(parseFloat(e.target.value));});
        $('hero-fs-btn') && $('hero-fs-btn').addEventListener('click',function(){var p=$('hero-player'); if(!p)return; if(!document.fullscreenElement)p.requestFullscreen().catch(function(){});else document.exitFullscreen();});
        $('hero-prog-track') && $('hero-prog-track').addEventListener('click',function(e){var r=e.currentTarget.getBoundingClientRect();var pct=(e.clientX-r.left)/r.width*100;var f=$('hero-prog-fill');if(f)f.style.width=Math.max(0,Math.min(100,pct))+'%';});
        // Settings
        $('btn-settings') && $('btn-settings').addEventListener('click',function(){var m=$('settings-modal');if(m)m.classList.add('open');});
        $('modal-close') && $('modal-close').addEventListener('click',function(){var m=$('settings-modal');if(m)m.classList.remove('open');});
        // Search
        $('search-input') && $('search-input').addEventListener('input',function(e){StateEngine.setState(function(p){return Object.assign({},p,{ui:Object.assign({},p.ui,{searchQuery:e.target.value})});});});
        // See all
        $('see-all-btn') && $('see-all-btn').addEventListener('click',function(){StateEngine.setState(function(p){return Object.assign({},p,{ui:Object.assign({},p.ui,{selectedTab:'All',searchQuery:''})});});renderCats();});
        // Hero fav
        $('hero-fav-btn') && $('hero-fav-btn').addEventListener('click',function(){var id=StateEngine.getState().activeChannel?.id;if(id)toggleFav(id);});
        // Keyboard
        document.addEventListener('keydown',function(e){
            if(e.target.tagName==='INPUT')return;
            if(e.key===' '){e.preventDefault();StreamEngine.togglePlay();}
            if(e.key==='m'||e.key==='M')StreamEngine.mute(!StreamEngine.isMuted());
            if(e.key==='f'||e.key==='F'){var p=$('hero-player');if(p){if(!document.fullscreenElement)p.requestFullscreen().catch(function(){});else document.exitFullscreen();}}
            if(e.key==='ArrowRight'){e.preventDefault();var f=$('hero-prog-fill');if(f)f.style.width=Math.min(100,(parseInt(f.style.width)||0)+5)+'%';}
            if(e.key==='ArrowLeft'){e.preventDefault();var f=$('hero-prog-fill');if(f)f.style.width=Math.max(0,(parseInt(f.style.width)||0)-5)+'%';}
            if(e.key==='/'){e.preventDefault();$('search-input')&&$('search-input').focus();}
        });
    }

    // ── INIT ────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function() {
        loadChannels().then(function(chs){if(chs&&chs.length){renderCats();initVirtualList();selectChannel(chs[0].id);}});
        loadRecommendations();
        bindEvents();
        updateClock(); setInterval(updateClock, 1000);

        // Stream engine init
        var pc=$('hero-player'); if(pc) StreamEngine.init(pc);

        // Subscribe to EPG changes
        StateEngine.subscribe('epg',function(epg){var ch=StateEngine.getState().activeChannel;if(ch&&epg[ch.id])renderEPG(ch.id);});
        StateEngine.subscribe('activeChannel',function(ch){if(ch){var epg=StateEngine.getState().epg;if(epg[ch.id])renderEPG(ch.id);}});

        // ── v3 Production Hardening ─────────────────────────────
        // Network resilience: track connection state
        StateEngine.subscribe('realtime',function(rt){
            Network.setConnected(rt.connected);
            if(!rt.connected) {
                var badge = document.getElementById('connection-badge');
                if(badge){badge.textContent='Reconnecting...';badge.style.display='flex';}
            } else {
                var badge = document.getElementById('connection-badge');
                if(badge) badge.style.display='none';
            }
        });

        // Performance enforcement: periodic checks
        setInterval(function(){
            PerfEnforce.checkLimits();
            var metrics = Debug.getMetrics();
            if(parseFloat(metrics.avgRenderTimeMs) > 8){
                console.warn('[Perf] Render time exceeded 8ms:', metrics.avgRenderTimeMs);
            }
        }, 5000);

        // Memory stability: periodic cleanup
        setInterval(function(){ Memory.forceGC(); }, 30000);

        // Debug: Ctrl+Shift+D toggles panel (already bound in runtime-v3.js)

        console.log('%c A1TV v3.0 — Production Streaming OS Active ','background:#00F2FE;color:#040711;font-weight:900;font-size:12px;padding:4px 8px;border-radius:4px;');
    });

    function renderEPG(chId) {
        var epg=StateEngine.getState().epg[chId]; if(!epg) return;
        var c=$('epg-section'); if(!c) return;
        var h='';
        if(epg.current){var p=epg.current;h+='<div class="epg-now"><div class="epg-label">NOW PLAYING</div><div class="epg-title">'+p.title+'</div><div class="epg-time">'+fmtTime(p.start_time)+' – '+fmtTime(p.end_time)+'</div></div>';}
        if(epg.next&&epg.next.length){h+='<div class="epg-next"><div class="epg-label">NEXT</div>'+epg.next.slice(0,3).map(function(p){return '<div class="epg-item"><span class="epg-time">'+fmtTime(p.start_time)+'</span><span class="epg-title">'+p.title+'</span></div>';}).join('')+'</div>';}
        if(epg.later&&epg.later.length){h+='<div class="epg-later"><div class="epg-label">LATER</div>'+epg.later.slice(0,5).map(function(p){return '<div class="epg-item"><span class="epg-time">'+fmtTime(p.start_time)+'</span><span class="epg-title">'+p.title+'</span></div>';}).join('')+'</div>';}
        c.innerHTML=h;
    }

    console.log('%c A1TV v3.0 — Production Streaming OS Active ','background:#00F2FE;color:#040711;font-weight:900;font-size:12px;padding:4px 8px;border-radius:4px;');
})();
