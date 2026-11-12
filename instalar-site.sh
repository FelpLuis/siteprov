#!/usr/bin/env bash
# Instala o site estatico da UpDown no nginx e publica em site.updown.com.br
# Repositorio: https://github.com/FelpLuis/siteprov
# Uso (como root, no console do servidor):
#   curl -fsSL https://raw.githubusercontent.com/FelpLuis/siteprov/main/instalar-site.sh -o /root/instalar-site.sh
#   bash /root/instalar-site.sh
# Variaveis opcionais:
#   DOMINIO=site.updown.com.br  EMAIL=voce@updown.com.br  SEM_SSL=1
set -euo pipefail

DOMINIO="${DOMINIO:-site.updown.com.br}"
EMAIL="${EMAIL:-}"
REPO="${REPO:-FelpLuis/siteprov}"
BRANCH="${BRANCH:-main}"
DESTINO="/var/www/site-updown"
CONF="/etc/nginx/sites-available/site-updown"

verde(){ printf '\033[32m%s\033[0m\n' "$*"; }
amarelo(){ printf '\033[33m%s\033[0m\n' "$*"; }
erro(){ printf '\033[31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || erro "rode como root (sudo bash instalar-site.sh)"

# 1. Quem esta usando as portas 80 e 443?
for p in 80 443; do
  dono=$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | sed 's/users:(("//' || true)
  if [ -n "$dono" ] && [ "$dono" != "nginx" ]; then
    erro "a porta $p esta com o processo '$dono', nao com o nginx. O site precisa do nginx na 80/443. Me mande a saida de: ss -ltnp | grep -E ':(80|443) '"
  fi
done

# 2. Pacotes
verde "[1/5] Instalando nginx, curl e certbot..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx curl certbot python3-certbot-nginx >/dev/null

# 3. Baixa o site do GitHub
URL_TAR="${URL_TAR:-https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz}"
verde "[2/5] Baixando o site de github.com/$REPO ($BRANCH)..."
TMP=$(mktemp -d)
curl -fsSL --max-time 300 "$URL_TAR" -o "$TMP/site.tar.gz" || erro "nao consegui baixar $URL_TAR. Verifique a saida do servidor para a internet."
tar -xzf "$TMP/site.tar.gz" -C "$TMP"
ORIGEM=$(find "$TMP" -mindepth 2 -maxdepth 2 -type d -name site | head -1)
[ -n "$ORIGEM" ] && [ -f "$ORIGEM/index.html" ] || erro "o repositorio nao tem a pasta site/ com index.html"
echo "  $(find "$ORIGEM" -type f | wc -l) arquivos ($(du -sh "$ORIGEM" | cut -f1))"

verde "  Instalando em $DESTINO..."
if [ -d "$DESTINO" ]; then
  mv "$DESTINO" "${DESTINO}.anterior-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$DESTINO"
cp -a "$ORIGEM/." "$DESTINO/"
rm -f "$DESTINO/.htaccess"   # so vale para Apache
rm -rf "$TMP"
chown -R www-data:www-data "$DESTINO"
find "$DESTINO" -type d -exec chmod 755 {} +
find "$DESTINO" -type f -exec chmod 644 {} +

# 4. Site no nginx (nao mexe nos outros sites do servidor)
LISTEN6=""; [ -s /proc/net/if_inet6 ] && LISTEN6="    listen [::]:80;"
verde "[3/5] Configurando o nginx para $DOMINIO..."
if [ -f "$CONF" ] && grep -q 'managed by Certbot' "$CONF"; then
  amarelo "  $CONF ja tem HTTPS do certbot; mantendo a configuracao atual (so os arquivos foram trocados)."
else
cat > "$CONF" <<EOF
server {
    listen 80;
$LISTEN6
    server_name $DOMINIO;

    root $DESTINO;
    index index.html;
    charset utf-8;

    # /planos, /planos/ e /planos/index.html servem a mesma pagina
    location / {
        try_files \$uri \$uri/index.html \$uri.html =404;
    }
    location ~ ^/(.+)/\$ {
        return 301 /\$1\$is_args\$args;
    }

    # logos .png que nao existem no original: entrega a versao .webp
    location ~ ^/images/(?<pasta>grade|canais)/(?<nome>.+)\.png\$ {
        expires 30d;
        try_files \$uri /images/\$pasta/\$nome.webp =404;
    }

    # scripts do Astro tem hash no nome: cache longo
    location /_astro/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }
    location ~* \.(webp|png|jpe?g|svg|ico|mp4|pdf)\$ {
        expires 30d;
        add_header Cache-Control "public";
        try_files \$uri =404;
    }

    location ~ /\. { deny all; }

    gzip on;
    gzip_types text/plain text/css application/javascript image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
EOF
fi
ln -sf "$CONF" /etc/nginx/sites-enabled/site-updown
nginx -t
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

# 5. Teste local
verde "[4/5] Testando as paginas no proprio servidor..."
falhou=0
for pg in / /planos /apps /empresa /sobre /contato /manual-do-cliente /trabalhe-conosco /_astro/ /images/logo.webp /images/grade/sbt.png; do
  [ "$pg" = "/_astro/" ] && continue
  cod=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMINIO" "http://127.0.0.1$pg")
  printf '  %-22s %s\n' "$pg" "$cod"
  [ "$cod" = 200 ] || falhou=1
done
[ $falhou = 0 ] || erro "alguma pagina nao respondeu 200 (veja acima)"

# 6. HTTPS
if [ "${SEM_SSL:-0}" = 1 ]; then
  amarelo "[5/5] SEM_SSL=1: pulando o certificado. Site em http://$DOMINIO"
  exit 0
fi
verde "[5/5] Gerando certificado HTTPS (Let's Encrypt)..."
IP_PUB=$(curl -s4 --max-time 8 https://api.ipify.org || true)
IP_DNS=$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}' || true)
echo "  IP publico deste servidor: ${IP_PUB:-?}"
echo "  $DOMINIO aponta para:      ${IP_DNS:-(ainda nao resolve)}"
if [ -z "$IP_DNS" ]; then
  amarelo "  O DNS ainda nao propagou. Crie o registro A e rode o mesmo comando de novo"
  exit 0
fi
if [ -n "$IP_PUB" ] && [ "$IP_PUB" != "$IP_DNS" ]; then
  amarelo "  Atencao: o DNS aponta para $IP_DNS e este servidor sai pela internet como $IP_PUB."
  amarelo "  Se houver NAT/firewall na frente, garanta que as portas 80 e 443 de $IP_DNS chegam aqui."
fi
if [ -n "$EMAIL" ]; then CB_MAIL=(--email "$EMAIL"); else CB_MAIL=(--register-unsafely-without-email); fi
certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --redirect "${CB_MAIL[@]}"
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx
verde "Pronto: https://$DOMINIO"
