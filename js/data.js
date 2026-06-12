/* ============================================================
   FIFA E1 SportsTV — Channel Data (Powered by iptv-org/iptv)
   Fetches real live TV channels from:
   https://github.com/iptv-org/iptv
   https://github.com/iptv-org/api
   ============================================================ */

// Global channel store — populated by IPTV_API
let CHANNELS = [];
let CATEGORIES = ['All', 'Favorites', 'Live'];
let COUNTRIES = ['All'];

// Category display name mapping
const CATEGORY_DISPLAY = {
  sports: 'Sports',
  news: 'News',
  entertainment: 'Entertainment',
  movies: 'Movies',
  music: 'Music',
  documentary: 'Documentary',
  business: 'Business',
  lifestyle: 'Lifestyle',
  family: 'Family',
  general: 'General',
  kids: 'Kids',
  animation: 'Animation',
  comedy: 'Comedy',
  cooking: 'Cooking',
  culture: 'Culture',
  education: 'Education',
  outdoor: 'Outdoor',
  public: 'Public',
  legislative: 'Legislative',
  auto: 'Auto',
  shop: 'Shop',
  interactive: 'Interactive',
};

// Emoji mapping for categories
const CATEGORY_EMOJI = {
  sports: '⚽',
  news: '📰',
  entertainment: '🎭',
  movies: '🎬',
  music: '🎵',
  documentary: '🎥',
  business: '💼',
  lifestyle: '🌿',
  family: '👨‍👩‍👧‍👦',
  general: '📺',
  kids: '🧸',
  animation: '🎨',
  comedy: '😂',
  cooking: '🍳',
  culture: '🏛️',
  education: '📚',
  outdoor: '🏕️',
  public: '🏛️',
  legislative: '⚖️',
  auto: '🚗',
  shop: '🛒',
  interactive: '🎮',
};

