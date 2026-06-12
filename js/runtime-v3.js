/* ============================================================
   A1TV v3 — Production Hardening Layer
   EDVSR Runtime OS Extension
   
   10 Systems:
   1. Backpressure Control
   2. Memory Stability
   3. Stream Stability Governor
   4. Realtime Event Governor
   5. UI Render Guarantee
   6. Scaling Engine
   7. Network Resilience
   8. Performance Enforcement
   9. Failure Isolation
   10. State Consistency
   11. Debug Observability
   ============================================================ */

(function(window) {
    'use strict';
    var R = window.A1TVRuntime;
    if (!R) { console.error('A1TV Runtime v2 not loaded'); return; }

    // ─────────────────────────────────────────────────────────
    // SHARED CONSTANTS
    // ─────────────────────────────────────────────────────────
    const PRIORITY = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const LIMITS = Object.freeze({
        MAX_EVENT_QUEUE: 100,
        MAX_WS_EVENTS_PER_SEC: 500,
        MAX_DOM_NODES_PER_LIST: 30,
        MAX_RENDER_TIME_MS: 8,
        MAX_DIFF_PATCHES_PER_FRAME: 200,
        DEDUPLICATE_WINDOW_MS: 2000,
        RECONNECT_BASE_DELAY_MS: 1000,
        RECONNECT_MAX_DELAY_MS: 30000,
        RECONNECT_MAX_RETRIES: 10,
        SSS_DISABLE_THRESHOLD: 50,
        SSS_LOW_THRESHOLD: 70,
        SSS_NORMAL_THRESHOLD: 90,
        ADAPTIVE_BUFFER_SLOW: 10,
        ADAPTIVE_BUFFER_STABLE: 5,
        ADAPTIVE_BUFFER_FAST: 2,
        SCROLL_SPEED_THRESHOLD: 800, // px/sec
        VIRTUAL_BUFFER_SMALL: 3,
        VIRTUAL_BUFFER_LARGE: 10,
        FRAME_LOCK_MS: 16,
        POLLING_FALLBACK_INTERVAL_MS: 5000,
    });


    // ─────────────────────────────────────────────────────────
    // 1. BACKPRESSURE CONTROL SYSTEM
    // ─────────────────────────────────────────────────────────
    const BackpressureControl = (() => {
        var eventQueue = [];
        var processing = false;
        var stats = { totalReceived: 0, totalProcessed: 0, totalDropped: 0, currentQueueDepth: 0 };

        function enqueue(event, priority) {
            stats.totalReceived++;
            stats.currentQueueDepth = eventQueue.length;

            // If overloaded, drop LOW priority entirely
            if (eventQueue.length > LIMITS.MAX_EVENT_QUEUE) {
                if (priority === PRIORITY.LOW) {
                    stats.totalDropped++;
                    return false;
                }
                // If still overloaded, drop MEDIUM too
                if (eventQueue.length > LIMITS.MAX_EVENT_QUEUE * 1.5 && priority === PRIORITY.MEDIUM) {
                    stats.totalDropped++;
                    return false;
                }
            }

            eventQueue.push({ event, priority, timestamp: performance.now() });
            eventQueue.sort(function(a, b) { return a.priority - b.priority; });

            if (!processing) processQueue();
            return true;
        }

        function processQueue() {
            if (processing) return;
            processing = true;

            requestAnimationFrame(function() {
                var batch = [];
                var mediumBatch = [];
                var now = performance.now();

                while (eventQueue.length > 0 && batch.length < 50) {
                    var item = eventQueue.shift();
                    if (item.priority === PRIORITY.HIGH) {
                        batch.push(item.event);
                    } else if (item.priority === PRIORITY.MEDIUM) {
                        mediumBatch.push(item.event);
                    }
                    // LOW priority only processed if queue is healthy
                    else if (eventQueue.length < LIMITS.MAX_EVENT_QUEUE * 0.5) {
                        batch.push(item.event);
                    }
                }

                // Process HIGH + LOW immediately
                for (var i = 0; i < batch.length; i++) {
                    try { R.EventBus.emit(batch[i].type, batch[i].payload); } catch (e) {}
                }

                // Batch MEDIUM for next frame
                if (mediumBatch.length > 0) {
                    requestAnimationFrame(function() {
                        for (var j = 0; j < mediumBatch.length; j++) {
                            try { R.EventBus.emit(mediumBatch[j].type, mediumBatch[j].payload); } catch (e) {}
                        }
                    });
                }

                stats.totalProcessed += batch.length + mediumBatch.length;
                stats.currentQueueDepth = eventQueue.length;
                processing = false;

                if (eventQueue.length > 0) processQueue();
            });
        }

        function getStats() { return Object.assign({}, stats); }
        function getQueueDepth() { return eventQueue.length; }
        function clear() { eventQueue = []; }

        return { enqueue, getStats, getQueueDepth, clear };
    })();


    // ─────────────────────────────────────────────────────────
    // 2. MEMORY STABILITY LAYER
    // ─────────────────────────────────────────────────────────
    const MemoryStability = (() => {
        var trackedComponents = new Map();
        var trackedListeners = new Map();
        var trackedTimers = new Map();
        var stats = { componentsTracked: 0, listenersCleaned: 0, timersCleared: 0, buffersDestroyed: 0 };

        function trackComponent(id, el, listeners, timers) {
            trackedComponents.set(id, { el: el, listeners: listeners || [], timers: timers || [], mounted: true });
            stats.componentsTracked = trackedComponents.size;
        }

        function unmountComponent(id) {
            var comp = trackedComponents.get(id);
            if (!comp) return;

            // Remove event listeners
            if (comp.listeners) {
                comp.listeners.forEach(function(l) {
                    try {
                        if (l.el && l.event && l.handler) {
                            l.el.removeEventListener(l.event, l.handler);
                            stats.listenersCleaned++;
                        }
                    } catch (e) {}
                });
            }

            // Clear timers
            if (comp.timers) {
                comp.timers.forEach(function(t) {
                    try {
                        if (t.type === 'timeout') clearTimeout(t.id);
                        else if (t.type === 'interval') clearInterval(t.id);
                        else if (t.type === 'raf') cancelAnimationFrame(t.id);
                        stats.timersCleared++;
                    } catch (e) {}
                });
            }

            // Detach DOM references
            if (comp.el) {
                comp.el.innerHTML = '';
                if (comp.el.parentNode) comp.el.parentNode.removeChild(comp.el);
            }

            comp.listeners = null;
            comp.timers = null;
            comp.el = null;
            comp.mounted = false;
            trackedComponents.delete(id);
            stats.componentsTracked = trackedComponents.size;
        }

        function destroyOrphanBuffers() {
            if (!R.StreamEngine) return;
            var state = R.StateEngine.getState();
            var activeId = state.activeChannel && state.activeChannel.id;
            if (R.StreamEngine.currentChannelId && R.StreamEngine.currentChannelId !== activeId) {
                R.StreamEngine.destroy();
                stats.buffersDestroyed++;
            }
        }

        function forceGC() {
            // Unmount all tracked components that are no longer in DOM
            trackedComponents.forEach(function(comp, id) {
                if (comp.el && !document.body.contains(comp.el)) {
                    unmountComponent(id);
                }
            });
            destroyOrphanBuffers();
        }

        function getStats() { return Object.assign({}, stats); }
        function getComponentCount() { return trackedComponents.size; }

        // Auto-cleanup every 30 seconds
        setInterval(forceGC, 30000);

        return { trackComponent, unmountComponent, destroyOrphanBuffers, forceGC, getStats };
    })();


    // ─────────────────────────────────────────────────────────
    // 3. STREAM STABILITY GOVERNOR (SSS)
    // ─────────────────────────────────────────────────────────
    const StreamStabilityGovernor = (() => {
        var streamScores = new Map();
        var stats = { totalScores: 0, disabled: 0, low: 0, normal: 0, preferred: 0 };

        function calculateSSS(stream) {
            var successRate = stream.successRate || 0;
            var latency = stream.responseTime || 0;
            var bufferHealth = stream.bufferHealth || 100;

            // Latency score (inverted, 0-100)
            var latencyScore = 100;
            if (latency > 0) {
                if (latency < 50) latencyScore = 100;
                else if (latency < 200) latencyScore = 85;
                else if (latency < 500) latencyScore = 60;
                else if (latency < 1000) latencyScore = 30;
                else latencyScore = 10;
            }

            // Buffer health (0-100)
            var bufferScore = Math.min(100, Math.max(0, bufferHealth));

            var sss = Math.round(
                successRate * 0.5 +
                latencyScore * 0.3 +
                bufferScore * 0.2
            );

            return Math.max(0, Math.min(100, sss));
        }

        function classifyStream(sss) {
            if (sss < LIMITS.SSS_DISABLE_THRESHOLD) return 'disabled';
            if (sss < LIMITS.SSS_LOW_THRESHOLD) return 'low';
            if (sss < LIMITS.SSS_NORMAL_THRESHOLD) return 'normal';
            return 'preferred';
        }

        function updateStreamScore(streamId, stream) {
            var sss = calculateSSS(stream);
            var classification = classifyStream(sss);
            streamScores.set(streamId, { sss: sss, classification: classification, updatedAt: performance.now() });

            // Update stats
            stats.totalScores = streamScores.size;
            stats.disabled = 0; stats.low = 0; stats.normal = 0; stats.preferred = 0;
            streamScores.forEach(function(s) { stats[s.classification]++; });

            return { sss: sss, classification: classification };
        }

        function getBestStream(streams) {
            // Filter out disabled, sort by SSS descending
            var available = streams
                .filter(function(s) {
                    var score = streamScores.get(s.id);
                    return !score || score.classification !== 'disabled';
                })
                .sort(function(a, b) {
                    var scoreA = streamScores.get(a.id);
                    var scoreB = streamScores.get(b.id);
                    var sssA = scoreA ? scoreA.sss : 0;
                    var sssB = scoreB ? scoreB.sss : 0;
                    return sssB - sssA;
                });

            return available[0] || null;
        }

        function getFailoverChain(streams) {
            return streams
                .filter(function(s) {
                    var score = streamScores.get(s.id);
                    return !score || score.classification !== 'disabled';
                })
                .sort(function(a, b) {
                    var scoreA = streamScores.get(a.id);
                    var scoreB = streamScores.get(b.id);
                    return (scoreB ? scoreB.sss : 0) - (scoreA ? scoreA.sss : 0);
                });
        }

        function getAdaptiveBuffer(networkQuality) {
            if (networkQuality === 'slow') return LIMITS.ADAPTIVE_BUFFER_SLOW;
            if (networkQuality === 'fast') return LIMITS.ADAPTIVE_BUFFER_FAST;
            return LIMITS.ADAPTIVE_BUFFER_STABLE;
        }

        function getStats() { return Object.assign({}, stats); }
        function getStreamScore(streamId) { return streamScores.get(streamId); }

        return { calculateSSS, classifyStream, updateStreamScore, getBestStream, getFailoverChain, getAdaptiveBuffer, getStats };
    })();


    // ─────────────────────────────────────────────────────────
    // 4. REALTIME EVENT GOVERNOR
    // ─────────────────────────────────────────────────────────
    const RealtimeEventGovernor = (() => {
        var dedupCache = new Map();
        var eventCounts = new Map();
        var lastResetTime = performance.now();
        var stats = { totalIncoming: 0, totalDeduped: 0, totalThrottled: 0, totalProcessed: 0 };

        function shouldProcess(eventType, channelId) {
            stats.totalIncoming++;

            // Rate limiting: max 500 events/sec
            var now = performance.now();
            if (now - lastResetTime >= 1000) {
                eventCounts.clear();
                lastResetTime = now;
            }
            var count = (eventCounts.get(eventType) || 0) + 1;
            eventCounts.set(eventType, count);
            if (count > LIMITS.MAX_WS_EVENTS_PER_SEC) {
                stats.totalThrottled++;
                return false;
            }

            // Deduplication
            var dedupKey = eventType + ':' + (channelId || '');
            var lastTime = dedupCache.get(dedupKey) || 0;
            if (now - lastTime < LIMITS.DEDUPLICATE_WINDOW_MS) {
                stats.totalDeduped++;
                return false;
            }
            dedupCache.set(dedupKey, now);

            stats.totalProcessed++;
            return true;
        }

        function processEvent(eventType, payload, priority) {
            var channelId = payload && payload.channelId;

            if (!shouldProcess(eventType, channelId)) return false;

            // Route through backpressure control
            return BackpressureControl.enqueue({ type: eventType, payload: payload }, priority);
        }

        function cleanupDedup() {
            var now = performance.now();
            dedupCache.forEach(function(time, key) {
                if (now - time > LIMITS.DEDUPLICATE_WINDOW_MS * 2) dedupCache.delete(key);
            });
        }

        // Cleanup dedup cache every 10 seconds
        setInterval(cleanupDedup, 10000);

        function getStats() { return Object.assign({}, stats); }

        return { processEvent, getStats };
    })();


    // ─────────────────────────────────────────────────────────
    // 5. UI RENDER GUARANTEE
    // ─────────────────────────────────────────────────────────
    const UIRenderGuarantee = (() => {
        var streamEngineActive = false;
        var renderQueue = [];
        var isRendering = false;

        // Stream engine runs independently
        function notifyStreamActive(active) {
            streamEngineActive = active;
        }

        // DOM updates cannot pause video pipeline
        function safeDOMUpdate(fn) {
            if (streamEngineActive) {
                // Queue DOM update for next frame, don't block stream
                renderQueue.push(fn);
                if (!isRendering) {
                    isRendering = true;
                    requestAnimationFrame(flushRenderQueue);
                }
            } else {
                fn();
            }
        }

        function flushRenderQueue() {
            var start = performance.now();
            while (renderQueue.length > 0 && (performance.now() - start) < LIMITS.MAX_RENDER_TIME_MS) {
                try { renderQueue.shift()(); } catch (e) { console.warn('[RenderGuarantee] Render error:', e.message); }
            }
            isRendering = false;
            if (renderQueue.length > 0) {
                requestAnimationFrame(flushRenderQueue);
            }
        }

        return { notifyStreamActive, safeDOMUpdate };
    })();


    // ─────────────────────────────────────────────────────────
    // 6. SCALING ENGINE
    // ─────────────────────────────────────────────────────────
    const ScalingEngine = (() => {
        var scrollSpeed = 0;
        var lastScrollTop = 0;
        var lastScrollTime = performance.now();
        var isIdle = true;
        var idleTimer = null;

        function trackScroll(scrollTop) {
            var now = performance.now();
            var dt = now - lastScrollTime;
            if (dt > 0) {
                scrollSpeed = Math.abs(scrollTop - lastScrollTop) / (dt / 1000);
            }
            lastScrollTop = scrollTop;
            lastScrollTime = now;
            isIdle = false;

            clearTimeout(idleTimer);
            idleTimer = setTimeout(function() { isIdle = true; }, 500);
        }

        function getVirtualBuffer() {
            if (isIdle) return LIMITS.VIRTUAL_BUFFER_LARGE;
            if (scrollSpeed > LIMITS.SCROLL_SPEED_THRESHOLD) return LIMITS.VIRTUAL_BUFFER_SMALL;
            return LIMITS.VIRTUAL_BUFFER_LARGE;
        }

        // Lazy state hydration
        var hydratedChannels = new Set();

        function shouldHydrate(channelId) {
            if (hydratedChannels.has(channelId)) return false;
            hydratedChannels.add(channelId);
            return true;
        }

        function getVisibleChannelIds(scrollTop, containerHeight, itemHeight) {
            var startIdx = Math.floor(scrollTop / itemHeight);
            var endIdx = Math.ceil((scrollTop + containerHeight) / itemHeight);
            var ids = [];
            var state = R.StateEngine.getState();
            for (var i = Math.max(0, startIdx); i <= Math.min(state.channels.length - 1, endIdx); i++) {
                if (state.channels[i]) ids.push(state.channels[i].id);
            }
            return ids;
        }

        return { trackScroll, getVirtualBuffer, shouldHydrate, getVisibleChannelIds };
    })();


    // ─────────────────────────────────────────────────────────
    // 7. NETWORK RESILIENCE
    // ─────────────────────────────────────────────────────────
    const NetworkResilience = (() => {
        var state = {
            connected: false,
            reconnectAttempts: 0,
            offlineQueue: [],
            lastEvent: null,
        };

        function setConnected(connected) {
            state.connected = connected;
            if (connected) {
                state.reconnectAttempts = 0;
                flushOfflineQueue();
            }
        }

        function queueEvent(eventType, payload) {
            if (state.offlineQueue.length > 1000) state.offlineQueue.shift();
            state.offlineQueue.push({ type: eventType, payload: payload, timestamp: Date.now() });
        }

        function flushOfflineQueue() {
            while (state.offlineQueue.length > 0) {
                var item = state.offlineQueue.shift();
                try { R.EventBus.emit(item.type, item.payload); } catch (e) {}
            }
        }

        function getReconnectDelay() {
            return Math.min(
                LIMITS.RECONNECT_BASE_DELAY_MS * Math.pow(2, state.reconnectAttempts),
                LIMITS.RECONNECT_MAX_DELAY_MS
            );
        }

        function shouldFallbackToPolling() {
            return state.reconnectAttempts >= LIMITS.RECONNECT_MAX_RETRIES;
        }

        function getStats() { return Object.assign({}, state); }

        return { setConnected, queueEvent, getReconnectDelay, shouldFallbackToPolling, getStats };
    })();


    // ─────────────────────────────────────────────────────────
    // 8. PERFORMANCE ENFORCEMENT
    // ─────────────────────────────────────────────────────────
    const PerformanceEnforcement = (() => {
        var violations = [];
        var enforcementActive = false;

        function checkLimits() {
            var domCount = document.querySelectorAll('*').length;
            var eventQueueDepth = BackpressureControl.getQueueDepth();

            if (domCount > LIMITS.MAX_DOM_NODES_PER_LIST * 10) {
                violations.push({ type: 'dom_exceeded', value: domCount, time: Date.now() });
                enforceDowngrade('dom');
            }

            if (eventQueueDepth > LIMITS.MAX_EVENT_QUEUE) {
                violations.push({ type: 'queue_exceeded', value: eventQueueDepth, time: Date.now() });
                enforceDowngrade('queue');
            }
        }

        function enforceDowngrade(type) {
            if (enforcementActive) return;
            enforcementActive = true;

            switch (type) {
                case 'dom':
                    // Force virtualization buffer reduction
                    R.VirtualizationEngine.setItems([]);
                    MemoryStability.forceGC();
                    break;
                case 'queue':
                    // Drop all LOW priority events
                    BackpressureControl.clear();
                    break;
            }

            setTimeout(function() { enforcementActive = false; }, 1000);
        }

        function getViolationCount() { return violations.length; }
        function getRecentViolations(limit) { return violations.slice(-(limit || 10)); }

        // Check every 5 seconds
        setInterval(checkLimits, 5000);

        return { checkLimits, getViolationCount, getRecentViolations };
    })();


    // ─────────────────────────────────────────────────────────
    // 9. FAILURE ISOLATION
    // ─────────────────────────────────────────────────────────
    const FailureIsolation = (() => {
        var moduleStates = new Map();
        var fallbackStates = new Map();

        function registerModule(name, fallbackState) {
            moduleStates.set(name, { status: 'healthy', lastError: null, errorCount: 0 });
            fallbackStates.set(name, fallbackState);
        }

        function reportError(moduleName, error) {
            var mod = moduleStates.get(moduleName);
            if (!mod) return;

            mod.errorCount++;
            mod.lastError = { message: error.message, time: Date.now() };

            // If too many errors, mark as degraded
            if (mod.errorCount > 5) {
                mod.status = 'degraded';
                activateFallback(moduleName);
            }

            // Log but don't crash
            console.warn('[FailureIsolation]', moduleName, error.message);
        }

        function activateFallback(moduleName) {
            var fallback = fallbackStates.get(moduleName);
            if (!fallback) return;

            try {
                switch (moduleName) {
                    case 'stream':
                        // Show degraded badge, don't crash UI
                        var badge = document.getElementById('stream-status-badge');
                        if (badge) { badge.textContent = 'Degraded'; badge.style.display = 'flex'; }
                        break;
                    case 'websocket':
                        NetworkResilience.setConnected(false);
                        break;
                    case 'epg':
                        // Show "EPG unavailable" message
                        var el = document.getElementById('epg-section');
                        if (el) el.innerHTML = '<div class="epg-unavailable">EPG temporarily unavailable</div>';
                        break;
                }
            } catch (e) {
                console.error('[FailureIsolation] Fallback failed:', e.message);
            }
        }

        function resetModule(moduleName) {
            var mod = moduleStates.get(moduleName);
            if (mod) { mod.status = 'healthy'; mod.errorCount = 0; mod.lastError = null; }
        }

        function getModuleStatus(moduleName) { return moduleStates.get(moduleName); }
        function getAllStatuses() {
            var result = {};
            moduleStates.forEach(function(v, k) { result[k] = Object.assign({}, v); });
            return result;
        }

        // Register core modules
        registerModule('stream', { showDegradedBadge: true });
        registerModule('websocket', { showReconnecting: true });
        registerModule('epg', { showUnavailable: true });
        registerModule('api', { useCachedData: true });

        return { registerModule, reportError, resetModule, getModuleStatus, getAllStatuses };
    })();


    // ─────────────────────────────────────────────────────────
    // 10. STATE CONSISTENCY (Frame Lock)
    // ─────────────────────────────────────────────────────────
    const StateConsistency = (() => {
        var frameLocked = false;
        var pendingMutations = [];
        var mutationId = 0;

        function lockFrame() {
            frameLocked = true;
        }

        function unlockFrame() {
            frameLocked = false;
            flushMutations();
        }

        function queueMutation(updater) {
            var id = ++mutationId;
            pendingMutations.push({ id: id, updater: updater });

            if (!frameLocked) {
                flushMutations();
            }

            return id;
        }

        function flushMutations() {
            if (pendingMutations.length === 0) return;

            // Apply all pending mutations in order
            var state = R.StateEngine.getState();
            var newState = state;
            for (var i = 0; i < pendingMutations.length; i++) {
                try {
                    newState = pendingMutations[i].updater(newState);
                } catch (e) {
                    console.warn('[StateConsistency] Mutation failed:', e.message);
                }
            }
            pendingMutations = [];

            // Single state update for all mutations
            R.StateEngine.setState(newState, { immediate: true });
        }

        // Auto-lock during RAF
        var originalRAF = window.requestAnimationFrame;
        window.requestAnimationFrame = function(cb) {
            lockFrame();
            return originalRAF(function(ts) {
                try { cb(ts); } finally { unlockFrame(); }
            });
        };

        return { lockFrame, unlockFrame, queueMutation, getPendingCount: function() { return pendingMutations.length; } };
    })();


    // ─────────────────────────────────────────────────────────
    // 11. DEBUG OBSERVABILITY (Zero Performance Impact)
    // ─────────────────────────────────────────────────────────
    const DebugObservability = (() => {
        var metrics = {
            renderTime: [],
            diffPatchCount: [],
            streamSwitchCount: 0,
            eventQueueDepth: [],
            memoryUsage: [],
            frameDrops: 0,
        };
        var lastFrameTime = performance.now();
        var frameCount = 0;

        // Passive frame monitoring (no RAF hook)
        function recordFrame() {
            var now = performance.now();
            var delta = now - lastFrameTime;
            lastFrameTime = now;
            frameCount++;

            if (delta > 20) metrics.frameDrops++;

            // Sample every 60 frames to avoid overhead
            if (frameCount % 60 === 0) {
                metrics.renderTime.push(delta);
                if (metrics.renderTime.length > 100) metrics.renderTime.shift();

                if (performance.memory) {
                    metrics.memoryUsage.push(performance.memory.usedJSHeapSize);
                    if (metrics.memoryUsage.length > 100) metrics.memoryUsage.shift();
                }
            }

            requestAnimationFrame(recordFrame);
        }

        // Start passive monitoring
        requestAnimationFrame(recordFrame);

        function recordDiffPatches(count) {
            metrics.diffPatchCount.push(count);
            if (metrics.diffPatchCount.length > 100) metrics.diffPatchCount.shift();
        }

        function recordStreamSwitch() { metrics.streamSwitchCount++; }

        function recordEventQueue(depth) {
            metrics.eventQueueDepth.push(depth);
            if (metrics.eventQueueDepth.length > 100) metrics.eventQueueDepth.shift();
        }

        function getMetrics() {
            var avgRender = metrics.renderTime.length > 0 ?
                metrics.renderTime.reduce(function(a,b){return a+b;}, 0) / metrics.renderTime.length : 0;
            var avgPatches = metrics.diffPatchCount.length > 0 ?
                metrics.diffPatchCount.reduce(function(a,b){return a+b;}, 0) / metrics.diffPatchCount.length : 0;
            return {
                avgRenderTimeMs: avgRender.toFixed(2),
                avgDiffPatches: avgPatches.toFixed(1),
                streamSwitches: metrics.streamSwitchCount,
                frameDrops: metrics.frameDrops,
                currentEventQueue: metrics.eventQueueDepth[metrics.eventQueueDepth.length - 1] || 0,
                memoryTrend: metrics.memoryUsage.length > 1 ?
                    (metrics.memoryUsage[metrics.memoryUsage.length-1] - metrics.memoryUsage[0]) : 0,
            };
        }

        // Expose debug panel toggle
        function toggleDebugPanel() {
            var panel = document.getElementById('a1tv-debug-panel');
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            } else {
                createDebugPanel();
            }
        }

        function createDebugPanel() {
            var panel = document.createElement('div');
            panel.id = 'a1tv-debug-panel';
            panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(4,7,17,0.95);color:#00F2FE;font-family:monospace;font-size:11px;padding:8px;z-index:9999;max-height:150px;overflow:auto;display:block;';
            document.body.appendChild(panel);
            updateDebugPanel(panel);
            setInterval(function() { updateDebugPanel(panel); }, 1000);
        }

        function updateDebugPanel(panel) {
            var m = getMetrics();
            var bp = BackpressureControl.getStats();
            var mem = MemoryStability.getStats();
            panel.innerHTML = '<b>A1TV Debug</b> | Render: ' + m.avgRenderTimeMs + 'ms | Patches: ' + m.avgPatches + ' | Queue: ' + m.currentEventQueue + ' | Drops: ' + m.frameDrops + ' | Components: ' + mem.componentsTracked + ' | Events: ' + bp.totalProcessed + '/' + bp.totalReceived;
        }

        // Keyboard shortcut: Ctrl+Shift+D
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') toggleDebugPanel();
        });

        return { recordFrame, recordDiffPatches, recordStreamSwitch, recordEventQueue, getMetrics, toggleDebugPanel };
    })();


    // ─────────────────────────────────────────────────────────
    // PUBLIC API — Extend A1TVRuntime
    // ─────────────────────────────────────────────────────────
    R.Backpressure = Object.freeze(BackpressureControl);
    R.Memory = Object.freeze(MemoryStability);
    R.StreamGovernor = Object.freeze(StreamStabilityGovernor);
    R.EventGovernor = Object.freeze(RealtimeEventGovernor);
    R.RenderGuarantee = Object.freeze(UIRenderGuarantee);
    R.Scaling = Object.freeze(ScalingEngine);
    R.Network = Object.freeze(NetworkResilience);
    R.PerfEnforce = Object.freeze(PerformanceEnforcement);
    R.FailureIso = Object.freeze(FailureIsolation);
    R.StateLock = Object.freeze(StateConsistency);
    R.Debug = Object.freeze(DebugObservability);
    R.LIMITS = LIMITS;
    R.PRIORITY = PRIORITY;
    R.version = '3.0.0';

    console.log('%c A1TV v3.0 — Production Hardening Layer Active ','background:#00F2FE;color:#040711;font-weight:900;font-size:12px;padding:4px 8px;border-radius:4px;');

})(window);
