// A1TV v2 - AI Layer
// Smart search, natural language EPG queries, channel classification, personalized home

const db = require('../config/database');
const cache = require('../services/cache');

class AILayer {
    /**
     * Smart search across channels, programs, and EPG data.
     * Supports natural language queries like "football tonight" or "news in english".
     */
    async smartSearch(query, options = {}) {
        const { countryCode, language, limit = 20, userId } = options;
        const cacheKey = 'ai:search:' + query.toLowerCase().trim() + ':' + (countryCode || 'all') + ':' + limit;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const q = query.toLowerCase().trim();
        const now = new Date();
        const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Parse natural language patterns
        const patterns = this.parseQuery(q);

        // Search programs
        let programQuery = db('programs')
            .select('programs.*', 'channels.name as channel_name', 'channels.logo_url', 'channels.slug as channel_slug')
            .join('channels', 'programs.channel_id', 'channels.id')
            .where('channels.is_active', true)
            .where('programs.start_time', '>=', now)
            .where('programs.start_time', '<=', later);

        // Apply keyword filters
        if (patterns.keywords.length > 0) {
            programQuery = programQuery.where(function () {
                patterns.keywords.forEach(function (kw) {
                    this.orWhereRaw('programs.title ILIKE ?', ['%' + kw + '%']);
                    this.orWhereRaw('programs.description ILIKE ?', ['%' + kw + '%']);
                    this.orWhereRaw('programs.category ILIKE ?', ['%' + kw + '%']);
                }, this);
            });
        }

        // Apply category filter
        if (patterns.category) {
            programQuery = programQuery.where(function () {
                patterns.category.forEach(function (cat) {
                    this.orWhereRaw('programs.category ILIKE ?', ['%' + cat + '%']);
                }, this);
            });
        }

        // Apply time filter
        if (patterns.timeRange) {
            programQuery = programQuery.where('programs.start_time', '>=', patterns.timeRange.start)
                .where('programs.start_time', '<=', patterns.timeRange.end);
        }

        // Apply country filter
        if (patterns.country || countryCode) {
            const cc = patterns.country || countryCode;
            programQuery = programQuery.whereIn('channels.country_id', function () {
                this.select('id').from('countries').where('code', cc);
            });
        }

        // Apply language filter
        if (patterns.language || language) {
            programQuery = programQuery.where('channels.language', patterns.language || language);
        }

        const programs = await programQuery.orderBy('programs.start_time', 'asc').limit(limit);

        // Also search channels by name
        const channels = await db('channels')
            .where('is_active', true)
            .where(function () {
                patterns.keywords.forEach(function (kw) {
                    this.orWhereRaw('name ILIKE ?', ['%' + kw + '%']);
                }, this);
            })
            .limit(Math.floor(limit / 2));

        const result = {
            query,
            patterns,
            programs,
            channels,
            totalResults: programs.length + channels.length,
        };

        await cache.set(cacheKey, result, 120); // 2 min TTL
        return result;
    }

