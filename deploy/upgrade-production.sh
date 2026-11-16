#!/usr/bin/env bash
# 现有站点只新增公开配置和 Nginx 路由，热加载，不重建容器。
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请由管理员执行'; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
config=/srv/hyperliquid/config
[[ ! -L $config/runtime-config.json ]]
if [[ -e $config/runtime-config.json ]]; then cmp "$source_dir/runtime-config.json" "$config/runtime-config.json"; fi
# 只接受本次核查的旧配置；现场有新改动时停止，先人工合并。
printf '%s  %s\n' 4e6eb6769c94420269fab5ba07d045a2122e99c01c00834f7a623a2b471fc30b "$config/nginx.conf" | sha256sum --check
printf '%s  %s\n' 0dbd9587e193d0233fbaf73f08cec7776129f69adf5789b04c34e0b334a43943 "$config/compose.yml" | sha256sum --check
backup="/root/hyperliquid-deploy-backups/runtime-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -p "$config/nginx.conf" "$config/compose.yml" "$backup/"
restore_config() {
  cat "$backup/nginx.conf" > "$config/nginx.conf"
  if ! docker compose -f "$config/compose.yml" exec -T web nginx -t || ! docker compose -f "$config/compose.yml" exec -T web nginx -s reload; then
    echo "Nginx 恢复失败，请按 $backup 人工恢复" >&2
  fi
}
trap restore_config ERR
install -m 644 "$source_dir/runtime-config.json" "$config/runtime-config.json"
# bind mount 指向现有 inode，原地写入才能在容器中立即生效。
cat "$source_dir/nginx.conf" > "$config/nginx.conf"
docker compose -f "$config/compose.yml" exec -T web nginx -t
docker compose -f "$config/compose.yml" exec -T web nginx -s reload
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 1 --retry-max-time 10 http://127.0.0.1:8089/runtime-config.json | python3 -c 'import json,sys; assert json.load(sys.stdin) == {"schemaVersion":1,"phonePairingEnabled":True}'
trap - ERR
printf '生产运行配置已热加载；应用版本未切换；备份：%s\n' "$backup"
