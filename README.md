# siteprov — Site da UpDown Internet

Site institucional da **UpDown Internet**, publicado em **https://site.updown.com.br**.

É um site estático, gerado com Astro. Não usa PHP nem banco de dados: o servidor só precisa entregar arquivos (nginx).

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

1. confere se as portas 80/443 estão livres ou com o nginx (se outro programa estiver usando, ele para e avisa);
2. instala `nginx`, `curl` e `certbot`;
3. baixa a pasta `site/` deste repositório e copia para `/var/www/site-updown`;
4. cria o site `site.updown.com.br` no nginx, **sem alterar os outros sites do servidor**;
5. testa todas as páginas localmente;
6. confere o DNS e emite o certificado HTTPS (Let's Encrypt), com renovação automática.

Se o DNS ainda não tiver propagado, o site fica no ar em HTTP e o script avisa. Depois é só rodar o mesmo comando de novo.

### Opções

| Variável | Padrão | Uso |
|---|---|---|
| `DOMINIO` | `site.updown.com.br` | publicar em outro domínio |
| `EMAIL` | (vazio) | e-mail de avisos do Let's Encrypt |
| `BRANCH` | `main` | publicar outro branch do repositório |
| `SEM_SSL` | `0` | `1` pula o certificado HTTPS |

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
systemctl reload nginx
```

## Configuração no servidor

| Item | Local |
|---|---|
| Arquivos publicados | `/var/www/site-updown` |
| Site do nginx | `/etc/nginx/sites-available/site-updown` |
| Certificado | `/etc/letsencrypt/live/site.updown.com.br/` |
| Logs | `/var/log/nginx/access.log` e `error.log` |

Comandos úteis:

```bash
nginx -t && systemctl reload nginx   # validar e recarregar o nginx
certbot certificates                 # ver validade do certificado
certbot renew --dry-run              # testar a renovação
```

## Hospedagem Apache (cPanel), se precisar

Envie o conteúdo de `site/` para `public_html`. O `.htaccess` incluído já força HTTPS, serve `/planos` a partir de `planos/index.html` e configura cache e compressão.

## Serviços externos usados pelo site

Continuam vindo de fora e não fazem parte deste repositório:

- Chat **Opa! Suite** — `opasuite.updown.com.br`
- **Central do Assinante (IXC)** — `ixc.updown.com.br`
- **VLibras** (acessibilidade em Libras)
- **Google Fonts** (Inter), **Google Tag Manager / Analytics** e **Meta Pixel**

## Observações

- 24 logos de canais em `.png` (pasta `site/images/grade` e `site/images/canais`) davam erro 404 no site de origem. Eles foram gerados a partir das versões `.webp` que já existiam. Além disso, o nginx entrega o `.webp` caso algum `.png` dessas pastas não exista.
- O código-fonte em Astro não está aqui: este repositório guarda o site já gerado. Mudanças de layout feitas no projeto Astro precisam ser geradas de novo (`npm run build`) e o conteúdo de `dist/` copiado para `site/`.
