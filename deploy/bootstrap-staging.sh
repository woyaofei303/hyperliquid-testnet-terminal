#!/usr/bin/env bash
# 管理员一次性初始化；发现任何已有资源即停止，避免覆盖。
set -euo pipefail
[[ $EUID -eq 0 && $# -eq 1 && -f $1 ]] || { echo '用法：sudo bash bootstrap-staging.sh <公钥文件>'; exit 1; }
ssh-keygen -lf "$1" >/dev/null
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)/staging
project=/srv/hyperliquid-staging
config=/etc/hyperliquid-staging
caddy=/home/admin/streamlab/shared/config/Caddyfile
extra=/home/admin/streamlab/shared/extra-sites.caddy
[[ -f $caddy && -f $extra ]]
if id hyperliquid-staging-deploy >/dev/null 2>&1 || [[ -e $project || -L $project || -e $config ]]; then
  echo '预发布账号或目录已存在，停止；请核对上次操作记录'; exit 1
fi
if grep -q 'staging-app.fameex-testnet.xyz' "$caddy" "$extra" || ss -lntH | awk '{print $4}' | grep -qE ':8090$'; then
  echo '域名或 8090 端口已占用'; exit 1
fi
backup="/root/hyperliquid-deploy-backups/staging-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -p "$caddy" "$backup/Caddyfile"
cp -p "$extra" "$backup/extra-sites.caddy"
useradd --create-home --shell /bin/bash hyperliquid-staging-deploy
install -d -m 700 -o hyperliquid-staging-deploy -g hyperliquid-staging-deploy /home/hyperliquid-staging-deploy/.ssh
{ printf 'restrict '; cat "$1"; } > /home/hyperliquid-staging-deploy/.ssh/authorized_keys
chown hyperliquid-staging-deploy:hyperliquid-staging-deploy /home/hyperliquid-staging-deploy/.ssh/authorized_keys
chmod 600 /home/hyperliquid-staging-deploy/.ssh/authorized_keys
install -d -m 755 -o hyperliquid-staging-deploy -g hyperliquid-staging-deploy \
  "$project" "$project/releases" "$project/incoming" "$project/shared"
install -d -m 755 "$config"
install -m 644 "$source_dir/compose.yml" "$source_dir/nginx.conf" "$source_dir/runtime-config.json" "$config/"
docker compose -f "$config/compose.yml" config --quiet
docker compose -f "$config/compose.yml" up -d web
{ cat "$caddy"; printf '\n'; cat "$source_dir/Caddyfile"; } > "$backup/candidate"
docker cp "$backup/candidate" streamlab-proxy-1:/tmp/hyperliquid-staging-candidate
docker exec streamlab-proxy-1 caddy validate --config /tmp/hyperliquid-staging-candidate --adapter caddyfile
restore_proxy() {
  cp -p "$backup/Caddyfile" "$caddy"
  cp -p "$backup/extra-sites.caddy" "$extra"
  if ! docker exec streamlab-proxy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "代理恢复失败，请按 $backup 人工恢复" >&2
  fi
}
trap restore_proxy ERR
cat "$backup/candidate" > "$caddy"
{ printf '\n'; cat "$source_dir/Caddyfile"; } >> "$extra"
docker exec streamlab-proxy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
trap - ERR
printf '预发布初始化完成；代理备份：%s\n' "$backup"
