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

# 1. Quem esta usando as portas 80 e 443? (nginx ou caddy)
MODO=""
for p in 80 443; do
  dono=$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | sed 's/users:(("//' || true)
  case "$dono" in
    "") ;;
    nginx) MODO="${MODO:-nginx}" ;;
    caddy) MODO=caddy ;;
    *) erro "a porta $p esta com o processo '$dono'. O script sabe usar nginx ou caddy. Me mande a saida de: ss -ltnp | grep -E ':(80|443) '" ;;
  esac
done
MODO="${MODO:-nginx}"
echo "  Servidor web nas portas 80/443: $MODO"

# 2. Pacotes
export DEBIAN_FRONTEND=noninteractive
if [ "$MODO" = caddy ]; then
  verde "[1/5] Caddy ja esta rodando; ele cuida do HTTPS. Conferindo curl..."
  command -v curl >/dev/null || { apt-get update -qq; apt-get install -y -qq curl >/dev/null; }
else
  verde "[1/5] Instalando nginx, curl e certbot..."
  apt-get update -qq
  apt-get install -y -qq nginx curl certbot python3-certbot-nginx >/dev/null
fi

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
chown -R root:root "$DESTINO"
find "$DESTINO" -type d -exec chmod 755 {} +
find "$DESTINO" -type f -exec chmod 644 {} +

# ---------- Modo Caddy (servidor do NIA) ----------
if [ "$MODO" = caddy ]; then
  # descobre o Caddyfile em uso
  CADDYFILE="${CADDYFILE:-}"
  if [ -z "$CADDYFILE" ]; then
    CADDYFILE=$(systemctl cat caddy 2>/dev/null | grep -o -- '--config [^ ]*' | head -1 | awk '{print $2}')
    CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
  fi
  if ! systemctl is-active --quiet caddy || [ ! -f "$CADDYFILE" ]; then
    erro "o caddy nao esta rodando como servico do sistema com $CADDYFILE (pode estar em Docker). Me mande a saida de: systemctl status caddy --no-pager; ps aux | grep -i [c]addy"
  fi
  verde "[3/5] Adicionando $DOMINIO ao Caddy ($CADDYFILE)..."
  BKP="$CADDYFILE.bkp-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CADDYFILE" "$BKP"
  echo "  Copia de seguranca: $BKP"
  NOVO=$(mktemp)
  # remove bloco antigo deste script (se existir) e acrescenta o novo
  awk '/^# >>> site-updown/{f=1} !f{print} /^# <<< site-updown/{f=0}' "$CADDYFILE" > "$NOVO"
  if grep -qE "^[[:space:]]*(https?://)?$DOMINIO([:, ]|\{|$)" "$NOVO"; then
    rm -f "$NOVO"
    erro "o $CADDYFILE ja tem um bloco para $DOMINIO feito a mao. Remova esse bloco ou me mande o arquivo."
  fi
  cat >> "$NOVO" <<EOF

# >>> site-updown (gerado por instalar-site.sh - github.com/$REPO)
$DOMINIO {
	root * $DESTINO
	encode zstd gzip

	# /planos/ -> /planos
	@barraFinal path_regexp barra ^/(.+)/\$
	redir @barraFinal /{re.barra.1} 301

	# logos .png que nao existem: entrega a versao .webp
	@pngFalta {
		path_regexp png ^/images/(grade|canais)/(.+)\\.png\$
		not file
	}
	rewrite @pngFalta /images/{re.png.1}/{re.png.2}.webp

	# /planos -> /planos/index.html
	try_files {path} {path}/index.html {path}.html

	@oculto path_regexp oculto /\\.
	respond @oculto 404

	header /_astro/* Cache-Control "public, max-age=31536000, immutable"
	@estatico path *.webp *.png *.jpg *.jpeg *.svg *.ico *.mp4 *.pdf
	header @estatico Cache-Control "public, max-age=2592000"
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}

	file_server
}
# <<< site-updown
EOF
  if ! caddy validate --config "$NOVO" --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
    tail -15 /tmp/caddy-validate.log; rm -f "$NOVO"
    erro "a configuracao nova do Caddy nao passou na validacao (nada foi alterado)."
  fi
  cat "$NOVO" > "$CADDYFILE"; rm -f "$NOVO"
  if ! systemctl reload caddy; then
    cp -a "$BKP" "$CADDYFILE"; systemctl reload caddy || true
    erro "o reload do Caddy falhou; restaurei o Caddyfile anterior. Veja: journalctl -u caddy -n 30 --no-pager"
  fi

  verde "[4/5] Conferindo DNS..."
  IP_PUB=$(curl -s4 --max-time 8 https://api.ipify.org || true)
  IP_DNS=$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}' || true)
  echo "  IP publico deste servidor: ${IP_PUB:-?}"
  echo "  $DOMINIO aponta para:      ${IP_DNS:-(ainda nao resolve)}"

  verde "[5/5] Testando (o Caddy emite o HTTPS sozinho; pode levar ~1 min)..."
  ok=0
  for i in $(seq 1 18); do
    cod=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$DOMINIO:443:127.0.0.1" "https://$DOMINIO/" || true)
    [ "$cod" = 200 ] && { ok=1; break; }
    sleep 5
  done
  if [ $ok = 1 ]; then
    falhou=0
    for pg in / /planos /apps /empresa /sobre /contato /manual-do-cliente /trabalhe-conosco /images/logo.webp /images/grade/sbt.png; do
      cod=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$DOMINIO:443:127.0.0.1" "https://$DOMINIO$pg")
      printf '  %-22s %s\n' "$pg" "$cod"; [ "$cod" = 200 ] || falhou=1
    done
    [ $falhou = 0 ] || erro "alguma pagina nao respondeu 200 (veja acima)"
    verde "Pronto: https://$DOMINIO"
  else
    amarelo "  O site ja esta configurado, mas o Caddy ainda nao conseguiu o certificado."
    amarelo "  Confira: registro A '$DOMINIO' -> IP publico, portas 80/443 liberadas ate este servidor."
    amarelo "  Log: journalctl -u caddy -n 40 --no-pager | grep -i $DOMINIO"
    amarelo "  Assim que o DNS propagar, o Caddy tenta de novo sozinho (nao precisa rodar o script)."
  fi
  exit 0
fi
# ---------- Modo nginx ----------

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
