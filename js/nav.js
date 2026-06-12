/* ============================================================
   A1TV — Navigation Module
   ============================================================ */

var Nav = (function() {
    function init() {
        startClock();
        bindSettings();
        bindSearchShortcut();
    }

    function startClock() {
        var el = document.getElementById('top-clock');
        if (!el) return;
        setInterval(function() {
            var now = new Date();
            var hh = String(now.getHours()).padStart(2, '0');
            var mm = String(now.getMinutes()).padStart(2, '0');
            var ss = String(now.getSeconds()).padStart(2, '0');
            el.textContent = hh + ':' + mm + ':' + ss;
        }, 1000);
    }

    function bindSettings() {
        var modal = document.getElementById('settings-modal');
        var close = document.getElementById('modal-close');
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) modal.classList.remove('open');
            });
        }
        if (close) {
            close.addEventListener('click', function() {
                if (modal) modal.classList.remove('open');
            });
        }
        var openBtns = [
            document.getElementById('btn-settings'),
            document.getElementById('nav-settings-btn')
        ];
        openBtns.forEach(function(btn) {
            if (btn) btn.addEventListener('click', function() {
                if (modal) modal.classList.add('open');
            });
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (modal) modal.classList.remove('open');
            }
        });
    }

    function bindSearchShortcut() {
        document.addEventListener('keydown', function(e) {
            if (e.key === '/' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                var input = document.getElementById('search-input');
                if (input) input.focus();
            }
        });
    }

    return {
        init: init
    };
})();

