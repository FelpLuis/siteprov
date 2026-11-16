# Central do Assinante (ponte com o IXC)

`central_api.py` roda no servidor (porta local 8787) e atende o site em `/api/central/...`.
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
