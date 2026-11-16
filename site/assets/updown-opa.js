/* UPDOWN — tela inicial do webchat Opa Suite com Nome e Telefone.
   Substitui o "Continuar sem efetuar login" por um formulário curto; ao enviar,
   abre o chat e manda a primeira mensagem com os dados para o atendente. */
(function () {
  'use strict';
  var KEY = 'updown-webchat-contato';

  function mask(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* modo privado */ } }

  function waitSocket(opa, cb, tries) {
    tries = tries || 0;
    if (opa.socket && opa.socket.connected) return cb(true);
    if (tries > 66) return cb(!!opa.socket);           // ~20 s
    setTimeout(function () { waitSocket(opa, cb, tries + 1); }, 300);
  }

  var CSS = '' +
    /* janela do chat com a cara da UPDOWN */
    '.opa_chat.ud-chat{border-radius:18px!important;overflow:hidden!important;border:0!important;box-shadow:0 30px 70px -20px rgba(11,6,86,.55),0 0 0 1px rgba(0,4,255,.18)!important;font-family:Inter,system-ui,sans-serif!important}' +
    '.opa_chat.ud-chat .opa_cabecalho{position:relative!important;background:linear-gradient(135deg,#0004FF,#110170)!important;min-height:46px}' +
    '.opa_chat.ud-chat .opa_cabecalho::before{content:"Atendimento UPDOWN";position:absolute;left:16px;top:50%;transform:translateY(-50%);font:700 15px "Space Grotesk",Inter,sans-serif;color:#fff;pointer-events:none}' +
    '.opa_chat.ud-chat .opa_cabecalho::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,#00CEFF,#9B00FF)}' +
    /* tela inicial: sem rolagem, formulario centralizado */
    '.opa_corpo.ud-inicio{overflow:hidden!important;display:flex!important;flex-direction:column!important;justify-content:center!important;padding:0!important;background:#F4F6FF!important}' +
    '.opa_corpo.ud-inicio>div:not(.div-logins){display:none!important}' +
    '.opa_corpo.ud-inicio .div-logins{display:block!important;width:100%!important;height:auto!important;margin:0!important;padding:0!important;flex:0 0 auto!important;text-align:left!important}' +
    '.ud-wc{box-sizing:border-box;width:100%;padding:16px 18px;font-family:Inter,system-ui,sans-serif;text-align:left;color:#110170}' +
    '.ud-wc *{box-sizing:border-box}' +
    '.ud-wc h3{margin:0;font:700 18px/1.2 "Space Grotesk",Inter,sans-serif;color:#110170}' +
    '.ud-wc p{margin:4px 0 2px;font-size:13px;line-height:1.4;color:#3B3F7A}' +
    '.ud-wc label{display:block;margin-top:10px;font-size:12.5px;font-weight:700;color:#110170}' +
    '.ud-wc input{display:block;width:100%;height:44px;margin:5px 0 0;padding:0 12px;border:1.5px solid #C9CFF5;border-radius:12px;background:#fff;font:500 15px Inter,system-ui,sans-serif;color:#110170;outline:none;text-transform:none}' +
    '.ud-wc input:focus{border-color:#0004FF;box-shadow:0 0 0 3px rgba(0,4,255,.15)}' +
    '.ud-wc input[aria-invalid="true"]{border-color:#C8102E}' +
    '.ud-wc .ud-err{font-size:12px;line-height:1.3;color:#C8102E}.ud-wc .ud-err:not(:empty){margin-top:4px}' +
    '.ud-wc button{width:100%;height:46px;margin-top:14px;border:0;border-radius:12px;background:linear-gradient(135deg,#2F7BFF,#0004FF);color:#fff;font:800 15px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 12px 24px -12px #0004FF}' +
    '.ud-wc button[disabled]{opacity:.7;cursor:progress}' +
    '.ud-wc .ud-id{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 10px;border-radius:10px;background:#E8F7EE;color:#0B5A2A;font-size:12.5px;font-weight:700}' +
    '.opa_corpo .div-logins .sem-login{display:none!important}';

  function form(opa) {
    var box = opa.estrutura && opa.estrutura.logins;
    if (!box || box.querySelector('.ud-wc')) return;
    if (!document.getElementById('ud-wc-css')) {
      var st = document.createElement('style'); st.id = 'ud-wc-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var cen = window.UpDownCentralContato || null;
    if (opa.estrutura.chat) opa.estrutura.chat.classList.add('ud-chat');
    if (opa.estrutura.corpo) opa.estrutura.corpo.classList.add('ud-inicio');
    var prev = cen ? { nome: cen.nome, telefone: cen.telefone || load().telefone } : load();
    var f = document.createElement('form');
    f.className = 'ud-wc';
    f.noValidate = true;
    f.innerHTML =
      '<h3>Fale com a UPDOWN</h3>' +
      (cen ? '<div class="ud-id">✓ Você está identificado como cliente nº ' + String(cen.id).replace(/[^0-9]/g, '') + '</div>' : '<p>Informe seus dados para começarmos.</p>') +
      '<label for="ud-wc-nome">Nome</label><input id="ud-wc-nome" name="nome" autocomplete="name" placeholder="Seu nome" required>' +
      '<div class="ud-err" id="ud-wc-nome-err" aria-live="polite"></div>' +
      '<label for="ud-wc-tel">Telefone / WhatsApp</label><input id="ud-wc-tel" name="telefone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(13) 99999-9999" required>' +
      '<div class="ud-err" id="ud-wc-tel-err" aria-live="polite"></div>' +
      '<button type="submit">Iniciar atendimento</button>';
    box.insertBefore(f, box.firstChild);

    var nome = f.querySelector('#ud-wc-nome'), tel = f.querySelector('#ud-wc-tel'), bt = f.querySelector('button');
    if (prev.nome) nome.value = prev.nome;
    if (prev.telefone) tel.value = mask(prev.telefone);
    tel.addEventListener('input', function () { tel.value = mask(tel.value); });
    setTimeout(function () { (nome.value ? tel : nome).focus(); }, 50);

    function err(el, id, msg) {
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      f.querySelector('#' + id).textContent = msg || '';
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = nome.value.trim(), d = tel.value.replace(/\D/g, '');
      var ok = true;
      if (n.length < 2) { err(nome, 'ud-wc-nome-err', 'Digite seu nome.'); ok = false; } else err(nome, 'ud-wc-nome-err', '');
      if (d.length < 10) { err(tel, 'ud-wc-tel-err', 'Digite o telefone com DDD.'); ok = false; } else err(tel, 'ud-wc-tel-err', '');
      if (!ok) return;
      if (!window.UpDownCentralContato) save({ nome: n, telefone: d });
      bt.disabled = true; bt.textContent = 'Conectando...';
      waitSocket(opa, function () {
        if (opa.estrutura.corpo) opa.estrutura.corpo.classList.remove('ud-inicio');
        if (box.parentNode) box.parentNode.removeChild(box);
        opa.chat_rodape();
        var msg = 'Olá! Vim pelo site da UPDOWN.<br>Nome: ' + n.replace(/</g, '&lt;') + '<br>Telefone: ' + mask(d);
        var c2 = window.UpDownCentralContato;
        if (c2) msg = 'Olá! Estou na Central do Assinante da UPDOWN.<br>Nome: ' + n.replace(/</g, '&lt;') + '<br>Telefone: ' + mask(d) + '<br>Cliente IXC nº ' + c2.id + (c2.documento ? '<br>Documento: ' + c2.documento : '') + (c2.contratos ? '<br>Contrato(s): ' + c2.contratos : '');
        setTimeout(function () {
          try { opa.socket.emit('mensagem', '', '', { tipo: 'texto', conteudo: msg.replace(/<br>/g, '\n') }); } catch (er) { /* sem conexão */ }
        }, 400);
      });
    });
  }

  window.UpDownOpaPatch = function (opa) {
    if (!opa || opa.__ud) return;
    opa.__ud = true;
    var chat = opa.chat;
    opa.chat = function () {
      var r = chat.apply(opa, arguments);
      form(opa);
      return r;
    };
  };
})();
