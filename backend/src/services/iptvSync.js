// ============================================================
// A1TV v2 — Multi-Source IPTV Sync Service
// Sources: IPTV-Org API, Free-TV/IPTV GitHub, Manual Verified
// ============================================================

const axios = require('axios');
const db = require('../config/database');
const config = require('../config');

class IPTVSyncService {
    constructor() {
        this.iptvBase = 'https://iptv-org.github.io/api';
        this.freeTvBase = 'https://raw.githubusercontent.com/Free-TV/IPTV/master';
        this.timeout = 30000;
        this.batchSize = 500;
        this.stats = { channels: 0, streams: 0, categories: 0, countries: 0, errors: 0 };
    }

    async syncAll() {
        console.log('[Sync] Starting multi-source IPTV sync...');
        const start = Date.now();
        this.stats = { channels: 0, streams: 0, categories: 0, countries: 0, duplicates: 0, errors: 0 };

        try {
            await this.syncIPTVOrg();
            await this.syncFreeTV();
            await this.syncVerifiedChannels();
            await this.deduplicateChannels();

            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(`[Sync] Complete in ${elapsed}s:`, JSON.stringify(this.stats));
            return { ...this.stats, elapsed: elapsed + 's' };
        } catch (err) {
            console.error('[Sync] Failed:', err.message);
            throw err;
        }
    }

    // ── Source 1: IPTV-Org API ─────────────────────────────
    async syncIPTVOrg() {
        console.log('[Sync] Fetching IPTV-Org data...');
        const [channels, streams, categories, countries] = await Promise.all([
            this.fetchJSON(`${this.iptvBase}/channels.json`),
            this.fetchJSON(`${this.iptvBase}/streams.json`),
            this.fetchJSON(`${this.iptvBase}/categories.json`),
            this.fetchJSON(`${this.iptvBase}/countries.json`),
        ]);

        const sourceId = await this.getSourceId('iptv-org');
        await this.upsertCountries(countries);
        await this.upsertIPTVOrgCategories(categories);
        await this.upsertIPTVOrgChannels(channels, sourceId);
        await this.upsertIPTVOrgStreams(streams, sourceId);
        console.log(`[Sync] IPTV-Org: ${channels.length} channels, ${streams.length} streams`);
    }

    async fetchJSON(url) {
        try {
            const res = await axios.get(url, { timeout: this.timeout, responseType: 'json' });
            return res.data || [];
        } catch (err) {
            console.warn(`[Sync] Fetch failed: ${url} — ${err.message}`);
            this.stats.errors++;
            return [];
        }
    }

    async getSourceId(name) {
        const row = await db('sources').where('name', name).first();
        return row?.id;
    }

    async upsertCountries(countries) {
        if (!countries.length) return;
        const trx = await db.transaction();
        try {
            for (const c of countries) {
                await trx('countries').insert({ code: c.code?.toUpperCase(), name: c.name, flag: c.flag || this.flagEmoji(c.code), language: c.languages?.[0] || null })
                    .onConflict('code').merge(['name', 'flag', 'language']);
                this.stats.countries++;
            }
            await trx.commit();
        } catch (err) { await trx.rollback(); throw err; }
    }

    async upsertIPTVOrgCategories(categories) {
        if (!categories.length) return;
        const trx = await db.transaction();
        try {
            for (const cat of categories) {
                const slug = cat.id || this.slugify(cat.name);
                await trx('categories').insert({ name: cat.name, slug, description: cat.description || null })
                    .onConflict('slug').merge(['name', 'description', 'updated_at']);
                this.stats.categories++;
            }
            await trx.commit();
        } catch (err) { await trx.rollback(); throw err; }
    }

    async upsertIPTVOrgChannels(channels, sourceId) {
        if (!channels.length) return;
        const trx = await db.transaction();
        try {
            for (let i = 0; i < channels.length; i += this.batchSize) {
                const batch = channels.slice(i, i + this.batchSize);
                for (const ch of batch) {
                    const country = ch.country ? await trx('countries').where('code', ch.country.toUpperCase()).first() : null;
                    const catRef = ch.categories?.[0];
                    const catSlug = typeof catRef === 'string' ? catRef : (catRef?.id || '');
                    const category = catSlug ? await trx('categories').where('slug', catSlug).first() : null;
                    const slug = this.slugify(ch.name) + '-' + ch.id.substring(0, 8);
                    await trx('channels').insert({
                        source_id: sourceId, external_id: ch.id, name: ch.name,
                        alt_names: ch.alt_names?.length ? ch.alt_names : null,
                        slug, logo_url: ch.logo || null,
                        country_id: country?.id, category_id: category?.id,
                        language: ch.language || null, is_nsfw: ch.is_nsfw || false,
                        website: ch.website || null, last_synced_at: new Date(),
                    }).onConflict(['source_id', 'external_id']).merge([
                        'name', 'alt_names', 'logo_url', 'country_id', 'category_id',
                        'language', 'website', 'last_synced_at',
                    ]);
                    this.stats.channels++;
                }
            }
            await trx.commit();
        } catch (err) { await trx.rollback(); throw err; }
    }

