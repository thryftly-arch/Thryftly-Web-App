#!/usr/bin/env bash
# THRYFTLY WordPress bridge, one paste: WordPress + WooCommerce + Qikink's plugin + HTTPS + a read-only
# WooCommerce key for the shop. For a fresh Ubuntu 22.04/24.04 server (e.g. Google Cloud e2-micro).
# Safe to run again (e.g. once DNS is pointing, to get HTTPS).
#
#   sudo bash gcp-bridge-setup.sh sync.thryftly.com you@example.com
#
# Then: wp-admin → Qikink plugin → email, OTP, Approve; and put WC_URL / WC_KEY / WC_SECRET into Netlify.
set -euo pipefail

DOMAIN="${1:?usage: sudo bash gcp-bridge-setup.sh <domain> <email>}"
EMAIL="${2:?usage: sudo bash gcp-bridge-setup.sh <domain> <email>}"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
WEB=/var/www/bridge
export DEBIAN_FRONTEND=noninteractive
# WP-CLI runs as the web server user, started from a folder that user can enter: from your home folder
# its helper processes fail with "proc_open(): posix_spawn() failed: Permission denied".
cd /tmp
wp() { (cd /tmp && sudo -u www-data HOME=/tmp /usr/local/bin/wp --path="$WEB" "$@"); }

echo "== 1/7 Swap (the free server has 1 GB of memory)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 2/7 Packages (5-10 minutes on the free server; a brand-new server may first finish its own updates)"
# Progress stays visible (a silent screen here looks stuck). apt waits up to 15 min for Ubuntu's first-boot updates.
apt-get -o DPkg::Lock::Timeout=900 update -y
apt-get -o DPkg::Lock::Timeout=900 install -y -q apache2 mariadb-server php libapache2-mod-php php-mysql php-curl php-gd php-mbstring \
  php-xml php-zip php-intl php-bcmath unzip curl certbot python3-certbot-apache

echo "== 3/7 Database"
[ -f /root/.bridge-db ] || openssl rand -hex 16 > /root/.bridge-db
chmod 600 /root/.bridge-db
DBPASS=$(cat /root/.bridge-db)
mysql -e "CREATE DATABASE IF NOT EXISTS bridge DEFAULT CHARACTER SET utf8mb4;
  CREATE USER IF NOT EXISTS 'bridge'@'localhost' IDENTIFIED BY '$DBPASS';
  ALTER USER 'bridge'@'localhost' IDENTIFIED BY '$DBPASS';
  GRANT ALL ON bridge.* TO 'bridge'@'localhost'; FLUSH PRIVILEGES;"

echo "== 4/7 WordPress"
[ -x /usr/local/bin/wp ] || { curl -sSLo /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar; chmod +x /usr/local/bin/wp; }
mkdir -p "$WEB" && chown www-data:www-data "$WEB"
[ -f "$WEB/wp-load.php" ] || wp core download --quiet
[ -f "$WEB/wp-config.php" ] || wp config create --dbname=bridge --dbuser=bridge --dbpass="$DBPASS" --quiet
ADMINPASS=""
if ! wp core is-installed 2>/dev/null; then
  ADMINPASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  wp core install --url="https://$DOMAIN" --title="THRYFTLY sync" --admin_user=thryftly \
    --admin_password="$ADMINPASS" --admin_email="$EMAIL" --skip-email --quiet
fi
wp option update blog_public 0 --quiet            # keep it out of Google
wp rewrite structure '/%postname%/' --quiet         # WooCommerce's API needs "pretty" links
cat > "$WEB/.htaccess" <<'HT'
# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase /
RewriteRule ^index\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
</IfModule>
# END WordPress
HT
chown www-data:www-data "$WEB/.htaccess"

echo "== 5/7 Web server"
cat > /etc/apache2/sites-available/bridge.conf <<EOF
<VirtualHost *:80>
  ServerName $DOMAIN
  DocumentRoot $WEB
  <Directory $WEB>
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
EOF
a2enmod rewrite >/dev/null
a2ensite bridge >/dev/null
a2dissite 000-default >/dev/null 2>&1 || true
systemctl reload apache2

echo "== 6/7 WooCommerce + Qikink plugin"
wp plugin is-installed woocommerce || wp plugin install woocommerce --quiet
wp plugin activate woocommerce --quiet
wp plugin is-installed qikink-pod-and-drop-shipping || wp plugin install qikink-pod-and-drop-shipping --quiet
wp plugin activate qikink-pod-and-drop-shipping --quiet
# A read-only REST key for the shop (created once).
KEYS=$(wp eval '
  global $wpdb; $t = $wpdb->prefix . "woocommerce_api_keys";
  if ($wpdb->get_var("SELECT COUNT(*) FROM $t WHERE description = \"THRYFTLY shop (read)\"")) { echo "EXISTS"; return; }
  $ck = "ck_" . wc_rand_hash(); $cs = "cs_" . wc_rand_hash();
  $wpdb->insert($t, ["user_id" => 1, "description" => "THRYFTLY shop (read)", "permissions" => "read",
    "consumer_key" => wc_api_hash($ck), "consumer_secret" => $cs, "truncated_key" => substr($ck, -7)]);
  echo "WC_KEY=$ck\nWC_SECRET=$cs";')

echo "== 7/7 HTTPS"
MYIP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || curl -s https://api.ipify.org)
DNSIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)
HTTPS=no
if [ -n "$DNSIP" ] && [ "$DNSIP" = "$MYIP" ]; then
  if certbot --apache -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect >/dev/null; then HTTPS=yes
  else echo "   Let's Encrypt couldn't issue the certificate yet: check the firewall allows HTTP/HTTPS, then run this again."; fi
else
  echo "   $DOMAIN points to '${DNSIP:-nothing}', this server is $MYIP."
  echo "   Add the A record (Name: ${DOMAIN%%.*}, Value: $MYIP) in Netlify DNS, wait a few minutes and run this script again."
fi

echo
echo "================ DONE ================"
echo "WordPress admin: https://$DOMAIN/wp-admin   (http:// until HTTPS is on)"
if [ -n "$ADMINPASS" ]; then echo "   user: thryftly   password: $ADMINPASS   ← save this now, it isn't shown again"; fi
echo "HTTPS: $HTTPS"
if [ "$KEYS" = "EXISTS" ]; then
  echo "Shop key: already created earlier (WooCommerce → Settings → Advanced → REST API)."
else
  echo "Put these three into Netlify → Environment variables, then redeploy:"
  echo "   WC_URL=https://$DOMAIN"
  printf '%s\n' "$KEYS" | sed 's/^/   /'
fi
echo "Next: wp-admin → Qikink (left menu) → your Qikink email → OTP → Approve."
