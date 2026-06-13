// A1TV v2 - Recommendation Engine v1
// Trending formula, similar channels, personalized feed

const db = require('../config/database');

class RecommendationEngine {
    /**
     * Calculate trending score for a channel.
     * Formula: viewer_count + (growth_rate * 10) + (watch_time_factor * 5)
     */
    async calculateTrendingScore(channelId, period = '24h') {
        const interval = period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours';
        const now = new Date();
        const periodStart = new Date(now.getTime() - (period === '7d' ? 7 : period === '30d' ? 30 : 1) * 24 * 60 * 60 * 1000);
        const previousPeriodStart = new Date(periodStart.getTime() - (period === '7d' ? 7 : period === '30d' ? 30 : 1) * 24 * 60 * 60 * 1000);

        const [current, previous, watchStats] = await Promise.all([
            db('channel_views').where({ channel_id: channelId }).where('viewed_at', '>=', periodStart).count('* as count').first(),
            db('channel_views').where({ channel_id: channelId }).where('viewed_at', '>=', previousPeriodStart).where('viewed_at', '<', periodStart).count('* as count').first(),
            db('watch_history').where({ channel_id: channelId }).where('started_at', '>=', periodStart).select(db.raw('SUM(duration) as total_duration'), db.raw('AVG(duration) as avg_duration')).first(),
        ]);

        const currentViews = parseInt(current?.count) || 0;
        const previousViews = parseInt(previous?.count) || 0;
        const totalDuration = parseInt(watchStats?.total_duration) || 0;
        const avgDuration = parseInt(watchStats?.avg_duration) || 0;

        // Growth rate (percentage)
        const growthRate = previousViews > 0 ? ((currentViews - previousViews) / previousViews) * 100 : 0;

        // Watch time factor (normalized, 0-100)
        const watchTimeFactor = Math.min(100, avgDuration / 60); // 1 minute = 1 point, max 100

        // Trending score
        const score = Math.round(
            currentViews +
            (growthRate * 10) +
            (watchTimeFactor * 5)
        );

        return { score, currentViews, previousViews, growthRate: growthRate.toFixed(1), watchTimeFactor: watchTimeFactor.toFixed(1) };
    }

    /**
     * Get trending channels.
     */
    async getTrending(period = '24h', limit = 20) {
        const cacheKey = 'rec:trending:' + period + ':' + limit;
        const cached = await require('../services/cache').get(cacheKey);
        if (cached) return cached;

        // Get top channels by views
        const interval = period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours';
        const topChannels = await db('channels')
            .select('channels.id', 'channels.name', 'channels.slug', 'channels.logo_url', 'cat.name as category_name', 'co.name as country_name')
            .leftJoin('categories cat', 'channels.category_id', 'cat.id')
            .leftJoin('countries co', 'channels.country_id', 'co.id')
            .where('channels.is_active', true)
            .orderBy('channels.view_count', 'desc')
            .limit(limit * 3);

        // Calculate trending scores
        const scored = [];
        for (const ch of topChannels) {
            const trending = await this.calculateTrendingScore(ch.id, period);
            scored.push({ ...ch, ...trending });
        }

        scored.sort((a, b) => b.score - a.score);
        const result = scored.slice(0, limit);

        await require('../services/cache').set(cacheKey, result, 300);
        return result;
    }

    /**
     * Get similar channels based on country, category, and viewer overlap.
     */
    async getSimilar(channelId, limit = 10) {
        const cacheKey = 'rec:similar:' + channelId + ':' + limit;
        const cached = await require('../services/cache').get(cacheKey);
        if (cached) return cached;

        const channel = await db('channels').where('id', channelId).first();
        if (!channel) return [];

        // Same category + country
        const similar = await db('channels')
            .select('channels.id', 'channels.name', 'channels.slug', 'channels.logo_url', 'cat.name as category_name')
            .leftJoin('categories cat', 'channels.category_id', 'cat.id')
            .where('channels.id', '!=', channelId)
            .where('channels.is_active', true)
            .where(function () {
                if (channel.category_id) this.orWhere('channels.category_id', channel.category_id);
                if (channel.country_id) this.orWhere('channels.country_id', channel.country_id);
            })
            .orderBy('channels.view_count', 'desc')
            .limit(limit);

        // Co-watch based
        const coWatch = await db('co_watch_stats')
            .select('channel_b_id as id')
            .where('channel_a_id', channelId)
            .orderBy('watch_count', 'desc')
            .limit(limit);

        // Merge and deduplicate
        const seen = new Set(similar.map(s => s.id));
        for (const cw of coWatch) {
            if (!seen.has(cw.id)) {
                const ch = await db('channels').where('id', cw.id).first();
                if (ch) { similar.push(ch); seen.add(ch.id); }
            }
        }

        const result = similar.slice(0, limit);
        await require('../services/cache').set(cacheKey, result, 600);
        return result;
    }

    /**
     * Generate personalized feed for a user.
     */
    async getPersonalized(userId, limit = 20) {
        const cacheKey = 'rec:personal:' + userId + ':' + limit;
        const cached = await require('../services/cache').get(cacheKey);
        if (cached) return cached;

        // Get user's watch history categories
        const userCategories = await db('watch_history')
            .join('channels', 'watch_history.channel_id', 'channels.id')
            .where('watch_history.user_id', userId)
            .where('watch_history.started_at', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .select('channels.category_id', db.raw('COUNT(*) as watch_count'))
            .groupBy('channels.category_id')
            .orderBy('watch_count', 'desc')
            .limit(5);

        const categoryIds = userCategories.map(c => c.category_id).filter(Boolean);

        // Get user's favorite channels
        const favorites = await db('favorites').where('user_id', userId).select('channel_id');
        const favIds = favorites.map(f => f.channel_id);

        // Recommend: popular channels in user's favorite categories, excluding already watched
        const watched = await db('watch_history').where('user_id', userId).select('channel_id');
        const watchedIds = watched.map(w => w.channel_id);

        let recommendations = [];
        if (categoryIds.length > 0) {
            recommendations = await db('channels')
                .select('channels.id', 'channels.name', 'channels.slug', 'channels.logo_url', 'cat.name as category_name')
                .leftJoin('categories cat', 'channels.category_id', 'cat.id')
                .where('channels.is_active', true)
                .whereIn('channels.category_id', categoryIds)
                .whereNotIn('channels.id', watchedIds.length ? watchedIds : ['00000000-0000-0000-0000-000000000000'])
                .orderBy('channels.view_count', 'desc')
                .limit(limit);
        }

        // Fallback: popular channels if no personalized recs
        if (recommendations.length < limit) {
            const additional = await db('channels')
                .select('channels.id', 'channels.name', 'channels.slug', 'channels.logo_url')
                .where('channels.is_active', true)
                .whereNotIn('channels.id', [...watchedIds, ...recommendations.map(r => r.id)])
                .orderBy('channels.view_count', 'desc')
                .limit(limit - recommendations.length);
            recommendations = [...recommendations, ...additional];
        }

        await require('../services/cache').set(cacheKey, recommendations, 300);
        return recommendations;
    }

    /**
     * Regenerate all recommendations (daily cron).
     */
    async regenerateAll() {
        console.log('[RecEngine] Regenerating all recommendations...');
        const channels = await db('channels').where('is_active', true).select('id');
        for (const ch of channels) {
            try {
                await this.getSimilar(ch.id);
            } catch (e) {}
        }
        console.log('[RecEngine] Done for ' + channels.length + ' channels');
    }
}

module.exports = new RecommendationEngine();
