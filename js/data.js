/* ============================================================
   FIFA E1 SportsTV — Data Module (iptv-org + backend fallback)
   ============================================================ */

var Data = (function() {
    var channels = [];
    var categories = ['All', 'Live', 'Sports', 'News', 'Movies', 'Entertainment', 'Music', 'Favorites'];

    function getCategories() { return categories; }

    function getChannelById(id) {
        for (var i = 0; i < channels.length; i++) {
            if (channels[i].id === id) return channels[i];
        }
        return channels[0] || null;
    }

    function getChannels() { return channels; }

    function setChannels(list) { channels = list || []; }

    function filterByCategory(cat, query) {
        query = (query || '').toLowerCase();
        return channels.filter(function(ch) {
            var matchCat = cat === 'All' ||
                (cat === 'Favorites' && ch.fav) ||
                (cat === 'Live' && ch.live) ||
                (cat !== 'All' && cat !== 'Favorites' && cat !== 'Live' && ch.cat && ch.cat.indexOf(cat) !== -1);
            if (!matchCat) return false;
            if (query) {
                return (ch.name && ch.name.toLowerCase().indexOf(query) !== -1) ||
                    (ch.show && ch.show.title && ch.show.title.toLowerCase().indexOf(query) !== -1) ||
                    (ch.country && ch.country.toLowerCase().indexOf(query) !== -1);
            }
            return true;
        });
    }

    function toggleFavorite(id) {
        var ch = getChannelById(id);
        if (!ch) return;
        ch.fav = !ch.fav;
        var favs = JSON.parse(localStorage.getItem('a1tv_favs') || '[]');
        var idx = favs.indexOf(id);
        if (idx === -1) favs.push(id);
        else favs.splice(idx, 1);
        localStorage.setItem('a1tv_favs', JSON.stringify(favs));
        return ch.fav;
    }

    function loadFavorites() {
        var favs = JSON.parse(localStorage.getItem('a1tv_favs') || '[]');
        for (var i = 0; i < channels.length; i++) {
            channels[i].fav = favs.indexOf(channels[i].id) !== -1;
        }
    }

    function init(callback) {
        // Try backend first, fall back to iptv-org
        var backendBase = (window.location.port === '3000') ? '' :
            (window.location.origin.includes('localhost:8080') ? 'http://localhost:3000' : '');

        fetch(backendBase + '/api/channels?limit=200&sort=popular', {
            headers: { 'Accept': 'application/json' }
        })
        .then(function(res) {
            if (!res.ok) throw new Error('Backend unavailable');
            return res.json();
        })
        .then(function(data) {
            if (data && data.data && data.data.length) {
                channels = data.data.map(function(ch) {
                    return {
                        id: ch.id,
                        name: ch.name,
                        num: ch.num || ch.id.substring(0, 6),
                        cat: ch.category_name ? [ch.category_name] : ['General'],
                        quality: ch.best_stream ? (ch.best_stream.quality || 'HD') : 'HD',
                        viewers: formatViewers(ch.view_count || Math.floor(Math.random() * 50000)),
                        live: ch.online_streams_count > 0,
                        fav: false,
                        emoji: getCategoryEmoji(ch.category_slug),
                        color: getColorForCategory(ch.category_slug),
                        logo: ch.logo_url || null,
                        country: ch.country_name || '',
                        streamUrl: ch.best_stream ? ch.best_stream.url : null,
                        score: ch.best_stream ? ch.best_stream.score : null,
                        show: {
                            title: ch.current_program ? ch.current_program.title : ch.name,
                            sub: (ch.country_name || '') + ' · ' + (ch.category_name || 'Live'),
                            desc: ch.current_program ? ch.current_program.description : '',
                            start: ch.current_program ? formatTime(new Date(ch.current_program.start_time)) : formatTime(new Date()),
                            end: ch.current_program ? formatTime(new Date(ch.current_program.end_time)) : formatTime(new Date(Date.now() + 2 * 60 * 60 * 1000)),
                            prog: 45,
                        },
                        next: {
                            title: ch.next_program ? ch.next_program.title : 'Up Next',
                            start: ch.next_program ? formatTime(new Date(ch.next_program.start_time)) : '',
                            end: ch.next_program ? formatTime(new Date(ch.next_program.end_time)) : '',
                        },
                    };
                });
                loadFavorites();
                console.log('✓ Loaded ' + channels.length + ' channels from backend');
                if (callback) callback(channels);
                return;
            }
            throw new Error('No data from backend');
        })
        .catch(function() {
            // Fallback to iptv-org
            return fetchIPTVOrg(callback);
        });
    }

    function fetchIPTVOrg(callback) {
        var base = 'https://iptv-org.github.io/api';
        Promise.all([
            fetch(base + '/channels.json').then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }),
            fetch(base + '/streams.json').then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; })
        ]).then(function(results) {
            var apiChannels = results[0];
            var apiStreams = results[1];

            var streamMap = {};
            (apiStreams || []).forEach(function(s) {
                if (s.channel && s.url) {
                    if (!streamMap[s.channel]) streamMap[s.channel] = [];
                    streamMap[s.channel].push(s);
                }
            });

            var targetCats = ['sports', 'news', 'entertainment', 'movies', 'music', 'documentary', 'business', 'lifestyle', 'family', 'general', 'kids', 'animation'];
            var catDisplay = { sports: 'Sports', news: 'News', entertainment: 'Entertainment', movies: 'Movies', music: 'Music', documentary: 'Entertainment', business: 'News', lifestyle: 'Entertainment', family: 'Entertainment', general: 'General', kids: 'Entertainment', animation: 'Entertainment' };
            var catEmoji = { sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬', music: '🎵', documentary: '🎥', business: '💼', lifestyle: '🌿', family: '👨‍👩‍👧‍👦', general: '📺', kids: '🧸', animation: '🎨' };
            var catColors = { sports: '#1a6b3c', news: '#cc0000', entertainment: '#6a1e8a', movies: '#1a3a5c', music: '#e040fb' };

            channels = [];
            for (var i = 0; i < apiChannels.length && channels.length < 200; i++) {
                var ch = apiChannels[i];
                if (!ch || !ch.id) continue;
                var streams = streamMap[ch.id];
                if (!streams || streams.length === 0) continue;

                var chCats = ch.categories || [];
                var matchedCat = null;
                for (var c = 0; c < chCats.length; c++) {
                    var catId = (typeof chCats[c] === 'string' ? chCats[c] : (chCats[c].id || '')).toLowerCase();
                    if (targetCats.indexOf(catId) !== -1) { matchedCat = catId; break; }
                }
                if (!matchedCat) matchedCat = 'general';

                var qualityOrder = { '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
                streams.sort(function(a, b) {
                    var aGeo = (a.label || '').toLowerCase().indexOf('geo') !== -1 ? 1 : 0;
                    var bGeo = (b.label || '').toLowerCase().indexOf('geo') !== -1 ? 1 : 0;
                    if (aGeo !== bGeo) return aGeo - bGeo;
                    return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
                });
                var best = streams[0];

                var now = new Date();
                var endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

                channels.push({
                    id: ch.id,
                    name: ch.name || ch.id,
                    num: String(channels.length + 1).padStart(3, '0'),
                    cat: [catDisplay[matchedCat] || matchedCat],
                    quality: best.quality || 'HD',
                    viewers: formatViewers(Math.floor(Math.random() * 50000) + 1000),
                    live: true,
                    fav: JSON.parse(localStorage.getItem('a1tv_favs') || '[]').indexOf(ch.id) !== -1,
                    emoji: catEmoji[matchedCat] || '📺',
                    color: catColors[matchedCat] || '#37474f',
                    logo: ch.logo || null,
                    country: ch.country || '',
                    streamUrl: best.url || null,
                    score: null,
                    show: {
                        title: ch.name || 'Live Stream',
                        sub: (ch.country || '') + ' · ' + (catDisplay[matchedCat] || 'Live'),
                        desc: (ch.name || '') + ' — Live broadcast.',
                        start: formatTime(now),
                        end: formatTime(endTime),
                        prog: Math.floor(Math.random() * 60) + 20,
                    },
                    next: {
                        title: 'Up Next',
                        start: formatTime(endTime),
                        end: formatTime(new Date(endTime.getTime() + 2 * 60 * 60 * 1000)),
                    },
                });
            }

            console.log('✓ Loaded ' + channels.length + ' channels from iptv-org');
            if (callback) callback(channels);
        }).catch(function(err) {
            console.warn('iptv-org fallback failed:', err);
            if (callback) callback([]);
        });
    }

    function formatTime(date) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function formatViewers(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return String(num);
    }

    function getCategoryEmoji(slug) {
        var map = { sports: '⚽', news: '📰', entertainment: '🎭', movies: '🎬', music: '🎵', documentary: '🎥' };
        return map[slug] || '📺';
    }

    function getColorForCategory(slug) {
        var colors = { sports: '#1a6b3c', news: '#cc0000', entertainment: '#6a1e8a', movies: '#1a3a5c', music: '#e040fb' };
        return colors[slug] || '#37474f';
    }

    return {
        init: init,
        getCategories: getCategories,
        getChannelById: getChannelById,
        getChannels: getChannels,
        setChannels: setChannels,
        filterByCategory: filterByCategory,
        toggleFavorite: toggleFavorite,
        loadFavorites: loadFavorites,
    };
})();
