#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Central do Assinante UpDown - servico intermediario entre o site e o IXC Provedor.

O navegador do cliente NUNCA fala com o IXC nem ve o token da API: ele fala com este
servico (/api/central/...), que confere o login do cliente, guarda a sessao e so devolve
dados do proprio cliente logado.

Configuracao (arquivo /etc/updown-central.env, lido pelo systemd):
    IXC_URL=https://ixc.updown.com.br
    IXC_TOKEN=ID:TOKEN_DO_USUARIO_DE_API
    CENTRAL_PORTA=8787            (opcional)

Teste de comunicacao com o IXC (rodar no servidor):
    set -a; . /etc/updown-central.env; set +a; python3 central_api.py --testar [login_do_cliente]

So usa a biblioteca padrao do Python 3.8+.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

IXC_URL = os.environ.get('IXC_URL', '').rstrip('/')
IXC_TOKEN = os.environ.get('IXC_TOKEN', '')
PORTA = int(os.environ.get('CENTRAL_PORTA', '8787'))
PREFIXO = '/api/central'
SESSAO_MIN = 30                    # minutos sem uso ate a sessao expirar
COOKIE = 'ud_central'
COOKIE_SEGURO = os.environ.get('CENTRAL_COOKIE_INSEGURO', '') != '1'   # so para teste local
MAX_TENTATIVAS = 6                 # erros de login por janela
JANELA_SEG = 15 * 60

# nomes de campos do IXC que podem variar entre instalacoes (ajustaveis pelo .env)
CAMPO_LOGIN = os.environ.get('IXC_CAMPO_LOGIN', 'hotsite_email')
CAMPO_SENHA = os.environ.get('IXC_CAMPO_SENHA', 'senha')
TABELA_CONSUMO = os.environ.get('IXC_TABELA_CONSUMO', 'radusuarios_consumo_m')

_sessoes = {}
_tentativas = {}
_trava = threading.Lock()


# ----------------------------------------------------------------------------- IXC
class ErroIXC(Exception):
    pass


def _ixc(caminho, corpo, listar=True, bruto=False, timeout=25):
    if not IXC_URL or not IXC_TOKEN:
        raise ErroIXC('IXC_URL/IXC_TOKEN nao configurados')
    req = urllib.request.Request(
        IXC_URL + '/webservice/v1/' + caminho,
        data=json.dumps(corpo).encode('utf-8'), method='POST')
    req.add_header('Authorization', 'Basic ' + base64.b64encode(IXC_TOKEN.encode()).decode())
    req.add_header('Content-Type', 'application/json')
    if listar:
        req.add_header('ixcsoft', 'listar')
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            dados = r.read()
    except urllib.error.HTTPError as e:
        raise ErroIXC('IXC respondeu HTTP %s em %s' % (e.code, caminho))
    except Exception as e:                                   # rede, DNS, TLS, tempo esgotado
        raise ErroIXC('sem comunicacao com o IXC (%s)' % type(e).__name__)
    if bruto:
        return dados
    try:
        return json.loads(dados.decode('utf-8', 'replace'))
    except ValueError:
        raise ErroIXC('resposta inesperada do IXC em %s' % caminho)


def listar(tabela, campo, valor, oper='=', filtros=None, rp=50, ordem=None, sentido='desc'):
    corpo = {'qtype': '%s.%s' % (tabela, campo), 'query': str(valor), 'oper': oper,
             'page': '1', 'rp': str(rp), 'sortname': '%s.%s' % (tabela, ordem or 'id'), 'sortorder': sentido}
    if filtros:
        corpo['grid_param'] = json.dumps([{'TB': '%s.%s' % (tabela, c), 'OP': o, 'P': str(v)} for c, o, v in filtros])
    r = _ixc(tabela, corpo)
    if isinstance(r, dict) and r.get('type') == 'error':
        raise ErroIXC('IXC recusou a consulta em %s: %s' % (tabela, str(r.get('message', ''))[:120]))
    return (r.get('registros') or []) if isinstance(r, dict) else []


# ----------------------------------------------------------------------------- util
def so_digitos(s):
    return re.sub(r'\D', '', s or '')


def mascara_doc(doc):
    d = so_digitos(doc)
    if len(d) == 11:
        return '***.%s.%s-**' % (d[3:6], d[6:9])
    if len(d) == 14:
        return '**.%s.%s/****-**' % (d[2:5], d[5:8])
    return ''