    async upsertIPTVOrgStreams(streams, sourceId) {
        if (!streams.length) return;
        const trx = await db.transaction();
        try {
            for (let i = 0; i < streams.length; i += this.batchSize) {
                const batch = streams.slice(i, i + this.batchSize);
                for (const s of batch) {
                    if (!s.channel || !s.url) continue;
                    const channel = await trx('channels').where({ source_id: sourceId, external_id: s.channel }).first();
                    if (!channel) continue;
                    const quality = this.extractQuality(s.url) || s.quality || null;
                    await trx('streams').insert({
                        channel_id: channel.id, source_id: sourceId, url: s.url,
                        quality, label: s.label || null,
                        metadata: { title: s.title || null, user_agent: s.user_agent || null, referrer: s.referrer || null },
                    }).onConflict(['channel_id', 'url']).merge(['quality', 'label', 'metadata', 'updated_at']);
                    this.stats.streams++;
                }
            }
            await trx.commit();
        } catch (err) { await trx.rollback(); throw err; }
    }

    // ── Source 2: Free-TV/IPTV GitHub ──────────────────────
    async syncFreeTV() {
        console.log('[Sync] Fetching Free-TV/IPTV data...');
        const sourceId = await this.getSourceId('free-tv');
        const playlists = [
            `${this.freeTvBase}/playlist.m3u`,
            `${this.freeTvBase}/countries/us.m3u`,
            `${this.freeTvBase}/countries/gb.m3u`,
            `${this.freeTvBase}/countries/de.m3u`,
            `${this.freeTvBase}/countries/fr.m3u`,
            `${this.freeTvBase}/categories/sports.m3u`,
            `${this.freeTvBase}/categories/news.m3u`,
        ];

        for (const url of playlists) {
            try {
                const res = await axios.get(url, { timeout: this.timeout, responseType: 'text' });
                if (res.status === 200 && res.data) {
                    const channels = this.parseM3U(res.data);
                    await this.upsertFreeTVChannels(channels, sourceId);
                }
            } catch (err) {
                console.warn(`[Sync] Free-TV fetch failed: ${url}`);
                this.stats.errors++;
            }
        }
    }

