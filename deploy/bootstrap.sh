#!/usr/bin/env bash
# 只初始化本项目；原有站点通过 Caddy 热加载继续提供服务。
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo '请由管理员执行'; exit 1; }
[[ $# -eq 1 && -f $1 ]] || { echo '用法：bootstrap.sh <部署公钥文件>'; exit 1; }
ssh-keygen -lf "$1" >/dev/null
if id hyperliquid-deploy >/dev/null 2>&1 || [[ -e /srv/hyperliquid ]]; then
  echo '项目或账号已存在，请检查现状，不重复初始化'
  exit 1
fi
task_source=$(cd -- "$(dirname -- "$0")" && pwd)
task_config=/home/admin/streamlab/shared/config/Caddyfile
task_extra=/home/admin/streamlab/shared/extra-sites.caddy
[[ -f $task_config ]] || { echo '找不到原 Caddy 配置'; exit 1; }
if grep -qE 'app\.fameex-testnet\.xyz|hyperliquid\.sunshinedairy\.net' "$task_config" "$task_extra"; then
  echo '域名已配置，请先检查现状'
  exit 1
fi
if ss -lntH | awk '{print $4}' | grep -qE ':8089$'; then
  echo '8089 端口已占用'
  exit 1
fi

task_backup="/root/hyperliquid-deploy-backups/$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$task_backup"
cp -p "$task_config" "$task_backup/Caddyfile"
if [[ -f $task_extra ]]; then cp -p "$task_extra" "$task_backup/extra-sites.caddy"; fi

useradd --create-home --shell /bin/bash hyperliquid-deploy
install -d -m 755 -o hyperliquid-deploy -g hyperliquid-deploy \
  /srv/hyperliquid /srv/hyperliquid/releases /srv/hyperliquid/shared
install -d -m 700 -o hyperliquid-deploy -g hyperliquid-deploy /home/hyperliquid-deploy/.ssh
{ printf 'restrict '; cat "$1"; } > /home/hyperliquid-deploy/.ssh/authorized_keys
chown hyperliquid-deploy:hyperliquid-deploy /home/hyperliquid-deploy/.ssh/authorized_keys
chmod 600 /home/hyperliquid-deploy/.ssh/authorized_keys
install -d -m 755 /srv/hyperliquid/config
install -m 644 "$task_source/compose.yml" "$task_source/nginx.conf" /srv/hyperliquid/config/
docker compose -f /srv/hyperliquid/config/compose.yml config --quiet
docker compose -f /srv/hyperliquid/config/compose.yml up -d web

{ cat "$task_config"; printf '\n'; cat "$task_source/Caddyfile"; } > "$task_backup/candidate"
docker cp "$task_backup/candidate" streamlab-proxy-1:/tmp/hyperliquid-candidate
docker exec streamlab-proxy-1 caddy validate --config /tmp/hyperliquid-candidate --adapter caddyfile
cat "$task_backup/candidate" > "$task_config"
if docker exec streamlab-proxy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  printf '\n' >> "$task_extra"
  cat "$task_source/Caddyfile" >> "$task_extra"
  chmod 644 "$task_extra"
else
  cat "$task_backup/Caddyfile" > "$task_config"
  docker exec streamlab-proxy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  exit 1
fi
printf '初始化完成；代理备份：%s\n' "$task_backup"
