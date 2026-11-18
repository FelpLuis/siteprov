#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Central do Assinante UpDown - servico intermediario entre o site e o IXC Provedor.

O navegador do cliente NUNCA fala com o IXC nem ve o token da API: ele fala com este
servico (/api/central/...), que confere o login do cliente, guarda a sessao e so devolve
dados do proprio cliente logado.

Configuracao (arquivo /etc/updown-central.env, lido pelo systemd):
    IXC_URL=https://ixc.updown.com.br
    IXC_TOKEN=ID:TOKEN_DO_USUARIO_DE_API
    CENTRAL_PORTA=8797            (opcional; o instalador escolhe uma porta livre)

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
PORTA = int(os.environ.get('CENTRAL_PORTA', '8797'))
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


# ----- pagamento com cartao (Cielo API E-commerce + Silent Order Post) -----
# O numero do cartao NUNCA passa por este servico: o navegador do cliente envia o cartao direto
# para a Cielo (Silent Order Post) e este servico so recebe um token de uso unico (PaymentToken).
CARTAO_ATIVO = os.environ.get('CARTAO_ATIVO', '0') == '1'
CIELO_AMBIENTE = 'producao' if os.environ.get('CIELO_AMBIENTE', 'sandbox').lower().startswith('prod') else 'sandbox'
_SANDBOX = CIELO_AMBIENTE == 'sandbox'
# no sandbox, se nada for informado, valem as credenciais publicas de teste da documentacao da Cielo
CIELO_MERCHANT_ID = os.environ.get('CIELO_MERCHANT_ID', '832ce400-9c97-4fe7-9d4f-0928675e36cd' if _SANDBOX else '')
CIELO_MERCHANT_KEY = os.environ.get('CIELO_MERCHANT_KEY', 'IIHc5F35mO9BS1FQ64ZGaqqYPG9L1OvMh2ld8kYv' if _SANDBOX else '')
CIELO_SOP_CLIENT_ID = os.environ.get('CIELO_SOP_CLIENT_ID', '6631016d-72e6-4db1-a2d2-9cbe61464925' if _SANDBOX else '')
CIELO_SOP_CLIENT_SECRET = os.environ.get('CIELO_SOP_CLIENT_SECRET', 'flY1vN/dDx/5A9g/shJoOlTEiZfb9bZrig/WtJojqMM=' if _SANDBOX else '')
CIELO_OAUTH = os.environ.get('CIELO_URL_OAUTH', 'https://authsandbox.braspag.com.br/oauth2/token' if _SANDBOX else 'https://auth.braspag.com.br/oauth2/token')
CIELO_SOP = os.environ.get('CIELO_URL_SOP', 'https://transactionsandbox.pagador.com.br/post/api/public/v2/accesstoken' if _SANDBOX else 'https://transaction.pagador.com.br/post/api/public/v2/accesstoken')
CIELO_API = os.environ.get('CIELO_URL_API', 'https://apisandbox.cieloecommerce.cielo.com.br' if _SANDBOX else 'https://api.cieloecommerce.cielo.com.br').rstrip('/')
CIELO_CONSULTA = os.environ.get('CIELO_URL_CONSULTA', 'https://apiquerysandbox.cieloecommerce.cielo.com.br' if _SANDBOX else 'https://apiquery.cieloecommerce.cielo.com.br').rstrip('/')
CARTAO_DESCRICAO = re.sub(r'[^A-Za-z0-9 ]', '', os.environ.get('CARTAO_DESCRICAO', 'UPDOWN'))[:13]
CARTAO_ACEITA_VENCIDA = os.environ.get('CARTAO_ACEITA_VENCIDA', '0') == '1'
# baixa automatica no IXC depois do pagamento aprovado (so em producao e com estes campos preenchidos)
BAIXA_FILIAL = os.environ.get('IXC_BAIXA_FILIAL', '')
BAIXA_CONTA = os.environ.get('IXC_BAIXA_CONTA', '')
BAIXA_PLANEJAMENTO = os.environ.get('IXC_BAIXA_PLANEJAMENTO', '')
BAIXA_TIPO = os.environ.get('IXC_BAIXA_TIPO', '')
DIARIO = os.path.join(os.environ.get('STATE_DIRECTORY', '/var/lib/updown-central').split(':')[0], 'cartao.jsonl')
_trava_cartao = threading.Lock()

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


