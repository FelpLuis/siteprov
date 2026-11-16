/* UpDown — tela inicial do webchat Opa Suite com Nome e Telefone.
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
    '.ud-wc{box-sizing:border-box;width:100%;padding:18px 16px 16px;font-family:Inter,system-ui,sans-serif;text-align:left;color:#110170}' +
    '.ud-wc *{box-sizing:border-box}' +
    '.ud-wc h3{margin:0;font:700 18px/1.2 "Space Grotesk",Inter,sans-serif;color:#110170}' +
    '.ud-wc p{margin:6px 0 14px;font-size:13px;line-height:1.45;color:#3B3F7A}' +
    '.ud-wc label{display:block;margin-top:10px;font-size:12.5px;font-weight:700;color:#110170}' +
    '.ud-wc input{display:block;width:100%;height:44px;margin-top:5px;padding:0 12px;border:1.5px solid #C9CFF5;border-radius:12px;background:#fff;font:500 15px Inter,system-ui,sans-serif;color:#110170;outline:none}' +
    '.ud-wc input:focus{border-color:#0004FF;box-shadow:0 0 0 3px rgba(0,4,255,.15)}' +
    '.ud-wc input[aria-invalid="true"]{border-color:#C8102E}' +
    '.ud-wc .ud-err{min-height:16px;margin-top:4px;font-size:12px;color:#C8102E}' +
    '.ud-wc button{width:100%;height:46px;margin-top:10px;border:0;border-radius:12px;background:linear-gradient(135deg,#2F7BFF,#0004FF);color:#fff;font:800 15px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 12px 24px -12px #0004FF}' +
    '.ud-wc button[disabled]{opacity:.7;cursor:progress}' +
    '.ud-wc small{display:block;margin-top:10px;font-size:11px;line-height:1.4;color:#55598C}' +
    '.opa_corpo .div-logins .sem-login{display:none!important}';

  function form(opa) {
    var box = opa.estrutura && opa.estrutura.logins;
    if (!box || box.querySelector('.ud-wc')) return;
    if (!document.getElementById('ud-wc-css')) {
      var st = document.createElement('style'); st.id = 'ud-wc-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var cen = window.UpDownCentralContato || null;
    var prev = cen ? { nome: cen.nome, telefone: cen.telefone || load().telefone } : load();
    var f = document.createElement('form');
    f.className = 'ud-wc';
    f.noValidate = true;
    f.innerHTML =
      '<h3>Fale com a UpDown</h3>' +
      '<p>' + (cen ? 'Confirme seus dados para começarmos. Seu cadastro vai junto para o atendente.' : 'Informe seus dados para começarmos o atendimento.') + '</p>' +
      '<label for="ud-wc-nome">Nome</label><input id="ud-wc-nome" name="nome" autocomplete="name" placeholder="Seu nome" required>' +
      '<div class="ud-err" id="ud-wc-nome-err" aria-live="polite"></div>' +
      '<label for="ud-wc-tel">Telefone / WhatsApp</label><input id="ud-wc-tel" name="telefone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(13) 99999-9999" required>' +
      '<div class="ud-err" id="ud-wc-tel-err" aria-live="polite"></div>' +
      '<button type="submit">Iniciar atendimento</button>' +
      '<small>Usamos seus dados só para este atendimento.</small>';
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
        if (box.parentNode) box.parentNode.removeChild(box);
        opa.chat_rodape();
        var msg = 'Olá! Vim pelo site da UpDown.<br>Nome: ' + n.replace(/</g, '&lt;') + '<br>Telefone: ' + mask(d);
        var c2 = window.UpDownCentralContato;
        if (c2) msg = 'Olá! Estou na Central do Assinante da UpDown.<br>Nome: ' + n.replace(/</g, '&lt;') + '<br>Telefone: ' + mask(d) + '<br>Cliente IXC nº ' + c2.id + (c2.documento ? '<br>Documento: ' + c2.documento : '') + (c2.contratos ? '<br>Contrato(s): ' + c2.contratos : '');
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
