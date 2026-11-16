#!/usr/bin/env bash
# 只操作预发布；开启前必须已确认真机验收窗口。定时关闭不等于撤销交易所授权。
set -euo pipefail
[[ $EUID -eq 0 && $# -eq 1 && ($1 == on || $1 == off) ]] || { echo '用法：sudo bash staging-pairing-window.sh on|off'; exit 1; }
config=/etc/hyperliquid-staging
relay=/etc/hyperliquid-staging-pairing
exec 9>/run/hyperliquid-staging-pairing.lock
flock -n 9 || { echo '配对窗口正在切换'; exit 1; }
web=(docker compose -f "$config/compose.yml" exec -T web)
pairing=(docker compose -f "$relay/pairing.compose.yml")
expect_status() {
  local status _attempt
  for _attempt in 1 2 3 4 5; do
    status=$(curl --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/pairings) || status=000
    [[ $status == "$1" ]] && return 0
    sleep 1
  done
  echo "配对入口状态异常：期望 $1，实际 $status" >&2
  return 1
}
close_window() {
  local failed=0
  if [[ -f $config/runtime-config.json && ! -L $config/runtime-config.json ]]; then
    printf '{ "schemaVersion": 1, "phonePairingEnabled": false }\n' > "$config/runtime-config.json" || failed=1
  else failed=1; fi
  # 未知配置不覆盖；仍要关开关并停止 relay，使过期窗口不能继续配对。
  if [[ ! -L $config/nginx.conf ]] && { cmp -s "$config/nginx.conf" "$relay/nginx.disabled.conf" || cmp -s "$config/nginx.conf" "$relay/nginx.enabled.conf"; }; then
    # 保留 bind mount 的 inode，确保容器立即读到配置。
    cat "$relay/nginx.disabled.conf" > "$config/nginx.conf" || failed=1
    if ! "${web[@]}" nginx -t || ! "${web[@]}" nginx -s reload; then failed=1; fi
  else failed=1; fi
  "${pairing[@]}" stop staging-phone-pairing || failed=1
  expect_status 503 || failed=1
  if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8090/runtime-config.json | python3 -c 'import json,sys; sys.exit(json.load(sys.stdin) != {"schemaVersion":1,"phonePairingEnabled":False})'; then failed=1; fi
  [[ $failed == 0 ]] || { echo '关闭或恢复失败，检查预发布 Nginx、运行配置及容器' >&2; return 1; }
  echo '预发布配对已关闭：runtime=false，/pairings=503；容器已停止。'
}
if [[ $1 == off ]]; then close_window; exit; fi
[[ ! -L $config/nginx.conf && ! -L $config/runtime-config.json ]]
[[ -f $relay/nginx.disabled.conf && -f $relay/nginx.enabled.conf ]]
systemctl is-enabled --quiet hyperliquid-staging-pairing-reset.service
cmp "$config/nginx.conf" "$relay/nginx.disabled.conf"
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8090/runtime-config.json | python3 -c 'import json,sys; sys.exit(json.load(sys.stdin) != {"schemaVersion":1,"phonePairingEnabled":False})'
# 不允许并行窗口，避免旧定时器提前关闭新一轮验收。
if systemctl is-active --quiet hyperliquid-staging-pairing-close.timer; then echo '上个窗口定时器仍在，先等待关闭或按手册停止它'; exit 1; fi
backup="/root/hyperliquid-deploy-backups/pairing-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -p "$config/nginx.conf" "$config/runtime-config.json" "$backup/"
trap 'trap - ERR; close_window || exit 2; exit 1' ERR
"${pairing[@]}" up -d --pull never --wait --wait-timeout 30
"${pairing[@]}" exec -T staging-phone-pairing node --input-type=module - http://127.0.0.1:3211 < "$relay/probe-staging-pairing.mjs"
systemd-run --unit=hyperliquid-staging-pairing-close --on-active=30m --collect \
  /bin/bash "$relay/staging-pairing-window.sh" off
cat "$relay/nginx.enabled.conf" > "$config/nginx.conf"
"${web[@]}" nginx -t
"${web[@]}" nginx -s reload
printf '{ "schemaVersion": 1, "phonePairingEnabled": true }\n' > "$config/runtime-config.json"
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8090/runtime-config.json | python3 -c 'import json,sys; sys.exit(json.load(sys.stdin) != {"schemaVersion":1,"phonePairingEnabled":True})'
# 不创建额外会话，GET 集合路径由 relay 返回 404。
expect_status 404
trap - ERR
printf '配对已开启，30 分钟后自动关闭；备份：%s\n' "$backup"
