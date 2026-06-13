// ============================================================
// A1TV v2 — WebSocket Service (Socket.IO)
// Real-time events: stream_online, stream_offline, channel_updated, epg_updated
// ============================================================

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'a1tv_production_secret_change_me';

class WebSocketService {
    constructor() {
        this.io = null;
        this.connectedDevices = new Map(); // Track connected sockets
    }

    /**
     * Initialize Socket.IO server attached to an HTTP server.
     * Lazy-loads socket.io to avoid native module conflicts during import chain.
     */
    init(httpServer, corsOrigins) {
        // Lazy require to avoid native module conflict with express on Node 22/WSL2
        const { Server } = require('socket.io');

        this.io = new Server(httpServer, {
            cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
            pingTimeout: 30000,
            pingInterval: 10000,
        });

        // Authentication middleware
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth?.token;
                if (token) {
                    const payload = jwt.verify(token, JWT_SECRET);
                    socket.userId = payload.sub;
                }
                socket.deviceId = socket.handshake.query?.device_id;
                next();
            } catch {
                next(); // Allow anonymous connections
            }
        });

        this.io.on('connection', (socket) => {
            const id = socket.id;
            const key = socket.userId || socket.deviceId || id;
            this.connectedDevices.set(key, { socket, userId: socket.userId, deviceId: socket.deviceId });

            console.log(`[WS] Connected: ${key} (total: ${this.connectedDevices.size})`);

            // Join channels
            socket.on('subscribe:channel', (channelId) => socket.join(`channel:${channelId}`));
            socket.on('unsubscribe:channel', (channelId) => socket.leave(`channel:${channelId}`));

            // Heartbeat for concurrent viewing
            socket.on('viewer:heartbeat', async (data) => {
                if (data?.channelId && socket.sessionId) {
                    try {
                        await db('concurrent_viewers')
                            .where('session_id', socket.sessionId)
                            .update({ last_heartbeat: new Date() });
                    } catch {}
                }
            });

            socket.on('disconnect', () => {
                this.connectedDevices.delete(key);
                console.log(`[WS] Disconnected: ${key} (total: ${this.connectedDevices.size})`);
            });
        });

        console.log('[] WebSocket server initialized');
        return this;
    }

    // ── Event Emitters ─────────────────────────────────────

    /** Emit to all subscribers of a channel */
    toChannel(channelId, event, data) {
        if (!this.io) return;
        this.io.to(`channel:${channelId}`).emit(event, data);
    }

    /** Emit to a specific user */
    toUser(userId, event, data) {
        if (!this.io) return;
        for (const [key, val] of this.connectedDevices) {
            if (val.userId === userId) val.socket.emit(event, data);
        }
    }

    /** Broadcast to all connected clients */
    broadcast(event, data) {
        if (!this.io) return;
        this.io.emit(event, data);
    }

    // ── Specific Event Helpers ─────────────────────────────

    streamOnline(stream) { this.toChannel(stream.channel_id, 'stream:online', stream); }
    streamOffline(stream) { this.toChannel(stream.channel_id, 'stream:offline', stream); }
    channelUpdated(channel) { this.toChannel(channel.id, 'channel:updated', channel); }
    epgUpdated(channelId, data) { this.toChannel(channelId, 'epg:updated', data); }

    /**
     * Emit concurrent viewer count to a channel.
     */
    async updateViewerCount(channelId) {
        if (!this.io) return;
        try {
            const { count } = await db('concurrent_viewers')
                .where({ channel_id: channelId })
                .where('last_heartbeat', '>', new Date(Date.now() - 2 * 60 * 1000))
                .count('* as count')
                .first();
            this.toChannel(channelId, 'viewers:count', { channelId, count: parseInt(count) });
        } catch {}
    }

    /**
     * Get total connected clients.
     */
    getConnectedCount() {
        return this.connectedDevices.size;
    }
}

module.exports = new WebSocketService();
