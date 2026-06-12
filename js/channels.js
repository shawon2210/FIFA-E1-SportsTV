/* ============================================================
   A1TV — Channels Module
   ============================================================ */

var Channels = (function() {
    var activeCategory = 'All';
    var searchQuery = '';

    function init() {
        renderCategoryTabs();
        setupSearch();
    }

    function renderCategoryTabs() {
        var container = document.getElementById('rp-cats');
        if (!container) return;
        var cats = ['All', 'Live', 'Sports', 'News', 'Movies', 'Entertainment', 'Favorites'];
        container.innerHTML = cats.map(function(cat) {
            return '<button class="cat-pill ' + (cat === activeCategory ? 'active' : '') + '" data-cat="' + cat + '">' + cat + '</button>';
        }).join('');
        container.querySelectorAll('.cat-pill').forEach(function(btn) {
            btn.addEventListener('click', function() {
                activeCategory = btn.getAttribute('data-cat');
                renderCategoryTabs();
                renderChannelList();
            });
        });
    }

    function setupSearch() {
        var searchEl = document.getElementById('search-input');
        if (searchEl) {
            searchEl.addEventListener('input', function(e) {
                searchQuery = e.target.value;
                renderChannelList();
            });
        }
    }

    function renderChannelList() {
        var container = document.getElementById('rp-list');
        if (!container) return;
        var list = [];
        var allChannels = window.CHANNELS || [];
        allChannels.forEach(function(ch) {
            var match = true;
            if (searchQuery) {
                var q = searchQuery.toLowerCase();
                match = (ch.name && ch.name.toLowerCase().indexOf(q) !== -1) ||
                    (ch.category && ch.category.toLowerCase().indexOf(q) !== -1);
            }
            if (!match) return;
            if (activeCategory !== 'All') {
                if (activeCategory === 'Favorites' && !ch.fav) return;
                else if (activeCategory !== 'Favorites' && ch.category !== activeCategory) return;
            }
            list.push(ch);
        });
        if (!list.length) {
            container.innerHTML = '<div class="no-results"><div class="nr-icon">📡</div><p>No channels found.</p></div>';
            return;
        }
        container.innerHTML = list.map(function(ch, i) {
            return '<div class="ch-card ' + (ch.id === window.ActiveChannelId ? 'active' : '') + '" data-id="' + ch.id + '" style="animation-delay:' + (i * 0.02) + 's">' +
                '<div class="ch-logo"><div class="ch-logo-inner" style="background:' + ch.color + '22;"><span>' + (ch.logo || ch.emoji || '📺') + '</span></div></div>' +
                '<div class="ch-info"><div class="ch-name">' + ch.name + '</div>' +
                '<div class="ch-show">' + (ch.currentShow ? ch.currentShow.title : '') + '</div>' +
                '<div class="ch-prog-bar"><div class="ch-prog-fill" style="width:' + (ch.currentShow ? ch.currentShow.progress : 0) + '%"></div></div></div>' +
                '<div class="ch-meta"><span class="ch-num">CH ' + ch.number + '</span>' + (ch.isLive ? '<div class="ch-live-dot"></div>' : '') + '</div>' +
                '<button class="ch-fav-btn ' + (ch.isFavorite ? 'fav' : '') + '" data-id="' + ch.id + '" aria-label="Favorite">★</button></div>';
        }).join('');
        container.querySelectorAll('.ch-card').forEach(function(card) {
            card.addEventListener('click', function() {
                var id = card.getAttribute('data-id');
                var ch = window.CHANNELS.find(function(c) { return c.id === id; });
                if (ch && window.App) window.App.selectChannel(id);
            });
            card.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') card.click();
            });
        });
    }

    function refresh() {
        renderCategoryTabs();
        renderChannelList();
    }

    return {
        init: init,
        renderChannelList: renderChannelList,
        renderCategoryTabs: renderCategoryTabs,
        refresh: refresh
    };
})();