    parseM3U(text) {
        const channels = [];
        const lines = text.split('\n');
        let current = null;
        for (const line of lines) {
            const l = line.trim();
            if (l.startsWith('#EXTINF:')) {
                current = { streamUrl: '', raw: l };
                const logoMatch = l.match(/tvg-logo="([^"]*)"/);
                current.logo = logoMatch ? logoMatch[1] : '';
                const groupMatch = l.match(/group-title="([^"]*)"/);
                current.group = groupMatch ? groupMatch[1] : 'General';
                const nameMatch = l.match(/,(.+)$/);
                current.name = nameMatch ? nameMatch[1].trim() : `Channel ${channels.length + 1}`;
            } else if (l && !l.startsWith('#') && current) {
                current.streamUrl = l;
                channels.push(current);
                current = null;
            }
        }
        return channels;
    }

    async upsertFreeTVChannels(channels, sourceId) {
        if (!channels.length) return;
        const trx = await db.transaction();
        try {
            for (const ch of channels) {
                const slug = this.slugify(ch.name) + '-ftv-' + Math.random().toString(36).substring(2, 8);
                const category = await trx('categories').where('slug', this.slugify(ch.group)).first();
                const channelResult = await trx('channels').insert({
                    source_id: sourceId, name: ch.name, slug,
                    logo_url: ch.logo || null, category_id: category?.id,
                    last_synced_at: new Date(),
                }).onConflict('slug').merge(['name', 'logo_url', 'last_synced_at'])
                    .returning('id');
                const channelId = Array.isArray(channelResult) ? channelResult[0]?.id || channelResult[0] : channelResult?.id;
                if (channelId && ch.streamUrl) {
                    await trx('streams').insert({
                        channel_id: channelId, source_id: sourceId, url: ch.streamUrl,
                        quality: this.extractQuality(ch.streamUrl),
                    }).onConflict(['channel_id', 'url']).merge(['quality', 'updated_at']);
                    this.stats.streams++;
                }
                this.stats.channels++;
            }
            await trx.commit();
        } catch (err) { await trx.rollback(); throw err; }
    }

    // ── Source 3: Manual Verified Channels ─────────────────
    async syncVerifiedChannels() {
        console.log('[Sync] Syncing verified channels...');
        const sourceId = await this.getSourceId('manual');
        const verified = [
            { extId: 'nasa-tv', name: 'NASA TV', slug: 'nasa-tv', logo: 'https://www.nasa.gov/wp-content/uploads/2023/09/nasa-logo.svg', countryCode: 'US', catSlug: 'science', streamUrl: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8', quality: '1080p' },
            { extId: 'dw', name: 'DW', slug: 'dw', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_logo.svg/200px-Deutsche_Welle_logo.svg.png', countryCode: 'DE', catSlug: 'news', streamUrl: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8', quality: '720p' },
            { extId: 'france24-en', name: 'France 24 English', slug: 'france-24-en', logo: 'https://www.france24.com/bundles/france24front/img/logo-france24.png', countryCode: 'FR', catSlug: 'news', streamUrl: 'https://www.france24.com/en/live', quality: '720p' },
            { extId: 'nhk-world', name: 'NHK World', slug: 'nhk-world', logo: 'https://www.nhk.or.jp/nhkworld/assets/images/common/logo.png', countryCode: 'JP', catSlug: 'news', streamUrl: 'https://nhkwlive-ojp.akamaized.net/hls/live/2003459/nhkwlive-ojp-en/index.m3u8', quality: '720p' },
        ];

        const trx = await db.transaction();
        try {
            for (const v of verified) {
                const country = await trx('countries').where('code', v.countryCode).first();
                const category = await trx('categories').where('slug', v.catSlug).first();
                const result = await trx('channels').insert({
                    source_id: sourceId, external_id: v.extId, name: v.name, slug: v.slug,
                    logo_url: v.logo, country_id: country?.id, category_id: category?.id,
                    is_verified: true, is_featured: true, last_synced_at: new Date(),
                }).onConflict(['source_id', 'external_id']).merge([
                    'name', 'logo_url', 'country_id', 'category_id', 'last_synced_at',
                ]).returning('id');
                const channelId = Array.isArray(result) ? result[0]?.id || result[0] : result?.id;
                if (channelId && v.streamUrl) {
                    await trx('streams').insert({
                        channel_id: channelId, source_id: sourceId, url: v.streamUrl,
                        quality: v.quality, is_primary: true, priority: 'high',
                    }).onConflict(['channel_id', 'url']).merge(['quality', 'updated_at']);
                    this.stats.streams++;
                }
                this.stats.channels++;
            }
            await trx.commit();
        } catch (err) { await trx.rollback(); throw err; }
    }

    // ── Deduplication ──────────────────────────────────────
    async deduplicateChannels() {
        console.log('[Sync] Deduplicating channels...');
        // Find potential duplicates by name similarity
        const duplicates = await db.raw(`
            SELECT a.id as id1, b.id as id2, a.name as name1, b.name as name2,
                   similarity(a.name, b.name) as sim
            FROM channels a
            JOIN channels b ON a.id < b.id
            AND a.country_id = b.country_id
            AND similarity(a.name, b.name) > 0.7
            AND a.is_active = true AND b.is_active = true
            LIMIT 100
        `);

        if (!duplicates.rows?.length) return;

        for (const dup of duplicates.rows) {
            try {
                // Merge streams from duplicate into primary (lower UUID = primary)
                const [primary, secondary] = dup.id1 < dup.id2 ? [dup.id1, dup.id2] : [dup.id2, dup.id1];
                await db('streams').where({ channel_id: secondary, is_active: true })
                    .update({ channel_id: primary });
                await db('channels').where('id', secondary).update({ is_active: false });
                this.stats.duplicates++;
            } catch (err) {
                console.warn(`[Sync] Dedup failed for ${dup.name1}: ${err.message}`);
            }
        }
        console.log(`[Sync] Merged ${this.stats.duplicates} duplicate channels`);
    }

    // ── Helpers ────────────────────────────────────────────
    slugify(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80); }
    flagEmoji(code) { if (!code || code.length !== 2) return ''; const cp = code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65); return String.fromCodePoint(...cp); }
    extractQuality(url) { const m = url.match(/(\d{3,4})p/); return m ? m[1] + 'p' : null; }
}

module.exports = new IPTVSyncService();