def num(v):
    try:
        return round(float(str(v).replace(',', '.')), 2)
    except (TypeError, ValueError):
        return 0.0


def senha_confere(digitada, guardada):
    """O IXC guarda a senha da central em texto ou criptografada (MD5/SHA), conforme o cadastro."""
    g = (guardada or '').strip()
    if not g or not digitada:
        return False
    b = digitada.encode('utf-8')
    candidatos = [digitada, hashlib.md5(b).hexdigest(), hashlib.sha1(b).hexdigest(), hashlib.sha256(b).hexdigest()]
    ok = False
    for c in candidatos:                                      # compara todos, em tempo constante
        ok = hmac.compare_digest(c.encode(), g.encode()) or hmac.compare_digest(c.lower().encode(), g.lower().encode()) or ok
    return ok


def buscar_cliente(login):
    login = login.strip()
    achados = listar('cliente', CAMPO_LOGIN, login, rp=5)
    d = so_digitos(login)
    if not achados and len(d) in (11, 14) and d == so_digitos(login):
        fmt = ('%s.%s.%s-%s' % (d[:3], d[3:6], d[6:9], d[9:])) if len(d) == 11 else \
              ('%s.%s.%s/%s-%s' % (d[:2], d[2:5], d[5:8], d[8:12], d[12:]))
        achados = listar('cliente', 'cnpj_cpf', fmt, rp=5) or listar('cliente', 'cnpj_cpf', d, rp=5)
    return [c for c in achados if str(c.get('ativo', 'S')).upper() != 'N']


# ----------------------------------------------------------------------------- dados do cliente
ST_CONTRATO = {'P': 'Pré-contrato', 'A': 'Ativo', 'I': 'Inativo', 'N': 'Negativado', 'D': 'Desistiu'}
ST_ACESSO = {'A': 'Ativo', 'D': 'Desativado', 'CM': 'Bloqueio manual', 'CA': 'Bloqueio automático',
             'FA': 'Financeiro em atraso', 'AA': 'Aguardando assinatura'}


def faturas(id_cliente, abertas=True):
    filtros = [('status', '=', 'A')] if abertas else [('status', '=', 'R')]
    regs = listar('fn_areceber', 'id_cliente', id_cliente, filtros=filtros, rp=24 if abertas else 12,
                  ordem='data_vencimento', sentido='asc' if abertas else 'desc')
    hoje = time.strftime('%Y-%m-%d')
    saida = []
    for f in regs:
        if str(f.get('id_cliente')) != str(id_cliente):
            continue
        if abertas and str(f.get('liberado', 'S')).upper() == 'N':
            continue
        venc = str(f.get('data_vencimento') or '')[:10]
        saida.append({
            'id': str(f.get('id')),
            'vencimento': venc,
            'valor': num(f.get('valor_aberto') if abertas and num(f.get('valor_aberto')) else f.get('valor')),
            'vencida': bool(abertas and venc and venc < hoje),
            'linha_digitavel': (f.get('linha_digitavel') or '').strip() if abertas else '',
            'contrato': str(f.get('id_contrato') or ''),
            'documento': str(f.get('documento') or f.get('id') or ''),
            'pago_em': str(f.get('pagamento_data') or '')[:10] if not abertas else '',
            'valor_pago': num(f.get('valor_recebido')) if not abertas else 0,
        })
    return saida


def fatura_do_cliente(id_cliente, id_fatura):
    if not re.fullmatch(r'\d{1,12}', id_fatura or ''):
        return None
    regs = listar('fn_areceber', 'id', id_fatura, rp=1)
    if regs and str(regs[0].get('id_cliente')) == str(id_cliente):
        return regs[0]
    return None


def boleto_pdf(id_fatura):
    dados = _ixc('get_boleto', {'boletos': str(id_fatura), 'juro': 'S', 'multa': 'S', 'atualiza_boleto': 'S',
                                'tipo_boleto': 'arquivo', 'base64': 'S'}, listar=False, bruto=True, timeout=40)
    if dados[:4] == b'%PDF':
        return dados
    texto = dados.decode('utf-8', 'replace').strip()
    if texto.startswith('{') or texto.startswith('"'):
        try:
            j = json.loads(texto)
            texto = j if isinstance(j, str) else (j.get('base64') or j.get('arquivo') or j.get('pdf') or '')
        except ValueError:
            pass
    try:
        pdf = base64.b64decode(texto, validate=False)
    except Exception:
        pdf = b''
    if pdf[:4] != b'%PDF':
        raise ErroIXC('o IXC nao devolveu o PDF do boleto')
    return pdf


