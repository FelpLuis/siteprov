/* UpDown — Central do Assinante (lado do navegador).
   Fala só com /api/central (serviço no servidor da UpDown). O token do IXC nunca vem para cá. */
(function () {
  'use strict';
  var API = '/api/central';
  var IXC_CENTRAL = 'https://ixc.updown.com.br/central_assinante_web/';
  var WA = 'https://wa.me/551333616081?text=';
  var st = { fase: 'carregando', aba: 'inicio', eu: null, fat: null, con: null, cons: null, erro: '', enviando: false, pix: {}, pixErro: {}, pixCarregando: '', copiado: '' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function brl(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function data(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; }
  function mes(d) { var m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m[2] - 1] + '/' + m[1].slice(2) : '—'; }
  function bytes(b) { b = Number(b || 0); if (b >= 1099511627776) return (b / 1099511627776).toFixed(1).replace('.', ',') + ' TB'; if (b >= 1073741824) return (b / 1073741824).toFixed(1).replace('.', ',') + ' GB'; if (b >= 1048576) return Math.round(b / 1048576) + ' MB'; return Math.round(b / 1024) + ' KB'; }
  function primeiro(n) { n = String(n || '').trim().split(/\s+/)[0] || ''; return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); }

  function api(metodo, rota, corpo) {
    var op = { method: metodo, credentials: 'same-origin', headers: { 'X-Requested-With': 'UpDownCentral' } };
    if (corpo) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(corpo); }
    return fetch(API + rota, op).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && rota !== '/login') { st.fase = 'login'; st.eu = null; st.erro = rota === '/eu' ? '' : (j.mensagem || ''); desenha(); }
        if (!r.ok) { var e = new Error(j.mensagem || 'Não foi possível concluir. Tente novamente.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  function carrega() {
    st.fat = st.con = st.cons = null;
    api('GET', '/faturas').then(function (j) { st.fat = j; desenha(); }).catch(function (e) { st.fat = { erro: e.message }; desenha(); });
    api('GET', '/contratos').then(function (j) { st.con = j.contratos; contato(); desenha(); }).catch(function (e) { st.con = { erro: e.message }; desenha(); });
    api('GET', '/consumo').then(function (j) { st.cons = j.logins; desenha(); }).catch(function (e) { st.cons = { erro: e.message }; desenha(); });
  }
  function contato() {
    if (!st.eu) { window.UpDownCentralContato = null; return; }
    window.UpDownCentralContato = {
      nome: st.eu.nome, telefone: st.eu.telefone, id: st.eu.id, documento: st.eu.documento,
      contratos: Array.isArray(st.con) ? st.con.map(function (c) { return c.id; }).join(', ') : ''
    };
  }
  function inicio() {
    api('GET', '/eu').then(function (j) { st.eu = j; st.fase = 'app'; contato(); desenha(); carrega(); })
      .catch(function (e) { if (e.status !== 401) { st.fase = 'login'; st.erro = e.status ? '' : 'A Central está indisponível no momento. Tente em instantes.'; desenha(); } });
  }

  /* ---------- telas ---------- */
  function telaLogin() {
    return '<div class="ca-card ca-login"><h2 class="ca-h">Entre na sua conta</h2>' +
      '<p class="ca-sub">Use o mesmo usuário e senha da Central do Assinante da UpDown.</p>' +
      '<form data-form="login" novalidate>' +
      '<label for="ca-login">Usuário</label><input class="ca-in" id="ca-login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required>' +
      '<label for="ca-senha">Senha</label><input class="ca-in" id="ca-senha" name="senha" type="password" autocomplete="current-password" required>' +
      (st.erro ? '<div class="ca-msg erro" role="alert">' + esc(st.erro) + '</div>' : '') +
      '<button class="ca-btn full" type="submit"' + (st.enviando ? ' disabled' : '') + '>' + (st.enviando ? 'Entrando...' : 'Entrar') + '</button></form>' +
      '<div class="ca-msg info">Esqueceu a senha ou é seu primeiro acesso? <a href="' + WA + encodeURIComponent('Olá! Vim do site e preciso de ajuda para acessar a Central do Assinante.') + '" target="_blank" rel="noopener" style="font-weight:700">Fale com a gente no WhatsApp</a>.</div></div>';
  }
  function carregando(t) { return '<div class="ca-load">' + t + '</div>'; }
  function falha(o) { return '<div class="ca-msg erro">' + esc(o.erro) + ' <button class="ca-btn sec sm" data-act="recarregar" style="margin-left:8px">Tentar de novo</button></div>'; }

  function blocoPix(f) {
    var p = st.pix[f.id];
    if (st.pixErro[f.id]) return '<div class="ca-pix"><div class="ca-msg erro" style="margin:0">' + esc(st.pixErro[f.id]) + ' Use o boleto ou fale com a gente.</div></div>';
    if (!p) return '';
    return '<div class="ca-pix">' + (p.imagem ? '<img src="' + esc(p.imagem) + '" alt="QR Code Pix da fatura">' : '') +
      '<div style="font-weight:800;margin-bottom:8px">Pix copia e cola</div><code class="ca-code">' + esc(p.copia_cola) + '</code>' +
      '<button class="ca-btn pix sm" data-act="copiar" data-txt="' + esc(p.copia_cola) + '" data-k="pix' + f.id + '" style="margin-top:10px">' + (st.copiado === 'pix' + f.id ? 'Código copiado ✓' : 'Copiar código Pix') + '</button>' +
      '<div class="ca-sub" style="font-size:13px">Abra o app do seu banco, escolha Pix copia e cola e cole o código. A baixa pode levar alguns minutos.</div></div>';
  }
  function itemFatura(f) {
    return '<div class="ca-item"><div><div class="tit">Vencimento ' + data(f.vencimento) +
      (f.vencida ? '<span class="ca-tag erro">Vencida</span>' : '<span class="ca-tag alerta">Em aberto</span>') + '</div>' +
      '<div class="inf">Fatura nº ' + esc(f.documento) + (f.contrato ? ' · Contrato ' + esc(f.contrato) : '') + '</div></div>' +
      '<div class="ca-valor">' + brl(f.valor) + '</div>' +
      '<div class="acoes"><button class="ca-btn pix sm" data-act="pix" data-id="' + esc(f.id) + '"' + (st.pixCarregando === f.id ? ' disabled' : '') + '>' + (st.pixCarregando === f.id ? 'Gerando Pix...' : 'Pagar com Pix') + '</button>' +
      '<a class="ca-btn sm" href="' + API + '/faturas/' + esc(f.id) + '/boleto" target="_blank" rel="noopener">Abrir boleto (PDF)</a>' +
      (f.linha_digitavel ? '<button class="ca-btn sec sm" data-act="copiar" data-txt="' + esc(f.linha_digitavel) + '" data-k="ld' + f.id + '">' + (st.copiado === 'ld' + f.id ? 'Copiado ✓' : 'Copiar código de barras') + '</button>' : '') +
      '</div>' + blocoPix(f) + '</div>';
  }
  function telaFaturas() {
    if (!st.fat) return carregando('Buscando suas faturas...');
    if (st.fat.erro) return falha(st.fat);
    var a = st.fat.abertas || [], p = st.fat.pagas || [];
    var h = '<h3 class="ca-sec" style="margin-top:0">Faturas em aberto</h3>';
    h += a.length ? '<div class="ca-list">' + a.map(itemFatura).join('') + '</div>' : '<div class="ca-vazio" style="margin-top:14px">Você está em dia. Nenhuma fatura em aberto. 🎉</div>';
    if (p.length) {
      h += '<h3 class="ca-sec">Últimos pagamentos</h3><div class="ca-list">' + p.map(function (f) {
        return '<div class="ca-item"><div><div class="tit">Vencimento ' + data(f.vencimento) + '<span class="ca-tag ok">Paga</span></div><div class="inf">Paga em ' + data(f.pago_em) + '</div></div><div class="ca-valor">' + brl(f.valor_pago || f.valor) + '</div></div>';
      }).join('') + '</div>';
    }
    return h;
  }
  function telaContratos() {
    if (!st.con) return carregando('Buscando seus contratos...');
    if (st.con.erro) return falha(st.con);
    if (!st.con.length) return '<div class="ca-vazio">Nenhum contrato encontrado no seu cadastro.</div>';
    function item(c) {
      var tag = c.assinatura_pendente ? '<span class="ca-tag alerta">Aguardando assinatura</span>' : (c.bloqueado ? '<span class="ca-tag erro">' + esc(c.acesso) + '</span>' : '<span class="ca-tag ok">' + esc(c.status) + '</span>');
      return '<div class="ca-item"><div style="flex:1 1 280px;min-width:0"><div class="tit">' + esc(c.plano) + tag + '</div>' +
        '<div class="inf">Contrato nº ' + esc(c.id) + (c.ativacao ? ' · Ativo desde ' + data(c.ativacao) : '') + (c.endereco ? '<br>' + esc(c.endereco) : '') + '</div></div>' +
        '<div class="acoes">' + (c.assinatura_pendente ? '<a class="ca-btn sm" href="' + IXC_CENTRAL + '" target="_blank" rel="noopener">Assinar contrato</a>' : '') +
        '<a class="ca-btn sec sm" href="/documentos/CONTRATO-ANATEL.pdf" target="_blank" rel="noopener">Ver contrato de prestação</a>' +
        '<button class="ca-btn sec sm" data-act="chat">Falar sobre este contrato</button></div></div>';
    }
    var pend = st.con.filter(function (c) { return c.assinatura_pendente; }), ok = st.con.filter(function (c) { return !c.assinatura_pendente; });
    return (pend.length ? '<h3 class="ca-sec" style="margin-top:0">Pendentes de assinatura</h3><div class="ca-list">' + pend.map(item).join('') + '</div>' : '') +
      (ok.length ? '<h3 class="ca-sec"' + (pend.length ? '' : ' style="margin-top:0"') + '>Seus contratos</h3><div class="ca-list">' + ok.map(item).join('') + '</div>' : '');
  }
  function telaConsumo() {
    if (!st.cons) return carregando('Buscando seu consumo...');
    if (st.cons.erro) return falha(st.cons);
    if (!st.cons.length) return '<div class="ca-vazio">Nenhuma conexão encontrada no seu cadastro.</div>';
    return st.cons.map(function (l) {
      var corpo;
      if (!l.disponivel || !l.meses.length) corpo = '<div class="ca-msg info">O histórico de consumo desta conexão ainda não está disponível.</div>';
      else {
        var max = Math.max.apply(null, l.meses.map(function (m) { return m.download + m.upload; })) || 1;
        corpo = '<div class="ca-bars" role="img" aria-label="Consumo mensal">' + l.meses.map(function (m, i) {
          var t = m.download + m.upload;
          return '<div class="ca-bar"><b>' + bytes(t) + '</b><i style="height:' + Math.max(3, Math.round(t / max * 100)) + '%;animation-delay:' + i * 70 + 'ms"></i><span>' + mes(m.mes) + '</span></div>';
        }).join('') + '</div><div class="ca-sub" style="font-size:13px;margin-top:12px">Download + upload por mês.</div>';
      }
      return '<div class="ca-card" style="margin-bottom:14px"><div class="tit" style="font-weight:800;font-size:16px">Conexão ' + esc(l.login) +
        (l.online ? '<span class="ca-tag ok">Online</span>' : '<span class="ca-tag alerta">Offline</span>') + '</div>' + corpo + '</div>';
    }).join('');
  }
  function telaInicio() {
    var a = st.fat && !st.fat.erro ? st.fat.abertas : null, total = 0, prox = null, venc = 0;
    if (a) a.forEach(function (f) { total += f.valor; if (f.vencida) venc++; if (!prox) prox = f; });
    var pend = Array.isArray(st.con) ? st.con.filter(function (c) { return c.assinatura_pendente; }).length : 0;
    var online = Array.isArray(st.cons) ? st.cons.some(function (l) { return l.online; }) : null;
    var k1 = '<div class="ca-card ca-kpi"><div class="rot">Faturas em aberto</div><div class="val">' + (a ? (a.length ? brl(total) : 'Em dia') : '…') + '</div><div class="det">' +
      (a ? (a.length ? a.length + ' fatura(s)' + (venc ? ' · ' + venc + ' vencida(s)' : '') + (prox ? ' · próxima em ' + data(prox.vencimento) : '') : 'Nenhuma fatura pendente.') : 'Carregando...') +
      '</div><button class="ca-btn sm" data-act="aba" data-aba="faturas" style="margin-top:14px">' + (a && a.length ? 'Pagar agora' : 'Ver faturas') + '</button></div>';
    var k2 = '<div class="ca-card ca-kpi"><div class="rot">Contratos</div><div class="val">' + (Array.isArray(st.con) ? st.con.length : '…') + '</div><div class="det">' +
      (Array.isArray(st.con) ? (pend ? pend + ' aguardando sua assinatura.' : 'Tudo certo com seus contratos.') : 'Carregando...') + '</div><button class="ca-btn sec sm" data-act="aba" data-aba="contratos" style="margin-top:14px">Ver contratos</button></div>';
    var k3 = '<div class="ca-card ca-kpi"><div class="rot">Sua conexão</div><div class="val">' + (online === null ? '…' : (online ? 'Online' : 'Offline')) + '</div><div class="det">' +
      (online === null ? 'Carregando...' : (online ? 'Sua fibra está conectada.' : 'Não detectamos sua conexão ativa agora.')) + '</div><button class="ca-btn sec sm" data-act="aba" data-aba="consumo" style="margin-top:14px">Ver consumo</button></div>';
    var k4 = '<div class="ca-card ca-kpi"><div class="rot">Atendimento</div><div class="val" style="font-size:22px">Fale com a UpDown</div><div class="det">Chat com a nossa equipe, já identificado com o seu cadastro.</div><button class="ca-btn sm" data-act="chat" style="margin-top:14px">Abrir chat</button></div>';
    return '<div class="ca-grid">' + k1 + k2 + k3 + k4 + '</div>';
  }
  function telaApp() {
    var abas = [['inicio', 'Início'], ['faturas', 'Faturas e pagamento'], ['contratos', 'Contratos'], ['consumo', 'Consumo']];
    var corpo = st.aba === 'faturas' ? telaFaturas() : st.aba === 'contratos' ? telaContratos() : st.aba === 'consumo' ? telaConsumo() : telaInicio();
    return '<div class="ca-top"><div class="ca-ola">Olá, ' + esc(primeiro(st.eu.nome)) + '<small>' + esc(st.eu.nome) + (st.eu.documento ? ' · ' + esc(st.eu.documento) : '') + ' · Cliente nº ' + esc(st.eu.id) + '</small></div>' +
      '<div style="display:flex;gap:8px"><button class="ca-btn sm" data-act="chat">Abrir chat</button><button class="ca-btn sec sm" data-act="sair">Sair</button></div></div>' +
      '<div class="ca-tabs" role="tablist">' + abas.map(function (a) { return '<button class="ca-tab" role="tab" aria-selected="' + (st.aba === a[0]) + '" data-act="aba" data-aba="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>' +
      '<div role="tabpanel">' + corpo + '</div>';
  }

  function desenha() {
    var el = document.getElementById('central-app');
    if (!el) return;
    var foco = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
    var vals = {};
    el.querySelectorAll('input').forEach(function (i) { vals[i.id] = i.value; });
    el.innerHTML = st.fase === 'carregando' ? carregando('Abrindo a Central...') : st.fase === 'login' ? telaLogin() : telaApp();
    el.querySelectorAll('input').forEach(function (i) { if (vals[i.id] != null) i.value = vals[i.id]; });
    if (foco && document.getElementById(foco)) document.getElementById(foco).focus();
  }

  function abrirChat() {
    contato();
    var ico = document.querySelector('.opa_ico');
    if (ico) ico.click();
    else window.open(WA + encodeURIComponent('Olá! Sou cliente UpDown (cadastro nº ' + (st.eu ? st.eu.id : '') + ') e preciso de atendimento.'), '_blank', 'noopener');
  }

  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-form="login"]');
    if (!f) return;
    e.preventDefault();
    if (st.enviando) return;
    var login = f.querySelector('#ca-login').value.trim(), senha = f.querySelector('#ca-senha').value;
    if (!login || !senha) { st.erro = 'Informe usuário e senha.'; return desenha(); }
    st.enviando = true; st.erro = ''; desenha();
    api('POST', '/login', { login: login, senha: senha }).then(function () {
      st.enviando = false; f.querySelector('#ca-senha').value = ''; inicio();
    }).catch(function (er) {
      st.enviando = false; st.erro = er.status ? er.message : 'A Central está indisponível no momento. Tente em instantes.'; desenha();
      var s = document.getElementById('ca-senha'); if (s) { s.value = ''; s.focus(); }
    });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#central-app [data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'aba') { st.aba = b.getAttribute('data-aba'); desenha(); var t = document.getElementById('central-app'); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: 'start' }); }
    else if (act === 'sair') { api('POST', '/logout', {}).catch(function () {}).then(function () { st.fase = 'login'; st.eu = null; st.erro = ''; st.aba = 'inicio'; st.pix = {}; contato(); desenha(); }); }
    else if (act === 'recarregar') { carrega(); desenha(); }
    else if (act === 'chat') abrirChat();
    else if (act === 'copiar') {
      var txt = b.getAttribute('data-txt'), k = b.getAttribute('data-k');
      var ok = function () { st.copiado = k; desenha(); setTimeout(function () { if (st.copiado === k) { st.copiado = ''; desenha(); } }, 2500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, ok);
      else { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (er) { /* sem suporte */ } ta.remove(); ok(); }
    }
    else if (act === 'pix') {
      var id = b.getAttribute('data-id');
      if (st.pix[id]) { delete st.pix[id]; return desenha(); }
      st.pixCarregando = id; delete st.pixErro[id]; desenha();
      api('GET', '/faturas/' + id + '/pix').then(function (j) { st.pix[id] = j; st.pixCarregando = ''; desenha(); })
        .catch(function (er) { st.pixCarregando = ''; if (er.status !== 401) { st.pixErro[id] = er.status === 502 ? 'Não foi possível gerar o Pix desta fatura agora.' : er.message; desenha(); } });
    }
  });

  document.addEventListener('updown:render', desenha);   // o site redesenha a página ao mudar de celular para desktop
  if (!document.getElementById('ud-central-css')) {
    var l = document.createElement('link'); l.id = 'ud-central-css'; l.rel = 'stylesheet'; l.href = '/assets/updown-central.css?v=1';
    document.head.appendChild(l);
  }
  window.UpDownCentral = { iniciar: function () { desenha(); inicio(); } };
})();