def doc_valido(d):
    """Confere os digitos verificadores de um CPF (11) ou CNPJ (14) so com numeros."""
    if not d.isdigit() or len(set(d)) == 1:
        return False
    if len(d) == 11:
        for n in (9, 10):
            r = sum(int(d[i]) * (n + 1 - i) for i in range(n)) * 10 % 11 % 10
            if r != int(d[n]):
                return False
        return True
    if len(d) == 14:
        for n in (12, 13):
            pesos = ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if n == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
            r = sum(int(d[i]) * pesos[i] for i in range(n)) % 11
            if (0 if r < 2 else 11 - r) != int(d[n]):
                return False
        return True
    return False


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
    hashes = [hashlib.md5(b).hexdigest(), hashlib.sha1(b).hexdigest(), hashlib.sha256(b).hexdigest()]
    # Senha em texto: comparação EXATA (maiúsculas contam). Só o hash hexadecimal
    # é comparado sem caixa, porque o IXC pode gravá-lo em maiúsculas.
    ok = hmac.compare_digest(digitada.encode('utf-8'), g.encode('utf-8'))
    for c in hashes:                                          # compara todos, em tempo constante
        ok = hmac.compare_digest(c.encode(), g.lower().encode()) or ok
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
            'cartao': bool(abertas and cartao_configurado() and (CARTAO_ACEITA_VENCIDA or not (venc and venc < hoje))),
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


# ----------------------------------------------------------------------------- cartao (Cielo)
class ErroCielo(Exception):
    pass


def cartao_configurado():
    return bool(CARTAO_ATIVO and CIELO_MERCHANT_ID and CIELO_MERCHANT_KEY and CIELO_SOP_CLIENT_ID and CIELO_SOP_CLIENT_SECRET)


def baixa_configurada():
    return bool(not _SANDBOX and BAIXA_FILIAL and BAIXA_CONTA and BAIXA_PLANEJAMENTO and BAIXA_TIPO)


