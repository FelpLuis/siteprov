/* UPDOWN — Central do Assinante (lado do navegador).
   Fala só com /api/central (serviço no servidor da UPDOWN). O token do IXC nunca vem para cá. */
(function () {
  'use strict';
  var API = '/api/central';
  var IXC_CENTRAL = 'https://ixc.updown.com.br/central_assinante_web/';
  var WA = 'https://wa.me/551333616081?text=';
  var st = { fase: 'carregando', aba: 'inicio', eu: null, fat: null, con: null, cons: null, erro: '', enviando: false, pix: {}, pixErro: {}, pixCarregando: '', copiado: '', cartao: {} };

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
        if (!r.ok) { var e = new Error(j.mensagem || ('A Central não respondeu como esperado (código ' + r.status + '). Tente novamente em instantes.')); e.status = r.status; throw e; }
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
  function lembrado() { try { return localStorage.getItem('updown-central-usuario') || ''; } catch (e) { return ''; } }
  function ic(d) { return '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + d + '"/></svg>'; }
  var I = {
    pix: 'M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13-2h-2v2h-2v2h2v2h2v-2h2v-2h-2v-2zm-5 0h2v2h-2v-2zm6 6h2v2h-2v-2z',
    doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-5 4h8v2H8v-2zm0 4h8v2H8v-2z',
    graf: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
    chat: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
    olho: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7.2a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z',
    cad: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z'
  };
  function telaLogin() {
    var itens = [[I.pix, 'Pague em segundos', 'Pix copia e cola ou boleto, sem sair da tela.'], [I.doc, 'Seus contratos', 'Veja o que está ativo e o que falta assinar.'],
                 [I.graf, 'Seu consumo', 'Acompanhe o uso da sua fibra mês a mês.'], [I.chat, 'Atendimento direto', 'Chat com a equipe, já com o seu cadastro.']];
    var form = '<div class="ca-card ca-login"><div class="ca-sel">' + ic(I.cad) + ' Acesso seguro</div><h1 class="ca-h1">Central do Assinante</h1>' +
      '<p class="ca-sub">Entre com o mesmo usuário e senha que você já usa na UPDOWN.</p>' +
      '<form data-form="login" novalidate>' +
      '<label for="ca-login">Usuário <span>CPF/CNPJ ou e-mail</span></label><input class="ca-in" id="ca-login" name="login" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" value="' + esc(lembrado()) + '" required>' +
      '<label for="ca-senha">Senha</label><div class="ca-senha"><input class="ca-in" id="ca-senha" name="senha" type="' + (st.verSenha ? 'text' : 'password') + '" autocomplete="current-password" enterkeyhint="go" required>' +
      '<button type="button" class="ca-olho" data-act="versenha" aria-pressed="' + !!st.verSenha + '" aria-label="' + (st.verSenha ? 'Ocultar senha' : 'Mostrar senha') + '">' + ic(I.olho) + '</button></div>' +
      (st.erro ? '<div class="ca-msg erro" role="alert">' + esc(st.erro) + '</div>' : '') +
      '<button class="ca-btn full" type="submit"' + (st.enviando ? ' disabled' : '') + '>' + (st.enviando ? 'Entrando...' : 'Entrar') + '</button></form>' +
      '<div class="ca-ajuda"><a href="' + WA + encodeURIComponent('Olá! Vim do site e esqueci minha senha da Central do Assinante.') + '" target="_blank" rel="noopener">Esqueci minha senha</a>' +
      '<a href="' + WA + encodeURIComponent('Olá! Vim do site e quero fazer meu primeiro acesso à Central do Assinante.') + '" target="_blank" rel="noopener">Primeiro acesso</a></div></div>';
    var lado = '<div class="ca-lado"><div class="ca-eyebrow">Tudo da sua conta em um só lugar</div><h2 class="ca-h2">Resolva em poucos toques, <span>a qualquer hora.</span></h2>' +
      '<ul class="ca-ben">' + itens.map(function (i) { return '<li><span class="ca-bi">' + ic(i[0]) + '</span><div><b>' + i[1] + '</b><small>' + i[2] + '</small></div></li>'; }).join('') + '</ul></div>';
    return '<div class="ca-entrada">' + form + lado + '</div>';
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
  function blocoCartao(f) {
    var c = st.cartao[f.id];
    if (!c) return '';
    if (c.fase === 'abrindo') return '<div class="ca-pix">' + carregando('Preparando o pagamento seguro...') + '</div>';
    if (c.fase === 'ok') return '<div class="ca-pix ca-okbox"><div class="ca-okic">✓</div><div style="font:700 19px \'Space Grotesk\',Inter,sans-serif">Pagamento aprovado</div>' +
      '<div class="ca-sub">' + brl(c.valor) + ' no cartão de crédito' + (c.autorizacao ? ' · autorização ' + esc(c.autorizacao) : '') + '.</div>' +
      '<div class="ca-sub" style="font-size:13px">' + (c.teste ? 'Ambiente de TESTE: nenhuma cobrança real foi feita e a fatura não foi baixada.' : 'A fatura será atualizada em instantes. Guarde o número de autorização.') + '</div></div>';
    if (c.fase === 'incerto') return '<div class="ca-pix"><div class="ca-msg erro" style="margin:0" role="alert">' + esc(c.msg) + '</div></div>';
    if (c.fase === 'falha') return '<div class="ca-pix"><div class="ca-msg erro" style="margin:0" role="alert">' + esc(c.msg) + '</div></div>';
    var c3d = '<div class="ca-c3d" id="c3d' + f.id + '" aria-hidden="true"><div class="ca-c3d-in">' +
      '<div class="ca-face ca-frente"><div class="ca-c3d-topo"><span class="ca-chip"></span><span class="ca-band" data-c3d="band"></span></div>' +
      '<div class="ca-c3d-num" data-c3d="num">•••• •••• •••• ••••</div>' +
      '<div class="ca-c3d-base"><div><small>Nome</small><b data-c3d="nome">SEU NOME</b></div><div><small>Validade</small><b data-c3d="val">MM/AA</b></div></div></div>' +
      '<div class="ca-face ca-verso"><div class="ca-tarja"></div><div class="ca-cvvbox"><small>CVV</small><b data-c3d="cvv">•••</b></div>' +
      '<div class="ca-c3d-obs">Pagamento seguro processado pela Cielo</div></div></div></div>';
    return '<div class="ca-pix ca-pagto">' + c3d + '<form class="ca-cartao" data-form="cartao" data-id="' + esc(f.id) + '" novalidate autocomplete="on">' +
      (c.teste ? '<div class="ca-msg info" style="margin:0 0 12px"><b>Ambiente de teste da Cielo.</b> Nenhuma cobrança real é feita.</div>' : '') +
      '<div style="font-weight:800;margin-bottom:4px">Cartão de crédito · ' + brl(c.valor) + ' à vista</div>' +
      '<label for="cc-nome' + f.id + '">Nome impresso no cartão</label><input class="ca-in bp-sop-cardholdername" id="cc-nome' + f.id + '" autocomplete="cc-name" autocapitalize="characters" spellcheck="false">' +
      '<label for="cc-num' + f.id + '">Número do cartão</label><input class="ca-in bp-sop-cardnumber" id="cc-num' + f.id + '" inputmode="numeric" autocomplete="cc-number" data-mask="cartao" maxlength="19" placeholder="0000 0000 0000 0000">' +
      '<label for="cc-doc' + f.id + '">CPF ou CNPJ do titular do cartão</label><input class="ca-in" id="cc-doc' + f.id + '" inputmode="numeric" autocomplete="off" data-mask="doc" maxlength="18" placeholder="000.000.000-00">' +
      '<div class="ca-dica">Pode ser o cartão de outra pessoa: informe o documento de quem é o dono do cartão.</div>' +
      '<div class="ca-duo"><div><label for="cc-val' + f.id + '">Validade</label><input class="ca-in bp-sop-cardexpirationdate" id="cc-val' + f.id + '" inputmode="numeric" autocomplete="cc-exp" data-mask="validade" maxlength="7" placeholder="MM/AAAA"></div>' +
      '<div><label for="cc-cvv' + f.id + '">CVV</label><input class="ca-in bp-sop-cardcvv bp-sop-cardcvvc" id="cc-cvv' + f.id + '" inputmode="numeric" autocomplete="cc-csc" data-mask="cvv" maxlength="4" placeholder="000"></div></div>' +
      (c.erro ? '<div class="ca-msg erro" role="alert">' + esc(c.erro) + '</div>' : '') +
      '<button class="ca-btn full" type="submit"' + (c.fase === 'pagando' ? ' disabled' : '') + '>' + (c.fase === 'pagando' ? 'Processando... não feche esta tela' : 'Pagar ' + brl(c.valor)) + '</button>' +
      '<div class="ca-sub" style="font-size:12.5px;margin-top:10px">🔒 Os dados do cartão vão direto para a Cielo. A UPDOWN não armazena o número do seu cartão.</div></form></div>';
  }
  function itemFatura(f) {
    return '<div class="ca-item"><div><div class="tit">Vencimento ' + data(f.vencimento) +
      (f.vencida ? '<span class="ca-tag erro">Vencida</span>' : '<span class="ca-tag alerta">Em aberto</span>') + '</div>' +
      '<div class="inf">Fatura nº ' + esc(f.documento) + (f.contrato ? ' · Contrato ' + esc(f.contrato) : '') + '</div></div>' +
      '<div class="ca-valor">' + brl(f.valor) + '</div>' +
      '<div class="acoes"><button class="ca-btn pix sm" data-act="pix" data-id="' + esc(f.id) + '"' + (st.pixCarregando === f.id ? ' disabled' : '') + '>' + (st.pixCarregando === f.id ? 'Gerando Pix...' : 'Pagar com Pix') + '</button>' +
      (f.cartao && st.eu && st.eu.cartao ? '<button class="ca-btn sm" data-act="cartao" data-id="' + esc(f.id) + '">Pagar com cartão</button>' : '') +
      '<a class="ca-btn sec sm" href="' + API + '/faturas/' + esc(f.id) + '/boleto" target="_blank" rel="noopener">Abrir boleto (PDF)</a>' +
      (f.linha_digitavel ? '<button class="ca-btn sec sm" data-act="copiar" data-txt="' + esc(f.linha_digitavel) + '" data-k="ld' + f.id + '">' + (st.copiado === 'ld' + f.id ? 'Copiado ✓' : 'Copiar código de barras') + '</button>' : '') +
      '</div>' + blocoPix(f) + blocoCartao(f) + '</div>';
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
    var k4 = '<div class="ca-card ca-kpi"><div class="rot">Atendimento</div><div class="val" style="font-size:22px">Fale com a UPDOWN</div><div class="det">Chat com a nossa equipe, já identificado com o seu cadastro.</div><button class="ca-btn sm" data-act="chat" style="margin-top:14px">Abrir chat</button></div>';
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
    document.body.classList.toggle('ca-so-login', st.fase !== 'app');
    el.innerHTML = st.fase === 'carregando' ? carregando('Abrindo a Central...') : st.fase === 'login' ? telaLogin() : telaApp();
    el.querySelectorAll('input').forEach(function (i) { if (vals[i.id] != null) i.value = i.getAttribute('data-mask') === 'cartao' && !(st.cartao[i.id.replace('cc-num', '')] || {}).enviando ? fmtCartao(vals[i.id]) : vals[i.id]; });
    if (foco && document.getElementById(foco)) document.getElementById(foco).focus();
    Object.keys(st.cartao).forEach(cartao3d);
  }

  function abrirChat() {
    contato();
    var ico = document.querySelector('.opa_ico');
    if (ico) ico.click();
    else window.open(WA + encodeURIComponent('Olá! Sou cliente UPDOWN (cadastro nº ' + (st.eu ? st.eu.id : '') + ') e preciso de atendimento.'), '_blank', 'noopener');
  }

  /* ---------- cartao (Cielo Silent Order Post) ---------- */
  var SOP_URL = 'https://www.pagador.com.br/post/scripts/silentorderpost-1.0.min.js';
  function carregaSop() {
    return new Promise(function (ok, falha) {
      if (window.bpSop_silentOrderPost) return ok();
      var sc = document.createElement('script'); sc.src = SOP_URL; sc.onload = function () { window.bpSop_silentOrderPost ? ok() : falha(); }; sc.onerror = falha;
      document.head.appendChild(sc);
    });
  }
  function bandeira(n) {
    if (/^4/.test(n)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(n)) return 'Master';
    if (/^3[47]/.test(n)) return 'Amex';
    if (/^(606282|3841)/.test(n)) return 'Hipercard';
    if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(n)) return 'Elo';
    if (/^3(0[0-5]|[68])/.test(n)) return 'Diners';
    return '';
  }
  function tamCartao(n) { return /^3[47]/.test(n) ? 15 : /^3(0[0-5]|[68])/.test(n) ? 14 : 16; }
  function fmtCartao(v) {
    var d = String(v || '').replace(/\D/g, ''); d = d.slice(0, tamCartao(d));
    if (tamCartao(d) === 15) return d.replace(/^(\d{4})(\d{1,6})?(\d{1,5})?$/, function (_, a, b, c) { return a + (b ? ' ' + b : '') + (c ? ' ' + c : ''); });
    if (tamCartao(d) === 14) return d.replace(/^(\d{4})(\d{1,6})?(\d{1,4})?$/, function (_, a, b, c) { return a + (b ? ' ' + b : '') + (c ? ' ' + c : ''); });
    return d.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  function luhn(n) { var s = 0, d, alt = false; for (var i = n.length - 1; i >= 0; i--) { d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return n.length >= 13 && s % 10 === 0; }
  function docValido(d) {
    if (!/^\d+$/.test(d) || /^(\d)\1+$/.test(d)) return false;
    var i, n, r, t;
    if (d.length === 11) { for (n = 9; n < 11; n++) { for (t = 0, i = 0; i < n; i++) t += +d[i] * (n + 1 - i); r = t * 10 % 11 % 10; if (r !== +d[n]) return false; } return true; }
    if (d.length === 14) { for (n = 12; n < 14; n++) { var p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; for (t = 0, i = 0; i < n; i++) t += +d[i] * p[i]; r = t % 11; if ((r < 2 ? 0 : 11 - r) !== +d[n]) return false; } return true; }
    return false;
  }
  function fmtDoc(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 14);
    if (d.length <= 11) return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/, '$1.$2.$3/$4-$5');
  }
  function limpaCartao(id) { ['cc-nome', 'cc-num', 'cc-val', 'cc-cvv', 'cc-doc'].forEach(function (p) { var i = document.getElementById(p + id); if (i) i.value = ''; }); }
  function abrirCartao(id) {
    if (st.cartao[id] && st.cartao[id].fase !== 'falha') { if (st.cartao[id].fase === 'form') { limpaCartao(id); delete st.cartao[id]; desenha(); } return; }
    st.cartao[id] = { fase: 'abrindo' }; desenha();
    Promise.all([api('POST', '/faturas/' + id + '/cartao/iniciar', {}), carregaSop().catch(function () { throw new Error('Não foi possível carregar o pagamento seguro da Cielo. Verifique sua conexão.'); })]).then(function (r) {
      var j = r[0];
      if (j.ja_pago) { st.cartao[id] = { fase: 'ok', valor: j.valor, autorizacao: j.autorizacao, teste: j.teste }; desenha(); return carrega(); }
      st.cartao[id] = { fase: 'form', sop: j.sop, ambiente: j.ambiente, valor: j.valor, teste: j.teste }; desenha();
      var n = document.getElementById('cc-nome' + id); if (n) n.focus();
    }).catch(function (e) { if (e.status !== 401) { st.cartao[id] = { fase: 'falha', msg: e.message }; desenha(); } });
  }
  function pagarCartao(id) {
    var c = st.cartao[id];
    if (!c || c.fase !== 'form') return;
    var nome = document.getElementById('cc-nome' + id).value.trim(), numero = document.getElementById('cc-num' + id).value.replace(/\D/g, ''),
        val = document.getElementById('cc-val' + id).value, cvv = document.getElementById('cc-cvv' + id).value;
    var doc = document.getElementById('cc-doc' + id).value.replace(/\D/g, '');
    var m = /^(\d{2})\/(\d{4})$/.exec(val), hoje = new Date();
    var erro = nome.length < 3 ? 'Digite o nome como está no cartão.' : (numero.length !== tamCartao(numero) || !luhn(numero)) ? 'Confira o número do cartão.' :
      (!m || +m[1] < 1 || +m[1] > 12 || new Date(+m[2], +m[1], 1) <= hoje) ? 'Confira a validade (MM/AAAA).' : !/^\d{3,4}$/.test(cvv) ? 'Confira o código de segurança (CVV).' : !docValido(doc) ? 'Confira o CPF ou CNPJ do titular do cartão.' : '';
    if (erro) { c.erro = erro; return desenha(); }
    c.erro = ''; c.fase = 'pagando'; desenha();
    var band = bandeira(numero);
    var campoNum = document.getElementById('cc-num' + id); if (campoNum) campoNum.value = numero;
    function recomeca(msg) {        // o token da Cielo vale para uma tentativa: pede outro e mantém o formulário
      api('POST', '/faturas/' + id + '/cartao/iniciar', {}).then(function (j) {
        if (j.ja_pago) { limpaCartao(id); st.cartao[id] = { fase: 'ok', valor: j.valor, autorizacao: j.autorizacao, teste: j.teste }; carrega(); }
        else st.cartao[id] = { fase: 'form', sop: j.sop, ambiente: j.ambiente, valor: j.valor, teste: j.teste, erro: msg };
        desenha();
      }).catch(function (e) { if (e.status !== 401) { limpaCartao(id); st.cartao[id] = { fase: 'falha', msg: msg + ' ' + e.message }; desenha(); } });
    }
    try {
      window.bpSop_silentOrderPost({
        accessToken: c.sop, environment: c.ambiente, language: 'PT', enableBinQuery: false, enableVerifyCard: false, enableTokenize: false, cvvRequired: true,
        onSuccess: function (r) {
          if (!r || !r.PaymentToken) return recomeca('A Cielo não validou o cartão. Confira os dados.');
          api('POST', '/faturas/' + id + '/cartao/pagar', { token: r.PaymentToken, bandeira: r.Brand || band, documento: doc, titular: nome }).then(function (j) {
            limpaCartao(id);
            if (j.status === 'aprovado') { st.cartao[id] = { fase: 'ok', valor: j.valor, autorizacao: j.autorizacao, teste: j.teste }; desenha(); if (!j.teste) setTimeout(carrega, 4000); }
            else if (j.status === 'incerto') { st.cartao[id] = { fase: 'incerto', msg: j.mensagem }; desenha(); }
            else recomeca(j.mensagem || 'Pagamento não autorizado.');
          }).catch(function (e) {
            limpaCartao(id);
            if (e.status === 401) return;
            // sem resposta do nosso servidor: o resultado é desconhecido, então não deixa tentar de novo às cegas
            st.cartao[id] = e.status ? { fase: 'falha', msg: e.message } : { fase: 'incerto', msg: 'Perdemos a conexão durante o pagamento. NÃO pague de novo: recarregue a página em alguns minutos para ver se a fatura foi paga.' };
            desenha();
          });
        },
        onError: function () { recomeca('A Cielo não conseguiu ler o cartão. Confira os dados e tente de novo.'); },
        onInvalid: function (v) {
          try { console.warn('Cielo SOP recusou os campos:', JSON.stringify(v)); } catch (e2) { /* sem console */ }
          var NOMES = { cardnumber: 'número do cartão', cardholdername: 'nome', holder: 'nome', cardexpirationdate: 'validade', expirationdate: 'validade', cardcvv: 'CVV', cardcvvc: 'CVV', securitycode: 'CVV' };
          var txt = (Array.isArray(v) ? v : [v]).filter(Boolean).map(function (i) {
            var campo = String(i.Field || i.field || '').toLowerCase().replace(/[^a-z]/g, ''), m = i.Message || i.message || '';
            return (NOMES[campo] ? NOMES[campo] + ': ' : (campo ? campo + ': ' : '')) + m;
          }).filter(Boolean).join(' · ');
          recomeca(txt ? 'Confira os dados do cartão. ' + txt : 'Confira os dados do cartão.');
        }
      });
    } catch (ex) { recomeca('Não foi possível iniciar o pagamento seguro.'); }
  }
  function cartao3d(id) {
    var box = document.getElementById('c3d' + id);
    if (!box) return;
    function v(p) { var i = document.getElementById(p + id); return i ? i.value : ''; }
    function poe(k, t) { var el = box.querySelector('[data-c3d="' + k + '"]'); if (el && el.textContent !== t) { el.textContent = t; el.classList.remove('ca-pisca'); void el.offsetWidth; el.classList.add('ca-pisca'); } }
    var d = v('cc-num').replace(/\D/g, ''), tam = tamCartao(d), molde = tam === 15 ? '•••• •••••• •••••' : tam === 14 ? '•••• •••••• ••••' : '•••• •••• •••• ••••', k = 0;
    poe('num', molde.replace(/•/g, function () { return k < d.length ? d[k++] : '•'; }));
    poe('nome', (v('cc-nome').trim() || 'SEU NOME').toUpperCase().slice(0, 24));
    var m = /^(\d{2})\/?(\d{0,4})/.exec(v('cc-val'));
    poe('val', m ? m[1] + '/' + (m[2].length === 4 ? m[2].slice(2) : (m[2] || 'AA')) : 'MM/AA');
    poe('cvv', v('cc-cvv').replace(/./g, '•') || '•••');
    poe('band', bandeira(d));
    box.setAttribute('data-band', bandeira(d) || '');
  }
  document.addEventListener('focusin', function (e) { var m = /^cc-cvv(\d+)$/.exec(e.target.id || ''); if (m) { var b = document.getElementById('c3d' + m[1]); if (b) b.classList.add('ca-virado'); } });
  document.addEventListener('focusout', function (e) { var m = /^cc-cvv(\d+)$/.exec(e.target.id || ''); if (m) { var b = document.getElementById('c3d' + m[1]); if (b) b.classList.remove('ca-virado'); } });
  document.addEventListener('pointermove', function (e) {
    var b = e.target.closest && e.target.closest('.ca-c3d');
    if (!b || b.classList.contains('ca-virado')) return;
    var r = b.getBoundingClientRect();
    b.style.setProperty('--tx', (((e.clientX - r.left) / r.width - .5) * 22).toFixed(1) + 'deg');
    b.style.setProperty('--ty', ((.5 - (e.clientY - r.top) / r.height) * 18).toFixed(1) + 'deg');
    b.classList.add('ca-mao');
  }, { passive: true });
  document.addEventListener('pointerout', function (e) { var b = e.target.closest && e.target.closest('.ca-c3d'); if (b && !b.contains(e.relatedTarget)) b.classList.remove('ca-mao'); }, { passive: true });
  document.addEventListener('input', function (e) {
    var i = e.target, mk = i.getAttribute && i.getAttribute('data-mask');
    if (!mk) return;
    var d = i.value.replace(/\D/g, '');
    if (mk === 'cartao') i.value = fmtCartao(d);
    else if (mk === 'validade') { d = d.slice(0, 6); if (d.length === 4 && !/^(0[1-9]|1[0-2])20/.test(d)) d = d.slice(0, 2) + '20' + d.slice(2); i.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; }
    else if (mk === 'cvv') i.value = d.slice(0, 4);
    else if (mk === 'doc') i.value = fmtDoc(d);
  });
  document.addEventListener('input', function (e) { var m = /^cc-(?:nome|num|val|cvv)(\d+)$/.exec(e.target.id || ''); if (m) cartao3d(m[1]); });

  document.addEventListener('submit', function (e) {
    var fc = e.target.closest && e.target.closest('[data-form="cartao"]');
    if (fc) { e.preventDefault(); return pagarCartao(fc.getAttribute('data-id')); }
    var f = e.target.closest && e.target.closest('[data-form="login"]');
    if (!f) return;
    e.preventDefault();
    if (st.enviando) return;
    var login = f.querySelector('#ca-login').value.trim(), senha = f.querySelector('#ca-senha').value;
    if (!login || !senha) { st.erro = 'Informe usuário e senha.'; return desenha(); }
    st.enviando = true; st.erro = ''; desenha();
    api('POST', '/login', { login: login, senha: senha }).then(function () {
      st.enviando = false; st.verSenha = false; try { localStorage.setItem('updown-central-usuario', login); } catch (e2) { /* modo privado */ }
      inicio();
    }).catch(function (er) {
      st.enviando = false; st.erro = er.status ? er.message : 'A Central está indisponível no momento. Tente em instantes.'; desenha();
      var s = document.getElementById('ca-senha'); if (s) { s.value = ''; s.focus(); }
    });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#central-app [data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'versenha') { st.verSenha = !st.verSenha; desenha(); var cs = document.getElementById('ca-senha'); if (cs) cs.focus(); }
    else if (act === 'aba') { st.aba = b.getAttribute('data-aba'); desenha(); var t = document.getElementById('central-app'); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: 'start' }); }
    else if (act === 'sair') { api('POST', '/logout', {}).catch(function () {}).then(function () { st.fase = 'login'; st.eu = null; st.erro = ''; st.aba = 'inicio'; st.pix = {}; st.cartao = {}; contato(); desenha(); }); }
    else if (act === 'recarregar') { carrega(); desenha(); }
    else if (act === 'chat') abrirChat();
    else if (act === 'cartao') abrirCartao(b.getAttribute('data-id'));
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
    var l = document.createElement('link'); l.id = 'ud-central-css'; l.rel = 'stylesheet'; l.href = '/assets/updown-central.css?v=7';
    document.head.appendChild(l);
  }
  window.UpDownCentral = { iniciar: function () { desenha(); inicio(); } };
})();
