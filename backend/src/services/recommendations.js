// ============================================================
// A1TV v2 — Recommendation Engine
// Generates channel recommendations based on:
// - Co-watch patterns (channels watched together)
// - Same category/country
// - Trending/popular
// - Search similarity
// ============================================================

const db = require('../config/database');

class RecommendationEngine {
    /**
     * Record a co-watch event (user watched channel A then B).
     */
    async recordCoWatch(channelA, channelB) {
        if (channelA === channelB) return;
        const [a, b] = channelA < channelB ? [channelA, channelB] : [channelB, channelA];
        await db.raw(`
            INSERT INTO co_watch_stats (channel_a_id, channel_b_id, watch_count, last_updated)
            VALUES (?, ?, 1, NOW())
            ON CONFLICT (channel_a_id, channel_b_id)
            DO UPDATE SET watch_count = co_watch_stats.watch_count + 1, last_updated = NOW()
        `, [a, b]);
    }

    /**
     * Generate recommendations for a channel.
     */
    async generateForChannel(channelId) {
        // 1. Co-watch based
        await db.raw(`
            INSERT INTO channel_recommendations (source_channel_id, recommended_channel_id, score, reason)
            SELECT ?, cw.channel_b_id, LEAST(100, cw.watch_count * 5), 'co_watch'
            FROM co_watch_stats cw
            WHERE cw.channel_a_id = ?
            AND NOT EXISTS (
                SELECT 1 FROM channel_recommendations cr
                WHERE cr.source_channel_id = ? AND cr.recommended_channel_id = cw.channel_b_id AND cr.reason = 'co_watch'
            )
            ON CONFLICT (source_channel_id, recommended_channel_id, reason) DO UPDATE
            SET score = LEAST(100, EXCLUDED.score), metadata = EXCLUDED.metadata
        `, [channelId, channelId, channelId]);

        await db.raw(`
            INSERT INTO channel_recommendations (source_channel_id, recommended_channel_id, score, reason)
            SELECT ?, cw.channel_a_id, LEAST(100, cw.watch_count * 5), 'co_watch'
            FROM co_watch_stats cw
            WHERE cw.channel_b_id = ?
            AND NOT EXISTS (
                SELECT 1 FROM channel_recommendations cr
                WHERE cr.source_channel_id = ? AND cr.recommended_channel_id = cw.channel_a_id AND cr.reason = 'co_watch'
            )
            ON CONFLICT (source_channel_id, recommended_channel_id, reason) DO UPDATE
            SET score = LEAST(100, EXCLUDED.score)
        `, [channelId, channelId, channelId]);

        // 2. Same category
        await db.raw(`
            INSERT INTO channel_recommendations (source_channel_id, recommended_channel_id, score, reason)
            SELECT ?, c2.id, 50 + LEAST(40, c2.view_count / 100), 'same_category'
            FROM channels c1
            JOIN channels c2 ON c1.category_id = c2.category_id AND c1.id != c2.id
            WHERE c1.id = ? AND c2.is_active = true
            AND NOT EXISTS (
                SELECT 1 FROM channel_recommendations cr
                WHERE cr.source_channel_id = ? AND cr.recommended_channel_id = c2.id AND cr.reason = 'same_category'
            )
            ON CONFLICT (source_channel_id, recommended_channel_id, reason) DO UPDATE
            SET score = EXCLUDED.score
        `, [channelId, channelId, channelId]);

        // 3. Same country
        await db.raw(`
            INSERT INTO channel_recommendations (source_channel_id, recommended_channel_id, score, reason)
            SELECT ?, c2.id, 40 + LEAST(30, c2.view_count / 200), 'same_country'
            FROM channels c1
            JOIN channels c2 ON c1.country_id = c2.country_id AND c1.id != c2.id
            WHERE c1.id = ? AND c2.is_active = true
            AND NOT EXISTS (
                SELECT 1 FROM channel_recommendations cr
                WHERE cr.source_channel_id = ? AND cr.recommended_channel_id = c2.id AND cr.reason = 'same_country'
            )
            ON CONFLICT (source_channel_id, recommended_channel_id, reason) DO UPDATE
            SET score = EXCLUDED.score
        `, [channelId, channelId, channelId]);
    }

    /**
     * Get recommendations for a channel.
     */
    async getRecommendations(channelId, limit = 10) {
        return db('channel_recommendations')
            .where({ source_channel_id: channelId })
            .orderBy('score', 'desc')
            .limit(limit);
    }

    /**
     * Get trending channels.
     */
    async getTrending(limit = 20) {
        return db.raw(`
            SELECT c.id, c.name, c.slug, c.logo_url, cat.name as category_name,
                COUNT(cv.id) as views_24h,
                COUNT(DISTINCT cv.device_id) as unique_viewers
            FROM channels c
            LEFT JOIN channel_views cv ON c.id = cv.channel_id AND cv.viewed_at > NOW() - INTERVAL '24 hours'
            LEFT JOIN categories cat ON c.category_id = cat.id
            WHERE c.is_active = true
            GROUP BY c.id, cat.name
            HAVING COUNT(cv.id) > 0
            ORDER BY unique_viewers DESC, views_24h DESC
            LIMIT ?
        `, [limit]);
    }

    /**
     * Regenerate all recommendations (run daily).
     */
    async regenerateAll() {
        console.log('[Recs] Regenerating all recommendations...');
        const channels = await db('channels').where('is_active', true).select('id');
        for (const ch of channels) {
            await this.generateForChannel(ch.id);
        }
        console.log(`[Recs] Generated recommendations for ${channels.length} channels`);
    }
}

module.exports = new RecommendationEngine();
