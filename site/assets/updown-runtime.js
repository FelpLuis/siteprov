/* UpDown — motor de interface do site (sem dependências).
   Renderiza o modelo da página (<template id="tpl-m"> celular / <template id="tpl-d"> desktop)
   com os dados de Component.renderVals(): {{campos}}, <sc-for>, <sc-if> e eventos onClick/onInput/onSubmit. */
(function () {
  'use strict';

  /* ---------- tema claro/escuro ---------- */
  var root = document.documentElement;
  function savedTheme() { try { return localStorage.getItem('updown-tema'); } catch (e) { return null; } }
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0B0656' : '#0004FF');
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(savedTheme() || (prefersDark && prefersDark.matches ? 'dark' : 'light'));
  if (prefersDark && prefersDark.addEventListener) {
    prefersDark.addEventListener('change', function (e) { if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light'); });
  }

  /* ---------- base de componentes ---------- */
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var s = comp ? comp.state : this.state;
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  /* ---------- modelo ---------- */
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), v, found = false;
    for (var i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { v = scope[i][parts[0]]; found = true; break; }
    }
    if (!found) return undefined;
    for (var j = 1; j < parts.length; j++) { if (v == null) return undefined; v = v[parts[j]]; }
    return v;
  }
  function interp(str, scope) {
    var w = str.match(WHOLE);
    if (w) return lookup(scope, w[1]);
    return str.replace(HOLE, function (_, p) { var v = lookup(scope, p); return v == null ? '' : String(v); });
  }
  var EVENTS = { onclick: 'click', oninput: 'input', onsubmit: 'submit', onchange: 'change', onkeydown: 'keydown' };

  function build(node, scope, parent) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      parent.appendChild(document.createTextNode(t.indexOf('{{') >= 0 ? String(interp(t, scope) == null ? '' : interp(t, scope)) : t));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-for') {
      var list = interp(node.getAttribute('list') || '', scope) || [];
      var as = node.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var frame = { $index: i }; frame[as] = list[i];
        var sc = scope.concat([frame]);
        for (var c = node.firstChild; c; c = c.nextSibling) build(c, sc, parent);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (interp(node.getAttribute('value') || '', scope)) for (var c2 = node.firstChild; c2; c2 = c2.nextSibling) build(c2, scope, parent);
      return;
    }
    var el = document.createElementNS(node.namespaceURI, node.localName);
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var hasHole = val.indexOf('{{') >= 0;
      var v = hasHole ? interp(val, scope) : val;
      if (EVENTS[name]) { if (typeof v === 'function') el.addEventListener(EVENTS[name], v); continue; }
      if (v === false || v == null) continue;
      if (name === 'value' && (tag === 'input' || tag === 'textarea')) { el.value = String(v); el.__bound = true; }
      el.setAttribute(name, v === true ? '' : String(v));
    }
    var target = tag === 'template' ? el.content : el;
    for (var ch = node.firstChild; ch; ch = ch.nextSibling) build(ch, scope, target);
    parent.appendChild(el);
  }

  /* ---------- montagem ---------- */
  var app, comp, comps, compKey, props0, mq, pending = false;
  function fieldKey(el) { return el.getAttribute('name') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''; }
  function render() {
    pending = false;
    var key = mq.matches ? 'd' : 'm';
    var tpl = document.getElementById('tpl-' + key);
    if (!tpl) return;
    if (key !== compKey) {
      var prev = comp && comp.state;
      comp = new comps[key](props0);
      if (prev) Object.keys(prev).forEach(function (k) { comp.state[k] = prev[k]; });
      compKey = key;
    }
    // guarda estado da interface que não está no componente
    var ae = document.activeElement, focusKey = null, selS = null, selE = null;
    if (ae && app.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
      focusKey = fieldKey(ae);
      try { selS = ae.selectionStart; selE = ae.selectionEnd; } catch (e) { /* select */ }
    }
    var fields = {};
    app.querySelectorAll('input, select, textarea').forEach(function (f) { if (!f.__bound && f.type !== 'submit') fields[fieldKey(f)] = f.value; });
    var openDetails = [];
    app.querySelectorAll('details').forEach(function (d, i) { if (d.open) openDetails.push(i); });
    var hadDetails = app.querySelectorAll('details').length;
    var dialogScroll = app.querySelector('[role="dialog"]');
    var dScroll = dialogScroll ? dialogScroll.scrollTop : 0;

    var vals = comp.renderVals();
    var frag = document.createDocumentFragment();
    for (var n = tpl.content.firstChild; n; n = n.nextSibling) build(n, [vals], frag);
    app.replaceChildren(frag);

    app.querySelectorAll('input, select, textarea').forEach(function (f) {
      var k = fieldKey(f);
      if (!f.__bound && Object.prototype.hasOwnProperty.call(fields, k)) f.value = fields[k];
    });
    if (hadDetails) app.querySelectorAll('details').forEach(function (d, i) { d.open = openDetails.indexOf(i) >= 0; });
    var dlg = app.querySelector('[role="dialog"]');
    if (dlg && dialogScroll) dlg.scrollTop = dScroll;
    if (focusKey) {
      var again = Array.prototype.find.call(app.querySelectorAll('input, select, textarea'), function (f) { return fieldKey(f) === focusKey; });
      if (again) { again.focus({ preventScroll: true }); try { if (selS != null) again.setSelectionRange(selS, selE); } catch (e) { /* ok */ } }
    }
    document.body.classList.toggle('modal-aberto', !!dlg);
    if (window.UpDownFX) window.UpDownFX(app);
  }
  function schedule() { if (!pending) { pending = true; (window.requestAnimationFrame || setTimeout)(render); } }

  /* ---------- interações globais ---------- */
  document.addEventListener('click', function (e) {
    var tt = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (tt) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('updown-tema', next); } catch (err) { /* modo privado */ }
      return;
    }
    var mt = e.target.closest && e.target.closest('[data-menu-toggle]');
    if (mt) {
      var panel = document.getElementById(mt.getAttribute('aria-controls'));
      if (panel) {
        var open = panel.hasAttribute('hidden');
        if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
        mt.setAttribute('aria-expanded', open ? 'true' : 'false');
        mt.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && comp && comp.state && comp.state.gradeOpen) comp.setState({ gradeOpen: null });
  });

  window.UpDownMount = function (components, props) {
    app = document.getElementById('app');
    mq = window.matchMedia('(min-width: 900px)');
    comps = components; props0 = props || {};
    if (mq.addEventListener) mq.addEventListener('change', schedule); else if (mq.addListener) mq.addListener(schedule);
    render();
  };
})();
