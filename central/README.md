# Central do Assinante (ponte com o IXC)

`central_api.py` roda no servidor (porta local escolhida pelo instalador, padrão 8797) e atende o site em `/api/central/...`.
O navegador do cliente nunca fala com o IXC nem vê o token.

- Instalação: feita pelo `instalar-site.sh` (serviço `updown-central`).
- Configuração: `/etc/updown-central.env` (só root lê). **Nunca coloque o token neste repositório.**

```
IXC_URL=https://ixc.updown.com.br
IXC_TOKEN=ID:TOKEN
```

- Depois de editar: `systemctl restart updown-central`
- Diagnóstico: `set -a; . /etc/updown-central.env; set +a; python3 /opt/updown-central/central_api.py --testar LOGIN_DO_CLIENTE`
- Logs: `journalctl -u updown-central -n 50`

Se a instalação do IXC usar outros nomes, ajuste no `.env`:
`IXC_CAMPO_LOGIN` (padrão `hotsite_email`), `IXC_CAMPO_SENHA` (padrão `senha`), `IXC_TABELA_CONSUMO` (padrão `radusuarios_consumo_m`).

## Pagamento com cartão de crédito (Cielo)

O número do cartão **não passa por este servidor**: o navegador envia o cartão direto para a Cielo
(Silent Order Post) e o serviço recebe só um token de uso único. Vem **desligado**; para ligar, acrescente em
`/etc/updown-central.env`:

```
CARTAO_ATIVO=1
CIELO_AMBIENTE=sandbox          # sandbox = teste, sem cobrança real e sem baixa | producao = cobrança real
```

Com `sandbox` e nada mais, valem as credenciais públicas de teste da Cielo. Para produção:

```
CIELO_AMBIENTE=producao
CIELO_MERCHANT_ID=...           # os mesmos da carteira de cartão no IXC
CIELO_MERCHANT_KEY=...
CIELO_SOP_CLIENT_ID=...         # credencial do Silent Order Post (pedir à Cielo; é diferente do Merchant Key)
CIELO_SOP_CLIENT_SECRET=...
# baixa automática da fatura no IXC depois do pagamento aprovado (os 4 são obrigatórios para a baixa)
IXC_BAIXA_FILIAL=...            # filial do recebimento
IXC_BAIXA_CONTA=...             # conta que recebe (campo conta_)
IXC_BAIXA_PLANEJAMENTO=...      # planejamento analítico (campo id_conta)
IXC_BAIXA_TIPO=...              # tipo de recebimento usado para cartão no seu IXC
```

- Conferir a configuração sem cobrar nada: `python3 /opt/updown-central/central_api.py --testar-cartao`
- Pagamentos aprovados sem baixa ou com resultado incerto: `python3 /opt/updown-central/central_api.py --pendencias`
- Registro de todas as tentativas (sem dados de cartão): `/var/lib/updown-central/cartao.jsonl`
- Faturas vencidas não aceitam cartão (o valor com juros vem do boleto/Pix). Para aceitar: `CARTAO_ACEITA_VENCIDA=1`.
- O usuário de API do IXC precisa de permissão em `fn_areceber_recebimentos_baixas_novo` para a baixa automática.

Antes dos comandos acima: `set -a; . /etc/updown-central.env; set +a` e, para ler o registro, rode como root com
`STATE_DIRECTORY=/var/lib/updown-central`.
