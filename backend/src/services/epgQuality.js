// ============================================================
// A1TV v2 — EPG Quality Scoring Service
// Scores each EPG source per channel for coverage, accuracy,
// and update frequency. Helps select the best source.
// ============================================================

const db = require('../config/database');

class EPGQualityService {
    /**
     * Score all EPG sources for a specific channel.
     * Run periodically (every 6 hours).
     */
    async scoreChannelEpg(channelId) {
        const sources = await db('epg_sources').where('is_active', true);

        for (const source of sources) {
            const programs = await db('programs')
                .where({ channel_id: channelId, epg_source_id: source.id })
                .where('start_time', '>', new Date())
                .where('start_time', '<', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

            const programCount = programs.length;

            // Coverage: how many of the next 7 days have programs
            const daysWithPrograms = new Set(
                programs.map(p => new Date(p.start_time).toDateString())
            ).size;
            const coveragePct = Math.min(100, (daysWithPrograms / 7) * 100);

            // Accuracy: check for common issues
            let accuracyPct = 100;
            const issues = [];

            // Check for overlapping programs
            const sorted = [...programs].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
            for (let i = 1; i < sorted.length; i++) {
                if (new Date(sorted[i].start_time) < new Date(sorted[i - 1].end_time)) {
                    accuracyPct -= 5;
                    issues.push('overlapping_programs');
                }
            }

            // Check for empty titles
            const emptyTitles = programs.filter(p => !p.title || p.title.trim().length < 2).length;
            if (emptyTitles > 0) {
                accuracyPct -= emptyTitles * 2;
                issues.push(`${emptyTitles}_empty_titles`);
            }

            accuracyPct = Math.max(0, accuracyPct);

            // Update frequency: time between fetches
            const lastTwo = await db('programs')
                .where({ epg_source_id: source.id })
                .distinct(db.raw("date_trunc('hour', created_at) as fetch_hour"))
                .orderBy('fetch_hour', 'desc')
                .limit(2);

            let updateFreq = 0;
            if (lastTwo.length === 2) {
                const diff = new Date(lastTwo[0].fetch_hour) - new Date(lastTwo[1].fetch_hour);
                updateFreq = Math.round(diff / (60 * 60 * 1000)); // hours
            }

            // Overall quality score
            const qualityScore = Math.round(
                coveragePct * 0.4 +
                accuracyPct * 0.4 +
                Math.min(100, programCount * 2) * 0.2
            );

            await db('epg_channel_quality')
                .insert({
                    channel_id: channelId,
                    epg_source_id: source.id,
                    coverage_pct: coveragePct,
                    accuracy_pct: accuracyPct,
                    program_count: programCount,
                })
                .onConflict(['channel_id', 'epg_source_id'])
                .merge(['coverage_pct', 'accuracy_pct', 'program_count', 'last_check']);

            // Update source-level aggregate
            await db('epg_sources').where('id', source.id).update({
                quality_score: db.raw('(SELECT AVG(coverage_pct) FROM epg_channel_quality WHERE epg_source_id = epg_sources.id)'),
                coverage_pct: db.raw('(SELECT AVG(coverage_pct) FROM epg_channel_quality WHERE epg_source_id = epg_sources.id)'),
                accuracy_pct: db.raw('(SELECT AVG(accuracy_pct) FROM epg_channel_quality WHERE epg_source_id = epg_sources.id)'),
                update_frequency_minutes: updateFreq,
                last_quality_check: new Date(),
            });
        }
    }

    /**
     * Get the best EPG source for a channel.
     */
    async getBestSource(channelId) {
        return db('epg_channel_quality')
            .where({ channel_id: channelId })
            .orderByRaw('(coverage_pct * 0.4 + accuracy_pct * 0.4 + LEAST(100, program_count * 2) * 0.2) DESC')
            .first();
    }

    /**
     * Score all channels (run daily).
     */
    async scoreAll() {
        const channels = await db('channels').where('is_active', true).select('id');
        for (const ch of channels) {
            await this.scoreChannelEpg(ch.id);
        }
        console.log(`[EPG] Scored EPG quality for ${channels.length} channels`);
    }
}

module.exports = new EPGQualityService();
