// ============================================================
// A1TV v2 — Edge Cache Service
// Caches m3u8 playlists, EPG data, logos, and channel metadata
// in Redis for fast access and reduced origin load.
// ============================================================

const axios = require('axios');
const db = require('../config/database');
const cache = require('../services/cache');
const config = require('../config');

class EdgeCacheService {
    constructor() {
        this.ttl = {
            playlist: 60,        // 1 minute for live playlists
            epg: 900,            // 15 minutes for EPG
            logo: 86400,         // 24 hours for logos
            channelMeta: 300,    // 5 minutes for channel metadata
            streamHealth: 30,    // 30 seconds for stream health
        };
    }

    /**
     * Get or fetch an m3u8 playlist.
     * Caches in Redis to reduce origin load.
     */
    async getPlaylist(url) {
        const cacheKey = `playlist:${this.hashUrl(url)}`;

        // Try cache first
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        // Fetch from origin
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                responseType: 'text',
                headers: {
                    'User-Agent': 'A1TV-EdgeCache/2.0',
                    'Accept': 'application/vnd.apple.mpegurl, audio/mpegurl, */*',
                },
                maxContentLength: 256 * 1024,
            });

            const data = response.data;

            // Cache the playlist
            await cache.set(cacheKey, data, this.ttl.playlist);

            return data;
        } catch (err) {
            console.warn('[EdgeCache] Playlist fetch failed:', url, err.message);
            return null;
        }
    }

    /**
     * Get or fetch EPG data for a channel.
     */
    async getEPG(channelId) {
        const cacheKey = `epg:${channelId}`;

        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        // Fetch from database (already cached from EPG collector)
        const now = new Date();
        const programs = await db('programs')
            .where({ channel_id: channelId })
            .where('end_time', '>', now)
            .where('start_time', '<', new Date(now.getTime() + 24 * 60 * 60 * 1000))
            .orderBy('start_time', 'asc')
            .limit(50);

        const result = {
            channelId,
            programs,
            cachedAt: now.toISOString(),
        };

        await cache.set(cacheKey, result, this.ttl.epg);
        return result;
    }

    /**
     * Get or fetch channel metadata.
     */
    async getChannelMeta(channelId) {
        const cacheKey = `chmeta:${channelId}`;

        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const channel = await db('v_channels_enriched')
            .where('id', channelId)
            .first();

        if (!channel) return null;

        const result = {
            id: channel.id,
            name: channel.name,
            slug: channel.slug,
            logoUrl: channel.logo_url,
            categoryName: channel.category_name,
            categorySlug: channel.category_slug,
            countryName: channel.country_name,
            countryCode: channel.country_code,
            countryFlag: channel.country_flag,
            isFeatured: channel.is_featured,
            isVerified: channel.is_verified,
            isLive: channel.online_streams > 0,
            bestStream: channel.best_stream,
            currentProgram: channel.current_program,
            nextProgram: channel.next_program,
            onlineStreams: channel.online_streams,
            totalStreams: channel.total_streams,
            viewCount: channel.view_count,
            favoriteCount: channel.favorite_count,
        };

        await cache.set(cacheKey, result, this.ttl.channelMeta);
        return result;
    }

    /**
     * Get or fetch stream health data.
     */
    async getStreamHealth(streamId) {
        const cacheKey = `streamhealth:${streamId}`;

        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const stream = await db('streams')
            .where('id', streamId)
            .select('id', 'status', 'score', 'response_time', 'uptime_pct', 'success_rate', 'last_checked')
            .first();

        if (!stream) return null;

        await cache.set(cacheKey, stream, this.ttl.streamHealth);
        return stream;
    }

    /**
     * Preload cache for popular channels.
     * Called by a background worker every 5 minutes.
     */
    async preloadPopularChannels() {
        console.log('[EdgeCache] Preloading popular channels...');

        const popular = await db('channels')
            .where('is_active', true)
            .orderBy('view_count', 'desc')
            .limit(50)
            .select('id');

        let loaded = 0;
        for (const ch of popular) {
            try {
                await this.getChannelMeta(ch.id);
                await this.getEPG(ch.id);
                loaded++;
            } catch (err) {
                console.warn('[EdgeCache] Preload failed for', ch.id, err.message);
            }
        }

        console.log(`[EdgeCache] Preloaded ${loaded}/${popular.length} channels`);
        return loaded;
    }

    /**
     * Invalidate cache for a channel.
     * Called when channel data changes.
     */
    async invalidateChannel(channelId) {
        await cache.del(`chmeta:${channelId}`);
        await cache.del(`epg:${channelId}`);
        console.log(`[EdgeCache] Invalidated cache for channel ${channelId}`);
    }

    /**
     * Invalidate all playlist caches.
     * Called when sync completes.
     */
    async invalidatePlaylists() {
        await cache.delPattern('playlist:*');
        console.log('[EdgeCache] Invalidated all playlist caches');
    }

    /**
     * Get cache statistics.
     */
    async getStats() {
        const keys = {
            playlists: await cache.redis?.keys('a1tv:playlist:*') || [],
            epg: await cache.redis?.keys('a1tv:epg:*') || [],
            channelMeta: await cache.redis?.keys('a1tv:chmeta:*') || [],
            streamHealth: await cache.redis?.keys('a1tv:streamhealth:*') || [],
        };

        return {
            playlists: keys.playlists.length,
            epg: keys.epg.length,
            channelMeta: keys.channelMeta.length,
            streamHealth: keys.streamHealth.length,
            ttl: this.ttl,
        };
    }

    hashUrl(url) {
        return require('crypto').createHash('md5').update(url).digest('hex');
    }
}

module.exports = new EdgeCacheService();
