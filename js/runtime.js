/* ============================================================
   A1TV v2 — UI Runtime System
   Event-Driven Virtual State Renderer (EDVSR)
   
   Deterministic rendering: State → Diff → Patch → DOM
   Zero framework dependencies. Broadcast-grade stability.
   ============================================================ */

(function(window) {
    'use strict';

    // ─────────────────────────────────────────────────────────
    // 1. DIFF ENGINE (Core Performance System)
    // ─────────────────────────────────────────────────────────
    const DiffEngine = (() => {
        const PATCH = { TEXT: 1, ATTR: 2, REPLACE: 3, REMOVE: 4, INSERT: 5 };

        function diffText(oldNode, newNode) {
            if (oldNode.text !== newNode.text) {
                return { type: PATCH.TEXT, el: oldNode.el, text: newNode.text };
            }
            return null;
        }

        function diffAttrs(oldAttrs, newAttrs) {
            const patches = [];
            for (const key in newAttrs) {
                if (oldAttrs[key] !== newAttrs[key]) {
                    patches.push({ key, value: newAttrs[key], set: true });
                }
            }
            for (const key in oldAttrs) {
                if (!(key in newAttrs)) {
                    patches.push({ key, value: null, set: false });
                }
            }
            return patches.length ? patches : null;
        }

        function diffChildren(oldChildren, newChildren, parentEl) {
            const patches = [];
            const maxLen = Math.max(oldChildren.length, newChildren.length);
            for (let i = 0; i < maxLen; i++) {
                const oldChild = oldChildren[i];
                const newChild = newChildren[i];
                if (!oldChild && newChild) {
                    patches.push({ type: PATCH.INSERT, parent: parentEl, vnode: newChild, index: i });
                } else if (oldChild && !newChild) {
                    patches.push({ type: PATCH.REMOVE, el: oldChild.el });
                } else if (oldChild && newChild) {
                    const childPatch = diffNode(oldChild, newChild);
                    if (childPatch) patches.push(...childPatch);
                }
            }
            return patches;
        }

        function diffNode(oldVNode, newVNode) {
            const patches = [];
            if (oldVNode.tag !== newVNode.tag) {
                patches.push({ type: PATCH.REPLACE, oldEl: oldVNode.el, newVNode });
                return patches;
            }
            if (oldVNode.tag === null) {
                const tp = diffText(oldVNode, newVNode);
                if (tp) patches.push(tp);
                return patches;
            }
            const attrPatches = diffAttrs(oldVNode.attrs || {}, newVNode.attrs || {});
            if (attrPatches) {
                for (const ap of attrPatches) {
                    patches.push({ type: PATCH.ATTR, el: oldVNode.el, attr: ap.key, value: ap.value, set: ap.set });
                }
            }
            const oldChildren = oldVNode.children || [];
            const newChildren = newVNode.children || [];
            const childPatches = diffChildren(oldChildren, newChildren, oldVNode.el);
            if (childPatches.length) patches.push(...childPatches);
            if (newVNode.el) newVNode.el = oldVNode.el;
            return patches;
        }

        function applyPatches(patches) {
            if (!patches || !patches.length) return;
            for (const p of patches) {
                try {
                    switch (p.type) {
                        case PATCH.TEXT:
                            if (p.el) p.el.textContent = p.text;
                            break;
                        case PATCH.ATTR:
                            if (!p.el) break;
                            if (p.attr.startsWith('data-')) {
                                if (p.set) p.el.dataset[p.attr.replace('data-', '')] = p.value;
                                else delete p.el.dataset[p.attr.replace('data-', '')];
                            } else if (p.attr.startsWith('style.')) {
                                const prop = p.attr.replace('style.', '');
                                if (p.set) p.el.style[prop] = p.value;
                                else p.el.style[prop] = '';
                            } else {
                                if (p.set) p.el.setAttribute(p.attr, p.value);
                                else p.el.removeAttribute(p.attr);
                            }
                            break;
                        case PATCH.REPLACE:
                            if (p.oldEl && p.oldEl.parentNode) {
                                const newEl = renderVNode(p.newVNode);
                                p.oldEl.parentNode.replaceChild(newEl, p.oldEl);
                            }
                            break;
                        case PATCH.REMOVE:
                            if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
                            break;
                        case PATCH.INSERT:
                            if (p.parent) {
                                const newEl = renderVNode(p.vnode);
                                const refChild = p.parent.children[p.index] || null;
                                p.parent.insertBefore(newEl, refChild);
                            }
                            break;
                    }
                } catch (err) {
                    console.warn('[DiffEngine] Patch failed:', err.message);
                }
            }
        }

        return { diffNode, applyPatches, PATCH };
    })();


    // ─────────────────────────────────────────────────────────
    // 2. VDOM CREATION (Component System)
    // ─────────────────────────────────────────────────────────
    function createElement(tag, props, children) {
        if (typeof tag === 'function') {
            return tag(props || {}, children);
        }
        if (tag === null || tag === undefined) {
            return { tag: null, text: String(props ?? ''), el: null };
        }
        const vnode = { tag, attrs: {}, dataset: {}, style: {}, children: [], el: null };
        if (props) {
            for (const key in props) {
                if (key === 'class') vnode.attrs.className = props[key];
                else if (key === 'style' && typeof props[key] === 'object') vnode.style = props[key];
                else if (key.startsWith('data-')) vnode.dataset[key.replace('data-', '')] = props[key];
                else if (key === 'dataset') Object.assign(vnode.dataset, props[key]);
                else vnode.attrs[key] = props[key];
            }
        }
        if (children) {
            const arr = Array.isArray(children) ? children : [children];
            for (const child of arr) {
                if (child === null || child === undefined) continue;
                if (typeof child === 'string' || typeof child === 'number') {
                    vnode.children.push({ tag: null, text: String(child), el: null });
                } else {
                    vnode.children.push(child);
                }
            }
        }
        return vnode;
    }

    function renderVNode(vnode) {
        if (vnode.tag === null) { vnode.el = document.createTextNode(vnode.text); return vnode.el; }
        const el = document.createElement(vnode.tag);
        for (const key in vnode.attrs) el.setAttribute(key, vnode.attrs[key]);
        for (const key in vnode.dataset) el.dataset[key] = vnode.dataset[key];
        for (const key in vnode.style) el.style[key] = vnode.style[key];
        for (const child of vnode.children) el.appendChild(renderVNode(child));
        vnode.el = el;
        return el;
    }

    const h = createElement;


    // ─────────────────────────────────────────────────────────
    // 3. STATE ENGINE (Immutable Store)
    // ─────────────────────────────────────────────────────────
    const StateEngine = (() => {
        let state = {};
        let prevState = {};
        let listeners = {};
        let updateQueue = [];
        let frameId = null;
        let batching = false;

        function init(initialState) {
            state = deepFreeze(initialState);
            prevState = null;
            return api;
        }

        function deepFreeze(obj) {
            if (typeof obj !== 'object' || obj === null) return obj;
            Object.freeze(obj);
            Object.values(obj).forEach(v => { if (typeof v === 'object') deepFreeze(v); });
            return obj;
        }

        function getState() { return state; }

        function setState(updater, options = {}) {
            const newState = typeof updater === 'function' ? updater(state) : updater;
            prevState = state;
            state = deepFreeze(newState);
            const diff = computeStateDiff(prevState, state);
            if (options.immediate) {
                notifyListeners(diff);
            } else {
                updateQueue.push(diff);
                scheduleBatch();
            }
        }

        function computeStateDiff(oldState, newState) {
            const changes = {};
            for (const key in newState) {
                if (oldState[key] !== newState[key]) {
                    changes[key] = { old: oldState[key], new: newState[key] };
                }
            }
            return changes;
        }

        function scheduleBatch() {
            if (batching) return;
            batching = true;
            frameId = requestAnimationFrame(flushUpdates);
        }

        function flushUpdates() {
            batching = false;
            const queue = updateQueue.splice(0);
            const mergedDiff = {};
            for (const diff of queue) Object.assign(mergedDiff, diff);
            notifyListeners(mergedDiff);
        }

        function notifyListeners(diff) {
            for (const key in listeners) {
                if (diff[key]) {
                    try { listeners[key].forEach(fn => fn(diff[key].new, diff[key].old)); }
                    catch (err) { console.warn('[StateEngine] Listener error:', key, err.message); }
                }
            }
        }

        function subscribe(key, handler) {
            if (!listeners[key]) listeners[key] = [];
            listeners[key].push(handler);
            return function unsubscribe() { listeners[key] = listeners[key].filter(h => h !== handler); };
        }

        function destroy() {
            if (frameId) cancelAnimationFrame(frameId);
            listeners = {}; updateQueue = []; state = {};
        }

        return { init, getState, setState, subscribe, destroy };
    })();


    // ─────────────────────────────────────────────────────────
    // 4. EVENT BUS (Global Pub/Sub)
    // ─────────────────────────────────────────────────────────
    const EventBus = (() => {
        const handlers = {};
        const PRIORITY = { HIGH: 0, MEDIUM: 1, LOW: 2 };

        function on(event, handler, priority = PRIORITY.MEDIUM) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push({ handler, priority });
            handlers[event].sort((a, b) => a.priority - b.priority);
            return function off() { handlers[event] = handlers[event].filter(h => h.handler !== handler); };
        }

        function emit(event, payload) {
            if (!handlers[event]) return;
            for (const { handler, priority } of handlers[event]) {
                try {
                    if (priority === PRIORITY.HIGH) {
                        handler(payload);
                    } else {
                        requestAnimationFrame(() => handler(payload));
                    }
                } catch (err) { console.warn('[EventBus] Handler error:', event, err.message); }
            }
        }

        return { on, emit, off, PRIORITY };
    })();


    // ─────────────────────────────────────────────────────────
    // 5. VIRTUALIZATION ENGINE (Scroll-Window)
    // ─────────────────────────────────────────────────────────
    const VirtualizationEngine = (() => {
        var config = { itemHeight: 68, bufferSize: 5, maxDOMNodes: 30 };
        var state = { items: [], scrollTop: 0, containerHeight: 0, container: null, wrapper: null };

        function init(container, options) {
            state.container = container;
            Object.assign(config, options || {});
            state.containerHeight = container.clientHeight || window.innerHeight - 200;
            state.wrapper = document.createElement('div');
            state.wrapper.style.position = 'relative';
            container.innerHTML = '';
            container.appendChild(state.wrapper);
            var scrollTimer = null;
            container.addEventListener('scroll', function() {
                if (scrollTimer) return;
                scrollTimer = requestAnimationFrame(function() {
                    state.scrollTop = container.scrollTop;
                    render();
                    scrollTimer = null;
                });
            });
            return api;
        }

        function setItems(items) {
            state.items = items;
            state.wrapper.style.height = (items.length * config.itemHeight) + 'px';
            render();
        }

        function render() {
            if (!state.wrapper) return;
            var startIdx = Math.max(0, Math.floor(state.scrollTop / config.itemHeight) - config.bufferSize);
            var endIdx = Math.min(state.items.length - 1, Math.ceil((state.scrollTop + state.containerHeight) / config.itemHeight) + config.bufferSize);
            var html = '';
            for (var i = startIdx; i <= endIdx; i++) {
                var item = state.items[i];
                if (!item) continue;
                html += '<div class="ch-card ' + (item.active ? 'active' : '') + '" data-id="' + item.id + '" style="position:absolute;top:' + (i * config.itemHeight) + 'px;left:0;right:0;height:' + config.itemHeight + 'px;" role="listitem" tabindex="0">' + item.html + '</div>';
            }
            state.wrapper.innerHTML = html;
        }

        function scrollToItem(index) {
            if (!state.container) return;
            state.container.scrollTop = index * config.itemHeight;
            state.scrollTop = index * config.itemHeight;
            render();
        }

        function destroy() { if (state.container) state.container.innerHTML = ''; state.items = []; }

        return { init, setItems, scrollToItem, destroy, config };
    })();


    // ─────────────────────────────────────────────────────────
    // 6. STREAM ENGINE (Single Element, Source Switching)
    // ─────────────────────────────────────────────────────────
    const StreamEngine = (() => {
        var videoEl = null;
        var hlsInstance = null;
        var currentChannelId = null;
        var config = { autoReconnect: true, maxRetries: 3, retryDelay: 2000, bufferLength: 30 };
        var retryCount = 0;
        var isSwitching = false;

        function init(playerContainer) {
            videoEl = document.createElement('video');
            videoEl.id = 'hls-video';
            videoEl.playsInline = true;
            videoEl.autoplay = true;
            videoEl.muted = false;
            videoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#040711;';
            playerContainer.insertBefore(videoEl, playerContainer.firstChild);
            return api;
        }

        function switchStream(channel, streamUrl) {
            if (!videoEl || isSwitching) return;
            isSwitching = true;
            currentChannelId = channel.id;
            videoEl.pause();
            if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
            retryCount = 0;
            if (window.Hls && window.Hls.isSupported() && streamUrl.indexOf('.m3u8') !== -1) {
                loadHLS(streamUrl);
            } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                videoEl.src = streamUrl;
                videoEl.play().catch(function() {});
            } else {
                videoEl.src = streamUrl;
                videoEl.play().catch(function() { EventBus.emit('stream:error', { channel: channel, error: 'playback_failed' }); });
            }
            isSwitching = false;
        }

        function loadHLS(url) {
            hlsInstance = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90, maxBufferLength: config.bufferLength });
            hlsInstance.loadSource(url);
            hlsInstance.attachMedia(videoEl);
            hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, function() {
                videoEl.play().then(function() { EventBus.emit('stream:playing', { channelId: currentChannelId }); }).catch(function() {});
                retryCount = 0;
            });
            hlsInstance.on(window.Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    EventBus.emit('stream:error', { channelId: currentChannelId, error: data.type });
                    if (config.autoReconnect && retryCount < config.maxRetries) {
                        retryCount++;
                        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) setTimeout(function() { hlsInstance.startLoad(); }, config.retryDelay);
                        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hlsInstance.recoverMediaError();
                    } else {
                        EventBus.emit('stream:failover', { channelId: currentChannelId });
                    }
                }
            });
        }

        function play() { if (videoEl) videoEl.play().catch(function() {}); }
        function pause() { if (videoEl) videoEl.pause(); }
        function togglePlay() { if (!videoEl) return; if (videoEl.paused) videoEl.play().catch(function() {}); else videoEl.pause(); }
        function mute(muted) { if (videoEl) videoEl.muted = muted; }
        function setVolume(vol) { if (videoEl) videoEl.volume = Math.max(0, Math.min(1, vol)); }
        function isMuted() { return videoEl ? videoEl.muted : false; }
        function isPaused() { return videoEl ? videoEl.paused : true; }
        function destroy() { if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; } if (videoEl) { videoEl.pause(); videoEl.src = ''; } }

        return { init, switchStream, play, pause, mute, setVolume, isMuted, isPaused, destroy };
    })();


    // ─────────────────────────────────────────────────────────
    // 7. REALTIME LAYER (WebSocket + Priority System)
    // ─────────────────────────────────────────────────────────
    const RealtimeLayer = (() => {
        var socket = null;
        var config = { url: '', reconnectDelay: 3000, maxReconnects: 10 };
        var reconnectCount = 0;

        function init(options) {
            Object.assign(config, options);
            connect();
            return api;
        }

        function connect() {
            if (typeof io === 'undefined') { console.warn('[Realtime] Socket.IO not loaded'); return; }
            socket = io(config.url, { transports: ['websocket', 'polling'], reconnection: false });
            socket.on('connect', function() {
                reconnectCount = 0;
                EventBus.emit('realtime:connected', { socketId: socket.id });
                StateEngine.setState(function(prev) { return Object.assign({}, prev, { realtime: Object.assign({}, prev.realtime, { connected: true }) }); });
            });
            socket.on('disconnect', function() {
                EventBus.emit('realtime:disconnected', {});
                StateEngine.setState(function(prev) { return Object.assign({}, prev, { realtime: Object.assign({}, prev.realtime, { connected: false }) }); });
                attemptReconnect();
            });
            // High priority — bypass batching
            socket.on('stream:offline', function(d) { EventBus.emit('stream:offline', d); });
            socket.on('stream:online', function(d) { EventBus.emit('stream:online', d); });
            socket.on('stream:failover', function(d) { EventBus.emit('stream:failover', d); });
            // Medium priority
            socket.on('epg:updated', function(d) { EventBus.emit('epg:updated', d); });
            socket.on('viewers:count', function(d) { EventBus.emit('viewers:count', d); });
            socket.on('channel:updated', function(d) { EventBus.emit('channel:updated', d); });
        }

        function attemptReconnect() {
            if (reconnectCount >= config.maxReconnects) return;
            reconnectCount++;
            setTimeout(connect, config.reconnectDelay * reconnectCount);
        }

        function subscribe(channelId) { if (socket) socket.emit('subscribe:channel', channelId); }
        function unsubscribe(channelId) { if (socket) socket.emit('unsubscribe:channel', channelId); }
        function isConnected() { return socket && socket.connected; }
        function destroy() { if (socket) { socket.disconnect(); socket = null; } }

        return { init, subscribe, unsubscribe, isConnected, destroy };
    })();


    // ─────────────────────────────────────────────────────────
    // 8. PUBLIC API
    // ─────────────────────────────────────────────────────────
    window.A1TVRuntime = {
        h: createElement,
        renderVNode: renderVNode,
        DiffEngine: Object.freeze(DiffEngine),
        StateEngine: Object.freeze(StateEngine),
        EventBus: Object.freeze(EventBus),
        VirtualizationEngine: Object.freeze(VirtualizationEngine),
        StreamEngine: Object.freeze(StreamEngine),
        RealtimeLayer: Object.freeze(RealtimeLayer),
        version: '2.0.0',
    };

    console.log('%c A1TV UI Runtime v2.0 — EDVSR Engine Loaded ', 'background:#00F2FE; color:#040711; font-weight:900; font-size:12px; padding:4px 8px; border-radius:4px;');

})(window);