def _achar(obj, nomes):
    """Procura, em qualquer nivel da resposta, a primeira chave cujo nome esteja em `nomes`."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in nomes and isinstance(v, str) and v.strip():
                return v.strip()
        for v in obj.values():
            r = _achar(v, nomes)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _achar(v, nomes)
            if r:
                return r
    return ''


def pix(id_fatura):
    r = _ixc('get_pix', {'id_areceber': str(id_fatura)}, listar=False, timeout=40)
    copia = _achar(r, {'qrcode', 'qr_code', 'copia_cola', 'copiacola', 'emv', 'brcode', 'pix_copia_cola'})
    imagem = _achar(r, {'imagemqrcode', 'imagem_qrcode', 'qrcode_imagem', 'imagem', 'qrcodeimage'})
    if not copia or len(copia) < 40:
        raise ErroIXC('Pix nao disponivel para esta fatura')
    if imagem and not imagem.startswith('data:image/'):
        imagem = ('data:image/png;base64,' + imagem) if re.fullmatch(r'[A-Za-z0-9+/=\s]{200,}', imagem) else ''
    return {'copia_cola': copia, 'imagem': imagem}


def contratos(id_cliente):
    saida = []
    for c in listar('cliente_contrato', 'id_cliente', id_cliente, rp=20):
        if str(c.get('id_cliente')) != str(id_cliente):
            continue
        st, ac = str(c.get('status') or ''), str(c.get('status_internet') or '')
        end = ', '.join(x for x in [str(c.get('endereco') or '').strip(), str(c.get('numero') or '').strip(),
                                    str(c.get('bairro') or '').strip()] if x)
        saida.append({
            'id': str(c.get('id')), 'plano': str(c.get('contrato') or c.get('descricao_aux_plano_venda') or 'Contrato'),
            'status': ST_CONTRATO.get(st, st), 'acesso': ST_ACESSO.get(ac, ac),
            'assinatura_pendente': ac == 'AA',
            'assinado': ac != 'AA' and st in ('A', 'N'),
            'ativacao': str(c.get('data_ativacao') or '')[:10], 'cadastro': str(c.get('data') or '')[:10],
            'endereco': end, 'bloqueado': ac in ('CM', 'CA', 'FA'),
        })
    return saida


def consumo(id_cliente):
    """Consumo mensal por login. A tabela de consumo nao existe/nao e liberada em toda instalacao."""
    logins = [l for l in listar('radusuarios', 'id_cliente', id_cliente, rp=10) if str(l.get('id_cliente')) == str(id_cliente)]
    saida = []
    for l in logins:
        meses, disponivel = [], True
        try:
            regs = listar(TABELA_CONSUMO, 'id_login', l.get('id'), rp=6, ordem='data', sentido='desc')
            for r in regs:
                down = num(r.get('consumo') or r.get('download') or r.get('consumo_download'))
                up = num(r.get('consumo_upload') or r.get('upload'))
                meses.append({'mes': str(r.get('data') or '')[:7], 'download': down, 'upload': up})
        except ErroIXC:
            disponivel = False
        saida.append({'login': str(l.get('login') or ''), 'online': str(l.get('online') or '').upper() == 'S',
                      'contrato': str(l.get('id_contrato') or ''), 'meses': meses[::-1], 'disponivel': disponivel})
    return saida


# ----------------------------------------------------------------------------- sessao
def nova_sessao(cli):
    tok = secrets.token_urlsafe(32)
    nome = str(cli.get('razao') or cli.get('fantasia') or 'Cliente').strip()
    fone = so_digitos(cli.get('telefone_celular') or cli.get('whatsapp') or cli.get('fone') or '')
    with _trava:
        agora = time.time()
        for k in [k for k, v in _sessoes.items() if v['ate'] < agora]:
            _sessoes.pop(k, None)
        _sessoes[tok] = {'id': str(cli.get('id')), 'nome': nome, 'doc': mascara_doc(cli.get('cnpj_cpf')),
                         'telefone': fone, 'email': str(cli.get('email') or '').strip(), 'ate': agora + SESSAO_MIN * 60}
    return tok


def sessao_de(tok):
    with _trava:
        s = _sessoes.get(tok or '')
        if not s or s['ate'] < time.time():
            _sessoes.pop(tok or '', None)
            return None
        s['ate'] = time.time() + SESSAO_MIN * 60
        return s


def bloqueado(chave):
    with _trava:
        agora = time.time()
        lst = [t for t in _tentativas.get(chave, []) if t > agora - JANELA_SEG]
        _tentativas[chave] = lst
        return len(lst) >= MAX_TENTATIVAS


def registra_falha(chave):
    with _trava:
        _tentativas.setdefault(chave, []).append(time.time())


# ----------------------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    server_version = 'UpDownCentral'
    sys_version = ''

    def log_message(self, fmt, *args):                        # log sem dados do cliente
        sys.stderr.write('%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), fmt % args))

    def _ip(self):
        return (self.headers.get('X-Forwarded-For', '').split(',')[-1].strip() or self.client_address[0])

    def _json(self, cod, obj, cookie=None):
        dados = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(cod)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(dados)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(dados)

    def _cookie(self, valor, idade):
        return '%s=%s; Path=%s; Max-Age=%d; HttpOnly; SameSite=Strict%s' % (
            COOKIE, valor, PREFIXO, idade, '; Secure' if COOKIE_SEGURO else '')

    def _token(self):
        m = re.search(r'(?:^|;\s*)%s=([A-Za-z0-9_\-]{20,80})' % COOKIE, self.headers.get('Cookie', ''))
        return m.group(1) if m else ''

    def _sessao(self):
        s = sessao_de(self._token())
        if not s:
            self._json(401, {'erro': 'sessao', 'mensagem': 'Sua sessão expirou. Entre novamente.'})
        return s

    def do_POST(self):
        rota = self.path.split('?')[0]
        if self.headers.get('X-Requested-With') != 'UpDownCentral' or 'application/json' not in self.headers.get('Content-Type', ''):
            return self._json(400, {'erro': 'requisicao'})
        try:
            tam = min(int(self.headers.get('Content-Length', '0')), 4096)
            corpo = json.loads(self.rfile.read(tam).decode('utf-8') or '{}')
        except Exception:
            return self._json(400, {'erro': 'requisicao'})
        if rota == PREFIXO + '/login':
            return self.login(corpo)
        if rota == PREFIXO + '/logout':
            with _trava:
                _sessoes.pop(self._token(), None)
            return self._json(200, {'ok': True}, cookie=self._cookie('', 0))
        self._json(404, {'erro': 'rota'})

    def login(self, corpo):
        login = str(corpo.get('login') or '').strip()[:120]
        senha = str(corpo.get('senha') or '')[:120]
        chaves = ['ip:' + self._ip(), 'lg:' + login.lower()]
        if any(bloqueado(c) for c in chaves):
            return self._json(429, {'erro': 'bloqueado', 'mensagem': 'Muitas tentativas. Aguarde 15 minutos e tente de novo.'})
        if not login or not senha:
            return self._json(400, {'erro': 'dados', 'mensagem': 'Informe usuário e senha.'})
        try:
            achados = buscar_cliente(login)
        except ErroIXC as e:
            self.log_message('login: %s', e)
            return self._json(502, {'erro': 'ixc', 'mensagem': 'Não conseguimos consultar seu cadastro agora. Tente em instantes.'})
        cli = next((c for c in achados if senha_confere(senha, c.get(CAMPO_SENHA))), None)
        if not cli:
            for c in chaves:
                registra_falha(c)
            time.sleep(0.6)
            return self._json(401, {'erro': 'login', 'mensagem': 'Usuário ou senha incorretos.'})
        tok = nova_sessao(cli)
        self._json(200, {'ok': True}, cookie=self._cookie(tok, SESSAO_MIN * 60))

    def do_GET(self):
        rota = self.path.split('?')[0].rstrip('/')
        if rota == PREFIXO + '/saude':
            return self._json(200, {'ok': True, 'configurado': bool(IXC_URL and IXC_TOKEN)})
        if not rota.startswith(PREFIXO + '/'):
            return self._json(404, {'erro': 'rota'})
        s = self._sessao()
        if not s:
            return
        try:
            if rota == PREFIXO + '/eu':
                return self._json(200, {'id': s['id'], 'nome': s['nome'], 'documento': s['doc'], 'telefone': s['telefone'], 'email': s['email']})
            if rota == PREFIXO + '/faturas':
                return self._json(200, {'abertas': faturas(s['id'], True), 'pagas': faturas(s['id'], False)})
            if rota == PREFIXO + '/contratos':
                return self._json(200, {'contratos': contratos(s['id'])})
            if rota == PREFIXO + '/consumo':
                return self._json(200, {'logins': consumo(s['id'])})
            m = re.fullmatch(re.escape(PREFIXO) + r'/faturas/(\d{1,12})/(boleto|pix)', rota)
            if m:
                fat = fatura_do_cliente(s['id'], m.group(1))
                if not fat:                                    # fatura de outro cliente ou inexistente
                    return self._json(404, {'erro': 'fatura', 'mensagem': 'Fatura não encontrada.'})
                if m.group(2) == 'pix':
                    return self._json(200, pix(m.group(1)))
                pdf = boleto_pdf(m.group(1))
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf')
                self.send_header('Content-Disposition', 'inline; filename="updown-fatura-%s.pdf"' % m.group(1))
                self.send_header('Content-Length', str(len(pdf)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                return self.wfile.write(pdf)
        except ErroIXC as e:
            self.log_message('ixc: %s', e)
            return self._json(502, {'erro': 'ixc', 'mensagem': 'Não conseguimos buscar essa informação agora. Tente em instantes.'})
        self._json(404, {'erro': 'rota'})


# ----------------------------------------------------------------------------- diagnostico
def testar(login=None):
    print('IXC_URL  :', IXC_URL or '(vazio)')
    print('IXC_TOKEN:', ('configurado, usuario de API ' + IXC_TOKEN.split(':')[0]) if IXC_TOKEN else '(vazio)')

    def tenta(nome, fn):
        try:
            r = fn()
            print('  [OK]   %-34s %s' % (nome, r))
            return True
        except Exception as e:
            print('  [FALHA] %-33s %s' % (nome, e))
            return False

    print('Consultas basicas:')
    tenta('cliente (lista)', lambda: '%d registro(s)' % len(listar('cliente', 'id', '0', '>', rp=1)))
    tenta('campo de login "%s"' % CAMPO_LOGIN, lambda: 'filtro aceito (%d)' % len(listar('cliente', CAMPO_LOGIN, 'teste-inexistente', rp=1)))
    tenta('fn_areceber', lambda: '%d registro(s)' % len(listar('fn_areceber', 'id', '0', '>', rp=1)))
    tenta('cliente_contrato', lambda: '%d registro(s)' % len(listar('cliente_contrato', 'id', '0', '>', rp=1)))
    tenta('radusuarios', lambda: '%d registro(s)' % len(listar('radusuarios', 'id', '0', '>', rp=1)))
    tenta('consumo (%s)' % TABELA_CONSUMO, lambda: '%d registro(s)' % len(listar(TABELA_CONSUMO, 'id', '0', '>', rp=1)))
    if login:
        print('Cliente "%s":' % login)
        try:
            achados = buscar_cliente(login)
        except Exception as e:
            achados = []
            print('  [FALHA] busca:', e)
        if not achados:
            print('  nenhum cliente ativo com esse login')
            return
        c = achados[0]
        g = str(c.get(CAMPO_SENHA) or '')
        print('  encontrado: id %s | campo "%s": %s' % (c.get('id'), CAMPO_SENHA,
              'vazio' if not g else ('criptografada (%d caracteres)' % len(g) if re.fullmatch(r'[0-9a-fA-F]{32,64}', g) else 'texto simples')))
        tenta('faturas abertas', lambda: '%d' % len(faturas(c.get('id'), True)))
        tenta('contratos', lambda: '%d' % len(contratos(c.get('id'))))
        tenta('consumo', lambda: '; '.join('%s: %s' % (l['login'], ('%d mes(es)' % len(l['meses'])) if l['disponivel'] else 'indisponivel') for l in consumo(c.get('id'))) or 'sem login')
        ab = faturas(c.get('id'), True)
        if ab:
            tenta('boleto PDF da fatura %s' % ab[0]['id'], lambda: '%d bytes' % len(boleto_pdf(ab[0]['id'])))
            tenta('Pix da fatura %s' % ab[0]['id'], lambda: 'copia e cola com %d caracteres' % len(pix(ab[0]['id'])['copia_cola']))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--testar':
        testar(sys.argv[2] if len(sys.argv) > 2 else None)
        sys.exit(0)
    if not IXC_URL or not IXC_TOKEN:
        sys.stderr.write('AVISO: IXC_URL/IXC_TOKEN nao configurados em /etc/updown-central.env\n')
    srv = ThreadingHTTPServer(('127.0.0.1', PORTA), H)
    sys.stderr.write('Central do Assinante ouvindo em 127.0.0.1:%d\n' % PORTA)
    srv.serve_forever()
