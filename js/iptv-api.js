/* ============================================================
   FIFA E1 SportsTV — IPTV API Service Module
   Fetches real channel data from iptv-org/iptv (GitHub)
   https://github.com/iptv-org/iptv
   ============================================================ */

const IPTV_API = (() => {
  /* ── Base URLs ─────────────────────────────────────────── */
  const BASE = 'https://iptv-org.github.io';
  const API_BASE = `${BASE}/api`;
  const PLAYLIST_BASE = `${BASE}/iptv`;

  /* ── Cache ─────────────────────────────────────────────── */
  let _cache = {
    channels: null,
    streams: null,
    categories: null,
    countries: null,
    languages: null,
    feeds: null,
    timestamp: 0,
  };

  const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

  /* ── Target categories we want to show ─────────────────── */
  const TARGET_CATEGORIES = [
    'sports', 'news', 'entertainment', 'movies', 'music',
    'documentary', 'business', 'lifestyle', 'family', 'general',
  ];

  /* ── Target country codes (English-speaking + major) ───── */
  const TARGET_COUNTRIES = [
    'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL',
    'SE', 'NO', 'DK', 'FI', 'JP', 'KR', 'IN', 'BR', 'MX',
    'AR', 'ZA', 'NG', 'KE', 'GH', 'EG', 'AE', 'SA', 'TR',
    'PK', 'BD', 'PH', 'TH', 'VN', 'ID', 'MY', 'SG', 'NZ',
    'IE', 'AT', 'CH', 'BE', 'PT', 'PL', 'CZ', 'HU', 'RO',
    'UA', 'RU', 'CN', 'HK', 'TW', 'IL', 'CL', 'CO', 'PE',
  ];

  /* ── Fetch with timeout ────────────────────────────────── */
  async function fetchJSON(url, timeout = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── Load all API data ─────────────────────────────────── */
  async function loadAll() {
    const now = Date.now();
    if (_cache.channels && (now - _cache.timestamp) < CACHE_TTL) {
      return _cache;
    }

    try {
      // Fetch in parallel
      const [channels, streams, categories, countries] = await Promise.all([
        fetchJSON(`${API_BASE}/channels.json`).catch(() => []),
        fetchJSON(`${API_BASE}/streams.json`).catch(() => []),
        fetchJSON(`${API_BASE}/categories.json`).catch(() => []),
        fetchJSON(`${API_BASE}/countries.json`).catch(() => []),
      ]);

      _cache = {
        channels: channels || [],
        streams: streams || [],
        categories: categories || [],
        countries: countries || [],
        feeds: null,
        timestamp: now,
      };

      console.log(
        `%c IPTV API Loaded: ${_cache.channels.length} channels, ${_cache.streams.length} streams, ${_cache.categories.length} categories `,
        'background:#00F2FE; color:#040711; font-weight:900; font-size:12px; padding:4px 8px; border-radius:4px;'
      );

      return _cache;
    } catch (err) {
      console.warn('IPTV API load failed, using cache/fallback:', err);
      return _cache;
    }
  }

  /* ── Get streams for a channel ─────────────────────────── */
  function getStreamsForChannel(channelId) {
    if (!_cache.streams) return [];
    return _cache.streams.filter(s => s.channel === channelId);
  }

  /* ── Get best stream for a channel ─────────────────────── */
  function getBestStream(channelId) {
    const streams = getStreamsForChannel(channelId);
    if (!streams.length) return null;

    // Prefer non-geo-blocked, then by quality
    const priority = { '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
    const sorted = streams.sort((a, b) => {
      const aGeo = (a.label || '').toLowerCase().includes('geo') ? 1 : 0;
      const bGeo = (b.label || '').toLowerCase().includes('geo') ? 1 : 0;
      if (aGeo !== bGeo) return aGeo - bGeo; // non-geo first
      const aQ = priority[a.quality] ?? 0;
      const bQ = priority[b.quality] ?? 0;
      return bQ - aQ; // higher quality first
    });

    return sorted[0];
  }

  /* ── Build channel list from API data ──────────────────── */
  function buildChannelList(options = {}) {
    if (!_cache.channels) return [];

    const {
      categories = TARGET_CATEGORIES,
      countries = TARGET_COUNTRIES,
      maxChannels = 500,
      requireStream = true,
    } = options;

    const countrySet = new Set(countries.map(c => c.toUpperCase()));
    const catSet = new Set(categories.map(c => c.toLowerCase()));

    const result = [];
    const seen = new Set();

    for (const ch of _cache.channels) {
      if (result.length >= maxChannels) break;
      if (!ch.id || seen.has(ch.id)) continue;

      // Filter by country
      if (ch.country && !countrySet.has(ch.country.toUpperCase())) continue;

      // Filter by category
      const chCats = (ch.categories || []).map(c => (c.id || c).toLowerCase());
      const hasTargetCat = chCats.some(c => catSet.has(c));
      if (!hasTargetCat) continue;

      // Get stream
      const stream = getBestStream(ch.id);
      if (requireStream && !stream) continue;

      seen.add(ch.id);

      // Determine primary category
      const primaryCat = chCats.find(c => catSet.has(c)) || chCats[0] || 'general';

      // Get country info
      const countryInfo = _cache.countries?.find(
        c => c.code?.toUpperCase() === ch.country?.toUpperCase()
      );

      result.push({
        id: ch.id,
        name: ch.name || ch.id,
        altNames: ch.alt_names || [],
        country: ch.country || '',
        countryName: countryInfo?.name || ch.country || '',
        countryFlag: countryInfo?.flag || '',
        categories: chCats,
        primaryCategory: primaryCat,
        isNsfw: ch.is_nsfw || false,
        website: ch.website || '',
        logo: ch.logo || null,
        stream: stream ? {
          url: stream.url,
          quality: stream.quality || 'unknown',
          label: stream.label || '',
          title: stream.title || '',
        } : null,
      });
    }

    return result;
  }

  /* ── Get category list ─────────────────────────────────── */
  function getCategories() {
    if (!_cache.categories) return [];
    return _cache.categories.filter(c =>
      TARGET_CATEGORIES.includes(c.id?.toLowerCase())
    );
  }

  /* ── Get country list ──────────────────────────────────── */
  function getCountries() {
    if (!_cache.countries) return [];
    return _cache.countries.filter(c =>
      TARGET_COUNTRIES.includes(c.code?.toUpperCase())
    );
  }

  /* ── Search channels ───────────────────────────────────── */
  function searchChannels(query, channelList) {
    if (!query || !query.trim()) return channelList;
    const q = query.toLowerCase();
    return channelList.filter(ch =>
      ch.name?.toLowerCase().includes(q) ||
      ch.altNames?.some(n => n.toLowerCase().includes(q)) ||
      ch.countryName?.toLowerCase().includes(q) ||
      ch.categories?.some(c => c.toLowerCase().includes(q))
    );
  }

  /* ── Filter by category ────────────────────────────────── */
  function filterByCategory(category, channelList) {
    if (!category || category === 'All') return channelList;
    if (category === 'Favorites') return channelList.filter(ch => ch._isFavorite);
    if (category === 'Live') return channelList.filter(ch => ch.stream);
    return channelList.filter(ch =>
      ch.categories?.includes(category.toLowerCase())
    );
  }

  /* ── Filter by country ─────────────────────────────────── */
  function filterByCountry(countryCode, channelList) {
    if (!countryCode || countryCode === 'All') return channelList;
    return channelList.filter(ch =>
      ch.country?.toUpperCase() === countryCode.toUpperCase()
    );
  }

  /* ── Get M3U playlist URL for a category ───────────────── */
  function getM3UUrl(category) {
    if (!category || category === 'All') return `${PLAYLIST_BASE}/index.m3u`;
    return `${PLAYLIST_BASE}/categories/${category.toLowerCase()}.m3u`;
  }

  /* ── Parse M3U playlist text ───────────────────────────── */
  function parseM3U(m3uText) {
    const channels = [];
    const lines = m3uText.split('\n');
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        current = { streamUrl: '', raw: line };

        // Parse attributes
        const logoMatch = line.match(/tvg-logo="([^"]*)"/);
        current.logo = logoMatch ? logoMatch[1] : '';

        const idMatch = line.match(/tvg-id="([^"]*)"/);
        current.tvgId = idMatch ? idMatch[1] : '';

        const groupMatch = line.match(/group-title="([^"]*)"/);
        current.group = groupMatch ? groupMatch[1] : 'Uncategorized';

        const nameMatch = line.match(/,(.+)$/);
        current.name = nameMatch ? nameMatch[1].trim() : `Channel ${channels.length + 1}`;

        // Parse extra headers (http-referrer, http-user-agent)
        const refMatch = line.match(/http-referrer="([^"]*)"/);
        current.referrer = refMatch ? refMatch[1] : null;

        const uaMatch = line.match(/http-user-agent="([^"]*)"/);
        current.userAgent = uaMatch ? uaMatch[1] : null;
      } else if (line && !line.startsWith('#') && current) {
        current.streamUrl = line;
        channels.push(current);
        current = null;
      }
    }

    return channels;
  }

  /* ── Fetch and parse M3U playlist ──────────────────────── */
  async function fetchM3U(category = null) {
    const url = getM3UUrl(category);
    try {
      const text = await fetch(url).then(r => r.ok ? r.text() : '');
      return parseM3U(text);
    } catch (err) {
      console.warn('M3U fetch failed:', url, err);
      return [];
    }
  }

  /* ── Clear cache ───────────────────────────────────────── */
  function clearCache() {
    _cache = {
      channels: null, streams: null, categories: null,
      countries: null, languages: null, feeds: null, timestamp: 0,
    };
  }

  /* ── Get cache stats ───────────────────────────────────── */
  function getCacheStats() {
    return {
      channels: _cache.channels?.length || 0,
      streams: _cache.streams?.length || 0,
      categories: _cache.categories?.length || 0,
      countries: _cache.countries?.length || 0,
      age: _cache.timestamp ? Math.round((Date.now() - _cache.timestamp) / 1000) + 's' : 'empty',
    };
  }

  return {
    loadAll,
    buildChannelList,
    getCategories,
    getCountries,
    getStreamsForChannel,
    getBestStream,
    searchChannels,
    filterByCategory,
    filterByCountry,
    getM3UUrl,
    parseM3U,
    fetchM3U,
    clearCache,
    getCacheStats,
    TARGET_CATEGORIES,
    TARGET_COUNTRIES,
  };
})();