    /**
     * Parse natural language query into structured patterns.
     */
    parseQuery(query) {
        const patterns = {
            keywords: [],
            category: null,
            timeRange: null,
            country: null,
            language: null,
        };

        // Extract keywords (remove common words)
        const stopWords = ['show', 'me', 'find', 'watch', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their'];
        const words = query.split(/\s+/).filter(w => !stopWords.includes(w) && w.length > 1);
        patterns.keywords = words;

        // Detect category
        const categoryMap = {
            'football': ['football', 'soccer', 'premier league', 'la liga', 'serie a', 'bundesliga', 'champions league'],
            'cricket': ['cricket', 'test', 'odi', 't20', 'ipl', 'ashes'],
            'ufc': ['ufc', 'mma', 'fight', 'boxing', 'wrestling'],
            'f1': ['formula 1', 'f1', 'grand prix', 'racing', 'motorsport'],
            'news': ['news', 'breaking', 'update', 'report', 'headlines'],
            'movies': ['movie', 'film', 'cinema', 'premiere', 'blockbuster'],
            'shows': ['show', 'series', 'season', 'episode', 'drama', 'comedy', 'reality'],
            'documentary': ['documentary', 'doc', 'discovery', 'national geographic', 'history'],
            'kids': ['kids', 'children', 'cartoon', 'animation', 'disney', 'nick'],
            'music': ['music', 'concert', 'live music', 'mtv', 'vh1'],
            'sports': ['sports', 'sport', 'match', 'game', 'tournament', 'championship', 'league'],
        };

        for (const [category, keywords] of Object.entries(categoryMap)) {
            if (keywords.some(kw => query.includes(kw))) {
                patterns.category = [category, ...keywords];
                break;
            }
        }

        // Detect time range
        const timePatterns = [
            { pattern: /tonight/i, start: this.getTonightStart(), end: this.getTonightEnd() },
            { pattern: /today/i, start: this.getTodayStart(), end: this.getTodayEnd() },
            { pattern: /tomorrow/i, start: this.getTomorrowStart(), end: this.getTomorrowEnd() },
            { pattern: /this weekend/i, start: this.getWeekendStart(), end: this.getWeekendEnd() },
            { pattern: /this week/i, start: this.getWeekStart(), end: this.getWeekEnd() },
        ];

        for (const tp of timePatterns) {
            if (tp.pattern.test(query)) {
                patterns.timeRange = { start: tp.start, end: tp.end };
                break;
            }
        }

        // Detect country
        const countryPatterns = [
            { pattern: /in (the )?uk/i, code: 'GB' },
            { pattern: /in (the )?us|in (the )?usa/i, code: 'US' },
            { pattern: /in india/i, code: 'IN' },
            { pattern: /in germany/i, code: 'DE' },
            { pattern: /in france/i, code: 'FR' },
            { pattern: /in japan/i, code: 'JP' },
            { pattern: /in brazil/i, code: 'BR' },
            { pattern: /in australia/i, code: 'AU' },
        ];

        for (const cp of countryPatterns) {
            if (cp.pattern.test(query)) {
                patterns.country = cp.code;
                break;
            }
        }

        // Detect language
        const langPatterns = [
            { pattern: /in english/i, code: 'en' },
            { pattern: /in spanish/i, code: 'es' },
            { pattern: /in french/i, code: 'fr' },
            { pattern: /in german/i, code: 'de' },
            { pattern: /in arabic/i, code: 'ar' },
            { pattern: /in hindi/i, code: 'hi' },
            { pattern: /in japanese/i, code: 'ja' },
        ];

        for (const lp of langPatterns) {
            if (lp.pattern.test(query)) {
                patterns.language = lp.code;
                break;
            }
        }

        return patterns;
    }

    /**
     * Auto-classify channels based on their content.
     */
    async classifyChannel(channelId) {
        const programs = await db('programs')
            .where({ channel_id: channelId })
            .where('start_time', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .select('title', 'category', 'description');

        if (!programs.length) return { categories: [], tags: [] };

        // Count category occurrences
        const categoryCounts = {};
        const tagCounts = {};

        for (const p of programs) {
            if (p.category) {
                categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
            }

            // Extract tags from title
            const titleWords = (p.title || '').toLowerCase().split(/\s+/);
            const tagWords = ['live', 'hd', '4k', 'premiere', 'exclusive', 'final', 'championship', 'playoff', 'semifinal', 'quarterfinal'];
            for (const word of titleWords) {
                if (tagWords.includes(word)) {
                    tagCounts[word] = (tagCounts[word] || 0) + 1;
                }
            }
        }

        // Sort by frequency
        const sortedCategories = Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([cat]) => cat);

        const sortedTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag]) => tag);

        // Store classification
        await db('channels').where('id', channelId).update({
            metadata: db.raw('metadata || \'{"ai_classification":{"categories":' + JSON.stringify(sortedCategories) + ',"tags":' + JSON.stringify(sortedTags) + ',"classified_at":"' + new Date().toISOString() + '"}}\'::jsonb'),
        });

        return { categories: sortedCategories, tags: sortedTags };
    }

    /**
     * Generate personalized home screen for a user.
     */
    async generatePersonalizedHome(userId, options = {}) {
        const cacheKey = 'ai:home:' + userId;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        // Get user preferences
        const user = await db('users').where('id', userId).first();
        const prefs = user?.preferences || {};

        // Get recently watched
        const recent = await db('watch_history')
            .select('channels.id', 'channels.name', 'channels.logo_url', 'channels.slug')
            .join('channels', 'watch_history.channel_id', 'channels.id')
            .where('watch_history.user_id', userId)
            .orderBy('watch_history.started_at', 'desc')
            .limit(5);

        // Get continue watching (started but not finished)
        const continueWatching = await db('watch_history')
            .select('channels.id', 'channels.name', 'channels.logo_url', 'watch_history.duration as watched_duration')
            .join('channels', 'watch_history.channel_id', 'channels.id')
            .where('watch_history.user_id', userId)
            .whereNull('watch_history.ended_at')
            .where('watch_history.started_at', '>', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            .orderBy('watch_history.started_at', 'desc')
            .limit(5);

        // Get recommended based on watch history
        const topCategories = await db('watch_history')
            .join('channels', 'watch_history.channel_id', 'channels.id')
            .where('watch_history.user_id', userId)
            .where('watch_history.started_at', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
            .select('channels.category_id', db.raw('COUNT(*) as count'))
            .groupBy('channels.category_id')
            .orderBy('count', 'desc')
            .limit(3);

        const categoryIds = topCategories.map(c => c.category_id).filter(Boolean);
        let recommended = [];
        if (categoryIds.length > 0) {
            recommended = await db('channels')
                .where('is_active', true)
                .whereIn('category_id', categoryIds)
                .whereNotIn('id', recent.map(r => r.id))
                .orderBy('view_count', 'desc')
                .limit(10);
        }

        // Now playing
        const nowPlaying = await db('programs')
            .select('programs.*', 'channels.name as channel_name', 'channels.logo_url')
            .join('channels', 'programs.channel_id', 'channels.id')
            .where('channels.is_active', true)
            .where('programs.start_time', '<=', new Date())
                .where('programs.end_time', '>', new Date())
                .orderByRaw('RANDOM()')
                .limit(8);

        const result = {
            continueWatching,
            recentlyWatched: recent,
            recommended,
            nowPlaying,
            generatedAt: new Date().toISOString(),
        };

        await cache.set(cacheKey, result, 300);
        return result;
    }

    // Time helpers
    getTodayStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    getTodayEnd() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
    getTonightStart() { const d = new Date(); d.setHours(18, 0, 0, 0); return d; }
    getTonightEnd() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
    getTomorrowStart() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d; }
    getTomorrowEnd() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(23, 59, 59, 999); return d; }
    getWeekendStart() { const d = new Date(); d.setDate(d.getDate() + (6 - d.getDay())); d.setHours(0, 0, 0, 0); return d; }
    getWeekendEnd() { const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay())); d.setHours(23, 59, 59, 999); return d; }
    getWeekStart() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; }
    getWeekEnd() { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(23, 59, 59, 999); return d; }
}

module.exports = new AILayer();