// Country flag emoji helper
function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const codePoints = code
    .toUpperCase()
    .split('')
    .map(c => 0x1F1E6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

// Initialize data from IPTV API
async function initChannelData() {
  try {
    // Load all API data
    await IPTV_API.loadAll();

    // Build channel list (max 500 channels, filtered to target categories/countries)
    const apiChannels = IPTV_API.buildChannelList({
      maxChannels: 500,
      requireStream: true,
    });

    // Transform to our internal format
    CHANNELS = apiChannels.map((ch, index) => ({
      id: ch.id,
      name: ch.name,
      number: String(index + 1).padStart(3, '0'),
      category: ch.categories || [ch.primaryCategory || 'general'],
      quality: ch.stream?.quality || 'HD',
      viewers: formatViewers(Math.floor(Math.random() * 50000) + 1000),
      isLive: !!ch.stream,
      isFeatured: index < 3,
      isFavorite: false,
      logo: getChannelLogo(ch),
      color: getChannelColor(ch.primaryCategory),
      country: ch.country || '',
      countryName: ch.countryName || '',
      countryFlag: ch.countryFlag || countryFlag(ch.country),
      streamUrl: ch.stream?.url || null,
      streamQuality: ch.stream?.quality || '',
      streamLabel: ch.stream?.label || '',
      referrer: ch.stream?.referrer || null,
      userAgent: ch.stream?.userAgent || null,
      currentShow: {
        title: ch.stream?.title || ch.name,
        subtitle: `${ch.countryName || ch.country} · ${CATEGORY_DISPLAY[ch.primaryCategory] || ch.primaryCategory}`,
        startTime: formatTime(new Date()),
        endTime: formatTime(new Date(Date.now() + 2 * 60 * 60 * 1000)),
        progress: Math.floor(Math.random() * 80) + 10,
        description: `${ch.name} is a ${CATEGORY_DISPLAY[ch.primaryCategory] || ch.primaryCategory} channel broadcasting from ${ch.countryName || ch.country}.`,
      },
      nextShow: {
        title: 'Up Next',
        startTime: formatTime(new Date(Date.now() + 2 * 60 * 60 * 1000)),
        endTime: formatTime(new Date(Date.now() + 4 * 60 * 60 * 1000)),
      },
      _isFavorite: false,
    }));

    // Build categories list
    const apiCats = IPTV_API.getCategories();
    const usedCats = new Set();
    CHANNELS.forEach(ch => {
      (ch.category || []).forEach(c => usedCats.add(c));
    });
    CATEGORIES = [
      'All',
      'Favorites',
      'Live',
      ...Array.from(usedCats)
        .filter(c => CATEGORY_DISPLAY[c])
        .sort((a, b) => CATEGORY_DISPLAY[a].localeCompare(CATEGORY_DISPLAY[b]))
        .map(c => CATEGORY_DISPLAY[c]),
    ];

    // Build countries list
    const usedCountries = new Set();
    CHANNELS.forEach(ch => {
      if (ch.countryName) usedCountries.add(ch.country);
    });
    COUNTRIES = [
      'All',
      ...Array.from(usedCountries)
        .filter(c => c)
        .sort((a, b) => {
          const chA = CHANNELS.find(ch => ch.country === a);
          const chB = CHANNELS.find(ch => ch.country === b);
          return (chA?.countryName || a).localeCompare(chB?.countryName || b);
        })
        .map(c => {
          const ch = CHANNELS.find(ch => ch.country === c);
          return ch ? `${ch.countryFlag} ${ch.countryName}` : c;
        }),
    ];

    console.log(
      `%c ${CHANNELS.length} Live Channels Loaded `,
      'background:#00F2FE; color:#040711; font-weight:900; font-size:12px; padding:4px 8px; border-radius:4px;'
    );
    console.log(
      `%c Categories: ${CATEGORIES.slice(3).join(', ')} `,
      'color:#8292B0; font-size:11px;'
    );

    return CHANNELS;
  } catch (err) {
    console.error('Failed to load IPTV data:', err);
    // Fallback to empty — channels.js will show "No channels found"
    CHANNELS = [];
    return CHANNELS;
  }
}

// Helper: get channel logo
function getChannelLogo(ch) {
  if (ch.logo) return ch.logo;
  // Use category emoji as fallback
  const cat = ch.primaryCategory || (ch.categories && ch.categories[0]) || 'general';
  return CATEGORY_EMOJI[cat] || '📺';
}

// Helper: get channel color based on category
function getChannelColor(category) {
  const colors = {
    sports: '#1a6b3c',
    news: '#cc0000',
    entertainment: '#6a1e8a',
    movies: '#1a3a5c',
    music: '#e040fb',
    documentary: '#0d47a1',
    business: '#37474f',
    lifestyle: '#2e7d32',
    family: '#f57c00',
    general: '#37474f',
    kids: '#e91e63',
    animation: '#ff6f00',
    comedy: '#f9a825',
    cooking: '#d84315',
    culture: '#4a148c',
    education: '#0277bd',
    outdoor: '#33691e',
  };
  return colors[category] || '#37474f';
}

// Helper: format viewer count
function formatViewers(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

// Helper: format time
function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Helper: get channel by ID
function getChannelById(id) {
  return CHANNELS.find(ch => ch.id === id) || CHANNELS[0] || null;
}

// Helper: filter channels by category name
function filterChannels(category, query = '') {
  let filtered = CHANNELS;

  if (category === 'Favorites') {
    filtered = CHANNELS.filter(ch => ch._isFavorite || ch.isFavorite);
  } else if (category === 'Live') {
    filtered = CHANNELS.filter(ch => ch.isLive);
  } else if (category && category !== 'All') {
    // Find the category key from display name
    const catKey = Object.entries(CATEGORY_DISPLAY)
      .find(([k, v]) => v.toLowerCase() === category.toLowerCase());
    if (catKey) {
      filtered = CHANNELS.filter(ch =>
        ch.category?.some(c => c.toLowerCase() === catKey[0].toLowerCase())
      );
    }
  }

  if (query && query.trim()) {
    const q = query.toLowerCase();
    filtered = filtered.filter(ch =>
      ch.name?.toLowerCase().includes(q) ||
      ch.currentShow?.title?.toLowerCase().includes(q) ||
      ch.countryName?.toLowerCase().includes(q) ||
      ch.category?.some(c => c.toLowerCase().includes(q))
    );
  }

  return filtered;
}

// Helper: toggle favorite
function toggleFavoriteById(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (ch) {
    ch._isFavorite = !ch._isFavorite;
    ch.isFavorite = ch._isFavorite;
  }
  return ch;
}
