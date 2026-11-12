# siteprov — Site da UpDown Internet

Site institucional da **UpDown Internet**, publicado em **https://site.updown.com.br**.

É um site estático, gerado com Astro. Não usa PHP nem banco de dados: o servidor só precisa entregar arquivos. Hospedado no servidor do projeto NIA (**UPT-UBUNTU01**), atrás do **Caddy**.

Origem da cópia: `https://chore-ajustess.updown-site.pages.dev` (Cloudflare Pages), em 12/11/2026.

## Estrutura

```
siteprov/
├── instalar-site.sh      # instala/atualiza o site no servidor (nginx + HTTPS)
└── site/                 # arquivos publicados (raiz do site)
    ├── index.html        # página inicial
    ├── planos/  apps/  empresa/  sobre/  contato/
    ├── manual-do-cliente/  trabalhe-conosco/     # cada página em pasta/index.html
    ├── _astro/           # scripts gerados pelo Astro
    ├── images/  banners/ # imagens e vídeo do banner
    ├── documentos/       # contrato Anatel (PDF)
    └── .htaccess         # só para hospedagem Apache (cPanel); o nginx ignora
```

## Páginas

| Endereço | Conteúdo |
|---|---|
| `/` | Página inicial |
| `/planos` | Planos de internet |
| `/apps` | Pacotes de TV e apps |
| `/empresa` | Soluções para empresas (B2B) |
| `/sobre` | Sobre a UpDown |
| `/contato` | Contato |
| `/manual-do-cliente` | Manual do cliente |
| `/trabalhe-conosco` | Trabalhe conosco |

## Publicar no servidor (primeira vez)

O servidor é acessado pelo **console do Proxmox**. Não é preciso SCP: o servidor baixa o site direto deste repositório.

### 1. DNS

No cPanel da HostGator, em **Editor de Zona** → `updown.com.br`, crie:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `site` | IP público do servidor | 300 |

Se o servidor estiver atrás de NAT, as portas **80** e **443** desse IP precisam chegar até ele (o certificado HTTPS depende da porta 80).

### 2. Instalar

No console do servidor, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/FelpLuis/siteprov/main/instalar-site.sh -o /root/instalar-site.sh
EMAIL=comercial@updown.com.br bash /root/instalar-site.sh
```

O script:

1. vê quem está nas portas 80/443: **Caddy** (caso do UPT-UBUNTU01) ou nginx;
2. baixa a pasta `site/` deste repositório e copia para `/var/www/site-updown`;
3. **Caddy:** acrescenta um bloco `site.updown.com.br` ao Caddyfile (entre os marcadores `# >>> site-updown` e `# <<< site-updown`), valida com `caddy validate`, faz backup do Caddyfile e recarrega. Os outros sites do Caddy (como o NIA) não são alterados. O HTTPS é emitido e renovado pelo próprio Caddy;
   **nginx:** instala `nginx`/`certbot`, cria o site e emite o certificado com o certbot;
4. testa todas as páginas.

Se o DNS ainda não tiver propagado, o site fica no ar em HTTP e o script avisa. Depois é só rodar o mesmo comando de novo.

### Opções

| Variável | Padrão | Uso |
|---|---|---|
| `DOMINIO` | `site.updown.com.br` | publicar em outro domínio |
| `EMAIL` | (vazio) | e-mail de avisos do Let's Encrypt |
| `BRANCH` | `main` | publicar outro branch do repositório |
| `SEM_SSL` | `0` | `1` pula o certificado HTTPS (só nginx) |
| `CADDYFILE` | detectado | caminho do Caddyfile, se não for o padrão |

Exemplo: `DOMINIO=www.updowntelecom.com.br EMAIL=comercial@updown.com.br bash /root/instalar-site.sh`

## Atualizar o site

1. Altere os arquivos dentro de `site/` e faça commit/push neste repositório.
2. No console do servidor:

```bash
bash /root/instalar-site.sh
```

A versão anterior fica guardada em `/var/www/site-updown.anterior-AAAAMMDD-HHMMSS`.

### Voltar para a versão anterior

```bash
ls -d /var/www/site-updown.anterior-*          # escolha a versão
mv /var/www/site-updown /var/www/site-updown.com-problema
mv /var/www/site-updown.anterior-AAAAMMDD-HHMMSS /var/www/site-updown
```

## Configuração no servidor

| Item | Local |
|---|---|
| Arquivos publicados | `/var/www/site-updown` |
| Configuração (Caddy) | bloco `# >>> site-updown` em `/etc/caddy/Caddyfile` |
| Backups do Caddyfile | `/etc/caddy/Caddyfile.bkp-AAAAMMDD-HHMMSS` |
| Configuração (nginx) | `/etc/nginx/sites-available/site-updown` |

Comandos úteis (Caddy):

```bash
caddy validate --config /etc/caddy/Caddyfile   # validar
systemctl reload caddy                         # recarregar
journalctl -u caddy -n 50 --no-pager           # log (certificado, erros)
```

Para tirar o site do ar no Caddy: apague o bloco entre `# >>> site-updown` e `# <<< site-updown` no Caddyfile e rode `systemctl reload caddy`.

## Hospedagem Apache (cPanel), se precisar

Envie o conteúdo de `site/` para `public_html`. O `.htaccess` incluído já força HTTPS, serve `/planos` a partir de `planos/index.html` e configura cache e compressão.

## Serviços externos usados pelo site

Continuam vindo de fora e não fazem parte deste repositório:

- Chat **Opa! Suite** — `opasuite.updown.com.br`
- **Central do Assinante (IXC)** — `ixc.updown.com.br`
- **VLibras** (acessibilidade em Libras)
- **Google Fonts** (Inter), **Google Tag Manager / Analytics** e **Meta Pixel**

## Observações

- O Caddyfile pode ter `CADDYFILE=/caminho/do/arquivo` informado na execução, se não for o padrão.
- 24 logos de canais em `.png` (pasta `site/images/grade` e `site/images/canais`) davam erro 404 no site de origem. Eles foram gerados a partir das versões `.webp` que já existiam. Além disso, o nginx entrega o `.webp` caso algum `.png` dessas pastas não exista.
- O código-fonte em Astro não está aqui: este repositório guarda o site já gerado. Mudanças de layout feitas no projeto Astro precisam ser geradas de novo (`npm run build`) e o conteúdo de `dist/` copiado para `site/`.
