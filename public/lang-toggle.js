(function () {
  var KEY = 'bcs_portal_lang';
  function apply(lang) {
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('data-lang', lang);

    document.querySelectorAll('[data-lang-es]').forEach(function (el) {
      el.hidden = lang !== 'es';
    });
    document.querySelectorAll('[data-lang-en]').forEach(function (el) {
      el.hidden = lang !== 'en';
    });

    var dict = window.__BCS_UI__ && window.__BCS_UI__[lang];

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (dict && dict[k] != null) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.setAttribute('placeholder', dict[k]);
        } else {
          el.textContent = dict[k];
        }
      }
    });

    // Explicit placeholder attribute (ChatWidget textarea)
    document.querySelectorAll('[data-placeholder-es]').forEach(function (el) {
      el.setAttribute('placeholder', el.getAttribute('data-placeholder-' + lang) || el.getAttribute('data-placeholder-es'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-placeholder');
      if (dict && dict[k] != null) {
        el.setAttribute('placeholder', dict[k]);
      }
    });

    // aria-label / aria-* via data-i18n-aria (key → aria-label)
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-aria');
      if (dict && dict[k] != null) {
        el.setAttribute('aria-label', dict[k]);
      }
    });

    document.querySelectorAll('[data-aria-es]').forEach(function (el) {
      var es = el.getAttribute('data-aria-es') || '';
      var en = el.getAttribute('data-aria-en') || es;
      el.setAttribute('aria-label', lang === 'en' ? en : es);
    });

    // document.title from bilingual map on <html> or <title>
    var titleEl = document.querySelector('title[data-title-es]');
    var root = document.documentElement;
    var tEs = (titleEl && titleEl.getAttribute('data-title-es')) || root.getAttribute('data-title-es');
    var tEn = (titleEl && titleEl.getAttribute('data-title-en')) || root.getAttribute('data-title-en');
    var suffix = (titleEl && titleEl.getAttribute('data-title-suffix')) || root.getAttribute('data-title-suffix') || ' · Portal BCS';
    if (lang === 'en' && tEn) {
      document.title = tEn + suffix;
    } else if (tEs) {
      document.title = tEs + suffix;
    }

    var btn = document.getElementById('lang-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
      btn.querySelector('[data-side=es]')?.classList.toggle('active', lang === 'es');
      btn.querySelector('[data-side=en]')?.classList.toggle('active', lang === 'en');
      if (dict && dict.toggleAria) btn.setAttribute('aria-label', dict.toggleAria);
    }
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    try {
      document.dispatchEvent(new CustomEvent('bcs:lang', { detail: { lang: lang } }));
    } catch (e) {}
  }
  function current() {
    try {
      var s = localStorage.getItem(KEY);
      if (s === 'en' || s === 'es') return s;
    } catch (e) {}
    return 'es';
  }
  document.addEventListener('DOMContentLoaded', function () {
    apply(current());
    var btn = document.getElementById('lang-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        apply(current() === 'es' ? 'en' : 'es');
      });
    }
  });
  window.__BCS_SET_LANG__ = apply;
})();