def _http(metodo, url, cab=None, corpo=None, timeout=30):
    """Devolve (codigo_http, json_ou_None). Levanta ErroCielo so quando nao houve resposta."""
    req = urllib.request.Request(url, data=corpo, method=metodo)
    for k, v in (cab or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            cod, dados = r.status, r.read()
    except urllib.error.HTTPError as e:
        cod, dados = e.code, e.read()
    except Exception as e:
        raise ErroCielo('sem resposta de %s (%s)' % (url.split('/')[2], type(e).__name__))
    try:
        return cod, json.loads(dados.decode('utf-8', 'replace') or 'null')
    except ValueError:
        return cod, None


def sop_token():
    """Token de uso unico para o navegador enviar o cartao direto a Cielo."""
    basic = base64.b64encode(('%s:%s' % (CIELO_SOP_CLIENT_ID, CIELO_SOP_CLIENT_SECRET)).encode()).decode()
    cod, j = _http('POST', CIELO_OAUTH, {'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded'},
                   b'grant_type=client_credentials')
    if cod != 200 and cod != 201 or not isinstance(j, dict) or not j.get('access_token'):
        raise ErroCielo('a Cielo recusou as credenciais do Silent Order Post (HTTP %s)' % cod)
    cod, j = _http('POST', CIELO_SOP, {'Authorization': 'Bearer ' + j['access_token'], 'MerchantId': CIELO_MERCHANT_ID,
                                       'Content-Type': 'application/json'}, b'')
    if cod not in (200, 201) or not isinstance(j, dict) or not j.get('AccessToken'):
        raise ErroCielo('a Cielo nao gerou o token do Silent Order Post (HTTP %s)' % cod)
    return j['AccessToken']


def _diario_ler():
    reg = []
    try:
        with open(DIARIO, encoding='utf-8') as f:
            for linha in f:
                try:
                    reg.append(json.loads(linha))
                except ValueError:
                    pass
    except FileNotFoundError:
        pass
    return reg


def _diario_gravar(item):
    item = dict(item, quando=time.strftime('%Y-%m-%d %H:%M:%S'))
    os.makedirs(os.path.dirname(DIARIO), exist_ok=True)
    with open(DIARIO, 'a', encoding='utf-8') as f:
        f.write(json.dumps(item, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())
    return item


def situacao_cartao(id_fatura):
    """Ultimo registro de cartao desta fatura no ambiente atual (ou None)."""
    ult = None
    for r in _diario_ler():
        if str(r.get('fatura')) == str(id_fatura) and r.get('ambiente') == CIELO_AMBIENTE:
            ult = r
    return ult


def _cab_cielo():
    return {'MerchantId': CIELO_MERCHANT_ID, 'MerchantKey': CIELO_MERCHANT_KEY, 'Content-Type': 'application/json',
            'RequestId': secrets.token_hex(16)}


def cielo_consultar(pedido):
    """Procura na Cielo um pedido cujo resultado ficou incerto. Devolve o Payment (dict) ou None se nao existe."""
    cod, j = _http('GET', '%s/1/sales?merchantOrderId=%s' % (CIELO_CONSULTA, pedido), _cab_cielo())
    if cod == 404:
        return None
    if cod != 200 or not isinstance(j, dict):
        raise ErroCielo('consulta do pedido falhou (HTTP %s)' % cod)
    pays = j.get('Payments') or []
    if not pays:
        return None
    achado = None
    for p in pays:
        cod, j = _http('GET', '%s/1/sales/%s' % (CIELO_CONSULTA, p.get('PaymentId')), _cab_cielo())
        if cod != 200 or not isinstance(j, dict) or not isinstance(j.get('Payment'), dict):
            raise ErroCielo('consulta do pagamento falhou (HTTP %s)' % cod)
        achado = j['Payment']
        if int(achado.get('Status') or 0) == 2:                # se houver mais de um, o confirmado prevalece
            break
    return achado


def cielo_cobrar(pedido, centavos, nome, token, bandeira, documento=''):
    cartao = {'PaymentToken': token}
    if bandeira:
        cartao['Brand'] = bandeira
    cliente = {'Name': nome[:120] or 'Cliente'}
    if len(documento) in (11, 14):                            # a Cielo exige o CPF/CNPJ do pagador (Customer.Identity)
        cliente['Identity'] = documento
        cliente['IdentityType'] = 'CPF' if len(documento) == 11 else 'CNPJ'
    corpo = json.dumps({'MerchantOrderId': pedido, 'Customer': cliente,
                        'Payment': {'Type': 'CreditCard', 'Amount': centavos, 'Installments': 1, 'Capture': True,
                                    'SoftDescriptor': CARTAO_DESCRICAO, 'CreditCard': cartao}}).encode('utf-8')
    cod, j = _http('POST', CIELO_API + '/1/sales/', _cab_cielo(), corpo, timeout=45)
    if cod == 404:                                            # a documentacao do SOP cita /v2/sales; 404 nao gera cobranca
        cod, j = _http('POST', CIELO_API + '/v2/sales/', _cab_cielo(), corpo, timeout=45)
    return cod, j


def baixar_no_ixc(id_fatura, valor, pedido, autorizacao):
    v = '%.2f' % valor
    r = _ixc('fn_areceber_recebimentos_baixas_novo', {
        'filial_id': BAIXA_FILIAL, 'id_receber': str(id_fatura), 'conta_': BAIXA_CONTA, 'id_conta': BAIXA_PLANEJAMENTO,
        'tipo_recebimento': BAIXA_TIPO, 'data': time.strftime('%d/%m/%Y'), 'valor_parcela': v, 'credito': v, 'debito': v,
        'valor_total_recebido': v,
        'historico': 'Cartao de credito pela Central do Assinante - Cielo pedido %s autorizacao %s' % (pedido, autorizacao or '-'),
    }, listar=False)
    if not isinstance(r, dict) or r.get('type') != 'success':
        raise ErroIXC('IXC nao confirmou a baixa: %s' % str((r or {}).get('message', r))[:160])


def _finalizar_aprovado(base, pay, valor):
    """Pagamento confirmado na Cielo: registra e tenta dar baixa no IXC."""
    aut = str(pay.get('AuthorizationCode') or pay.get('ProofOfSale') or '')
    reg = dict(base, status='aprovado', pagamento=str(pay.get('PaymentId') or ''), tid=str(pay.get('Tid') or ''), autorizacao=aut)
    _diario_gravar(reg)
    if _SANDBOX:
        _diario_gravar(dict(reg, status='teste', obs='sandbox: nenhuma cobranca real e nenhuma baixa no IXC'))
        return {'status': 'aprovado', 'teste': True, 'autorizacao': aut, 'valor': valor}
    if not baixa_configurada():
        _diario_gravar(dict(reg, status='baixa_pendente', obs='baixa automatica nao configurada'))
        return {'status': 'aprovado', 'baixa': 'pendente', 'autorizacao': aut, 'valor': valor}
    try:
        baixar_no_ixc(base['fatura'], valor, base['pedido'], aut)
        _diario_gravar(dict(reg, status='baixado'))
        return {'status': 'aprovado', 'baixa': 'ok', 'autorizacao': aut, 'valor': valor}
    except ErroIXC as e:
        _diario_gravar(dict(reg, status='baixa_pendente', obs=str(e)[:200]))
        return {'status': 'aprovado', 'baixa': 'pendente', 'autorizacao': aut, 'valor': valor}


def cartao_liberado(fat, id_cliente):
    """Pode oferecer cartao para esta fatura? Devolve (ok, motivo)."""
    if str(fat.get('id_cliente')) != str(id_cliente) or str(fat.get('status')) != 'A':
        return False, 'Esta fatura não está mais em aberto.'
    venc = str(fat.get('data_vencimento') or '')[:10]
    if not CARTAO_ACEITA_VENCIDA and venc and venc < time.strftime('%Y-%m-%d'):
        return False, 'Fatura vencida: pague por Pix ou boleto, que já trazem o valor atualizado.'
    return True, ''


def _resolver_incerto(ult, valor):
    """Um pagamento anterior ficou sem resposta: confere na Cielo antes de permitir nova tentativa."""
    pay = cielo_consultar(ult['pedido'])
    if pay is None:
        _diario_gravar(dict(ult, status='nao_encontrado'))
        return None
    st = int(pay.get('Status') or 0)
    if st == 2:
        return _finalizar_aprovado(ult, pay, valor)
    if st in (3, 10, 11, 13):
        _diario_gravar(dict(ult, status='negado', retorno=str(pay.get('ReturnCode') or '')))
        return None
    raise ErroCielo('pagamento anterior ainda em analise (status %s)' % st)


def cartao_iniciar(sessao, id_fatura):
    fat = fatura_do_cliente(sessao['id'], id_fatura)
    if not fat:
        return 404, {'erro': 'fatura', 'mensagem': 'Fatura não encontrada.'}
    ok, motivo = cartao_liberado(fat, sessao['id'])
    if not ok:
        return 409, {'erro': 'cartao', 'mensagem': motivo}
    valor = num(fat.get('valor_aberto')) or num(fat.get('valor'))
    with _trava_cartao:
        ult = situacao_cartao(id_fatura)
        if ult and ult.get('status') in ('aprovado', 'baixado', 'baixa_pendente'):
            return 409, {'erro': 'pago', 'mensagem': 'Esta fatura já foi paga com cartão. A baixa aparece em instantes.'}
        if ult and ult.get('status') in ('iniciado', 'incerto'):
            try:
                r = _resolver_incerto(ult, valor)
            except ErroCielo as e:
                sys.stderr.write('cartao: %s\n' % e)
                return 409, {'erro': 'analise', 'mensagem': 'Estamos confirmando um pagamento anterior desta fatura. Tente de novo em alguns minutos ou fale com a gente.'}
            if r:
                return 200, dict(r, ja_pago=True)
    return 200, {'sop': sop_token(), 'ambiente': 'sandbox' if _SANDBOX else 'production', 'valor': valor, 'teste': _SANDBOX}


def cartao_pagar(sessao, id_fatura, token, bandeira, documento='', titular=''):
    if not re.fullmatch(r'[0-9a-fA-F\-]{30,40}', token or ''):
        return 400, {'erro': 'token', 'mensagem': 'Não foi possível ler o cartão. Tente novamente.'}
    documento = so_digitos(documento)
    if documento and not doc_valido(documento):
        return 400, {'erro': 'documento', 'mensagem': 'Confira o CPF ou CNPJ do titular do cartão.'}
    documento = documento or sessao.get('doc_num', '')       # sem o campo, vale o documento do cadastro
    titular = re.sub(r'[^A-Za-zÀ-ÿ .\'-]', '', titular or '').strip()[:60] or sessao['nome']
    bandeira = bandeira if bandeira in ('Visa', 'Master', 'Amex', 'Elo', 'Hipercard', 'Diners', 'Discover', 'JCB', 'Aura') else ''
    with _trava_cartao:                                        # uma cobranca por vez: evita clique duplo e abas duplicadas
        fat = fatura_do_cliente(sessao['id'], id_fatura)
        if not fat:
            return 404, {'erro': 'fatura', 'mensagem': 'Fatura não encontrada.'}
        ok, motivo = cartao_liberado(fat, sessao['id'])
        if not ok:
            return 409, {'erro': 'cartao', 'mensagem': motivo}
        ult = situacao_cartao(id_fatura)
        if ult and ult.get('status') in ('iniciado', 'incerto', 'aprovado', 'baixado', 'baixa_pendente'):
            return 409, {'erro': 'analise', 'mensagem': 'Já existe um pagamento com cartão em andamento para esta fatura.'}
        valor = num(fat.get('valor_aberto')) or num(fat.get('valor'))
        centavos = int(round(valor * 100))
        if centavos <= 0:
            return 409, {'erro': 'valor', 'mensagem': 'Não foi possível calcular o valor desta fatura.'}
        pedido = 'F%sT%s%s' % (id_fatura, time.strftime('%y%m%d%H%M%S'), secrets.token_hex(2).upper())
        base = {'fatura': str(id_fatura), 'cliente': sessao['id'], 'pedido': pedido, 'centavos': centavos, 'ambiente': CIELO_AMBIENTE}
        _diario_gravar(dict(base, status='iniciado'))           # gravado ANTES de cobrar: nada se perde se o servico cair
        try:
            cod, j = cielo_cobrar(pedido, centavos, titular, token, bandeira, documento)
        except ErroCielo as e:
            _diario_gravar(dict(base, status='incerto', obs=str(e)[:200]))
            return 202, {'status': 'incerto', 'mensagem': 'Não recebemos a confirmação da operadora. NÃO pague de novo: estamos conferindo e a fatura será atualizada.'}
        pay = j.get('Payment') if isinstance(j, dict) else None
        if cod in (200, 201) and isinstance(pay, dict):
            st = int(pay.get('Status') or 0)
            if st == 2:
                return 200, _finalizar_aprovado(base, pay, valor)
            if st in (0, 1, 12):
                _diario_gravar(dict(base, status='incerto', pagamento=str(pay.get('PaymentId') or ''), obs='status %s' % st))
                return 202, {'status': 'incerto', 'mensagem': 'A operadora ainda está analisando o pagamento. NÃO pague de novo: a fatura será atualizada.'}
            _diario_gravar(dict(base, status='negado', retorno=str(pay.get('ReturnCode') or ''), obs=str(pay.get('ReturnMessage') or '')[:120]))
            return 200, {'status': 'negado', 'mensagem': 'Pagamento não autorizado pelo banco emissor. Confira os dados ou use outro cartão.'}
        if 400 <= cod < 500:                                   # requisicao recusada: nada foi cobrado
            det = j[0].get('Message') if isinstance(j, list) and j and isinstance(j[0], dict) else ''
            _diario_gravar(dict(base, status='erro', obs='HTTP %s %s' % (cod, str(det)[:120])))
            sys.stderr.write('cartao: Cielo HTTP %s %s\n' % (cod, str(det)[:120]))
            return 200, {'status': 'negado', 'mensagem': 'A operadora não aceitou a transação. Confira os dados do cartão ou tente outra forma de pagamento.'}
        _diario_gravar(dict(base, status='incerto', obs='HTTP %s' % cod))
        return 202, {'status': 'incerto', 'mensagem': 'Não recebemos a confirmação da operadora. NÃO pague de novo: estamos conferindo e a fatura será atualizada.'}


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
                         'doc_num': so_digitos(cli.get('cnpj_cpf')),   # fica so na memoria do servidor; nunca vai ao navegador
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


_csp_janela = [0.0, 0]


def _csp_cota():
    """No máximo 60 relatórios de CSP por minuto no log (o endpoint é público)."""
    with _trava:
        agora = time.time()
        if agora - _csp_janela[0] > 60:
            _csp_janela[0], _csp_janela[1] = agora, 0
        _csp_janela[1] += 1
        return _csp_janela[1] <= 60


# ----------------------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    server_version = 'UpDownCentral'
    sys_version = ''
    # Sem timeout, quem anuncia Content-Length e não manda o corpo (ou lê a resposta
    # devagar) prende a thread para sempre (slowloris). Vale por operação de socket,
    # não para a chamada à Cielo/IXC, que tem timeout próprio.
    timeout = 30

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

    def csp_report(self):
        """Relatórios de CSP da página de pagamento (PCI-DSS 6.4.3/11.6.1): script que não
        está na lista aparece no journal. Só registra; nunca guarda dado do cliente."""
        try:
            tam = max(0, min(int(self.headers.get('Content-Length', '0')), 8192))
            rel = json.loads(self.rfile.read(tam).decode('utf-8', 'replace') or '{}')
        except Exception:
            rel = {}
        r = rel.get('csp-report') if isinstance(rel, dict) else None
        if isinstance(r, dict) and _csp_cota():
            def corta(v):
                return re.sub(r'[\x00-\x1f]', '', str(v or ''))[:200]
            self.log_message('csp: %s bloqueado=%s pagina=%s', corta(r.get('violated-directive') or r.get('effective-directive')),
                             corta(r.get('blocked-uri')), corta(str(r.get('document-uri') or '').split('?')[0]))
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        rota = self.path.split('?')[0]
        if rota == PREFIXO + '/csp-report':
            return self.csp_report()
        if self.headers.get('X-Requested-With') != 'UpDownCentral' or 'application/json' not in self.headers.get('Content-Type', ''):
            return self._json(400, {'erro': 'requisicao'})
        try:
            tam = max(0, min(int(self.headers.get('Content-Length', '0')), 4096))   # negativo = read(-1) sem fim
            corpo = json.loads(self.rfile.read(tam).decode('utf-8') or '{}')
        except Exception:
            return self._json(400, {'erro': 'requisicao'})
        if rota == PREFIXO + '/login':
            return self.login(corpo)
        if rota == PREFIXO + '/logout':
            with _trava:
                _sessoes.pop(self._token(), None)
            return self._json(200, {'ok': True}, cookie=self._cookie('', 0))
        m = re.fullmatch(re.escape(PREFIXO) + r'/faturas/(\d{1,12})/cartao/(iniciar|pagar)', rota)
        if m:
            s = self._sessao()
            if not s:
                return
            if not cartao_configurado():
                return self._json(404, {'erro': 'cartao', 'mensagem': 'Pagamento com cartão indisponível.'})
            try:
                if m.group(2) == 'iniciar':
                    cod, r = cartao_iniciar(s, m.group(1))
                else:
                    cod, r = cartao_pagar(s, m.group(1), str(corpo.get('token') or ''), str(corpo.get('bandeira') or ''),
                                           str(corpo.get('documento') or '')[:20], str(corpo.get('titular') or '')[:80])
                return self._json(cod, r)
            except ErroCielo as e:
                self.log_message('cartao: %s', e)
                return self._json(502, {'erro': 'cielo', 'mensagem': 'O pagamento com cartão está indisponível agora. Use Pix ou boleto, ou tente em instantes.'})
            except ErroIXC as e:
                self.log_message('ixc: %s', e)
                return self._json(502, {'erro': 'ixc', 'mensagem': 'Não conseguimos consultar a fatura agora. Tente em instantes.'})
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
                return self._json(200, {'id': s['id'], 'nome': s['nome'], 'documento': s['doc'], 'telefone': s['telefone'], 'email': s['email'], 'cartao': cartao_configurado(), 'cartao_teste': bool(cartao_configurado() and _SANDBOX)})
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


def testar_cartao():
    print('CARTAO_ATIVO      :', 'sim' if CARTAO_ATIVO else 'NAO (defina CARTAO_ATIVO=1)')
    print('CIELO_AMBIENTE    :', CIELO_AMBIENTE, '(cobrancas de teste, sem baixa no IXC)' if _SANDBOX else '(COBRANCAS REAIS)')
    print('Merchant ID       :', (CIELO_MERCHANT_ID[:8] + '...') if CIELO_MERCHANT_ID else '(vazio)')
    print('Merchant Key      :', 'configurada' if CIELO_MERCHANT_KEY else '(vazia)')
    print('SOP ClientId      :', (CIELO_SOP_CLIENT_ID[:8] + '...') if CIELO_SOP_CLIENT_ID else '(vazio) - solicite a credencial do Silent Order Post na Cielo')
    print('Baixa automatica  :', 'configurada' if baixa_configurada() else ('desligada no sandbox' if _SANDBOX else 'NAO configurada (IXC_BAIXA_FILIAL/CONTA/PLANEJAMENTO/TIPO): pagamentos ficam como baixa pendente'))
    print('Diario            :', DIARIO)
    try:
        t = sop_token()
        print('  [OK]   token do Silent Order Post gerado (%d caracteres). Nenhuma cobranca foi feita.' % len(t))
    except Exception as e:
        print('  [FALHA] Silent Order Post:', e)


def pendencias():
    ult = {}
    for r in _diario_ler():
        ult[(r.get('ambiente'), r.get('pedido'))] = r
    pend = [r for r in ult.values() if r.get('ambiente') == 'producao' and r.get('status') in ('iniciado', 'incerto', 'aprovado', 'baixa_pendente')]
    if not pend:
        print('Nenhuma pendencia de cartao.')
    for r in pend:
        print('%s | fatura %s | cliente %s | R$ %.2f | pedido %s | %s | %s' % (r.get('quando'), r.get('fatura'), r.get('cliente'),
              (r.get('centavos') or 0) / 100.0, r.get('pedido'),
              {'baixa_pendente': 'PAGO na Cielo, FALTA a baixa no IXC', 'aprovado': 'PAGO na Cielo, FALTA a baixa no IXC'}.get(r.get('status'), 'resultado INCERTO: confira no portal da Cielo'),
              r.get('obs', '')))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--testar-cartao':
        testar_cartao()
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == '--pendencias':
        pendencias()
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == '--testar':
        testar(sys.argv[2] if len(sys.argv) > 2 else None)
        sys.exit(0)
    if not IXC_URL or not IXC_TOKEN:
        sys.stderr.write('AVISO: IXC_URL/IXC_TOKEN nao configurados em /etc/updown-central.env\n')
    srv = ThreadingHTTPServer(('127.0.0.1', PORTA), H)
    sys.stderr.write('Central do Assinante ouvindo em 127.0.0.1:%d\n' % PORTA)
    srv.serve_forever()
