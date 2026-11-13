/* UpDown — efeitos dinâmicos: revelação ao rolar, holofote no cursor, inclinação 3D,
   contadores, borda animada no destaque, cabeçalho reativo e parallax do banner. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var seen = {};          // índices já revelados (sobrevivem às re-renderizações)
  var counted = {};       // contadores já animados
  var io = null;

  var CARD_SEL = [
    '#pacotes [style*="overflow: hidden"]',
    '#planos [style*="border-radius: 2"]',
    'section figure',
    'section [style*="border-radius: 18px"][style*="padding"]',
    'section [style*="border-radius: 20px"][style*="padding"]',
    'section [style*="border-radius: 22px"][style*="padding"]',
    'section [style*="border-radius: 24px"][style*="padding"]'
  ].join(',');

  function key(el, i) { return (el.tagName || '') + ':' + i; }

  function countUp(el, target) {
    var start = null, dur = 1100;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * e));
      if (p < 1) requestAnimationFrame(step); else el.textContent = String(target);
    }
    requestAnimationFrame(step);
  }

  function onReveal(entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add('fx-in');
      seen[el.getAttribute('data-fx-k')] = true;
      io.unobserve(el);
      revealNums(el);
    });
  }
  function revealNums(el) {
    el.querySelectorAll('[data-fx-num]').forEach(function (n) {
      var k = n.getAttribute('data-fx-num');
      if (counted[k] !== false) return;
      counted[k] = true;
      countUp(n, parseInt(k.split(':')[1], 10));
    });
  }

  function enhance(app) {
    if (io) io.disconnect();
    io = 'IntersectionObserver' in window ? new IntersectionObserver(onReveal, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;

    // 2. contadores nos números grandes (velocidades)
    app.querySelectorAll('section span, section div').forEach(function (el, i) {
      if (el.children.length || !/^\d{3,4}$/.test(el.textContent.trim())) return;
      var fs = parseFloat(el.style.fontSize || '0');
      if (fs < 40) return;
      var k = 'n' + i + ':' + el.textContent.trim();
      el.setAttribute('data-fx-num', k);
      if (counted[k] || reduce || !io) return;
      el.textContent = '0';
      counted[k] = false;
    });

    // 1. blocos que surgem ao rolar
    var blocks = app.querySelectorAll('.app-raiz > section, .app-raiz > div > section, ' + CARD_SEL);
    blocks.forEach(function (el, i) {
      if (el.closest('[role="dialog"]')) return;
      var k = key(el, i);
      el.setAttribute('data-fx-k', k);
      el.classList.add('fx-rv');
      if (reduce || !io || seen[k]) { el.classList.add('fx-in'); revealNums(el); return; }
      io.observe(el);
    });

    // escalonamento dentro de grades de cartões
    app.querySelectorAll(CARD_SEL).forEach(function (el) {
      var p = el.parentElement, idx = Array.prototype.indexOf.call(p.children, el);
      el.style.setProperty('--fx-d', Math.min(idx, 6) * 70 + 'ms');
      el.classList.add('fx-card');
    });

    // 3. destaque com borda animada (MAIS VENDIDO / MAIS RÁPIDO)
    app.querySelectorAll('span').forEach(function (s) {
      var t = s.textContent.trim();
      if (t !== 'MAIS VENDIDO' && t !== 'MAIS RÁPIDO') return;
      var card = s.closest('.fx-card');
      if (card) card.classList.add('fx-best');
    });

    // 4. banners do topo
    app.querySelectorAll('section[style*="/banners/"]').forEach(function (h) { h.classList.add('fx-hero'); });

    // 5. botões principais com brilho
    app.querySelectorAll('a[style*="var(--cta)"], button[style*="var(--cta)"], a[style*="background: #00CEFF"]').forEach(function (b) {
      if (/background:\s*var\(--cta\)|background:\s*#00CEFF/.test(b.getAttribute('style'))) b.classList.add('fx-shine');
    });
  }

  // holofote que segue o cursor + inclinação 3D
  if (finePointer && !reduce) {
    document.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.fx-card');
      if (!c) return;
      var r = c.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      c.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg');
      c.style.setProperty('--ry', ((x - 0.5) * 6).toFixed(2) + 'deg');
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      var c = e.target.closest && e.target.closest('.fx-card');
      if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); }
    }, { passive: true });
  }

  // cabeçalho reage à rolagem + parallax do banner
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      document.documentElement.classList.toggle('fx-rolou', y > 24);
      if (!reduce) document.documentElement.style.setProperty('--fx-sy', Math.min(y, 900) + 'px');
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  window.UpDownFX = enhance;
})();
