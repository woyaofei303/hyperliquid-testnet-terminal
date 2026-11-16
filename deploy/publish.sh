#!/usr/bin/env bash
# 由受保护的 Environment job 调用；不从 PR 读取部署凭据。
set -euo pipefail
case "$DEPLOY_ENVIRONMENT" in
  aliyun-staging)
    root=/srv/hyperliquid-staging
    site=https://staging-app.fameex-testnet.xyz
    health=http://127.0.0.1:8090/version.txt
    host=staging-app.fameex-testnet.xyz ;;
  aliyun-production)
    root=/srv/hyperliquid
    site=https://app.fameex-testnet.xyz
    health=http://127.0.0.1:8089/version.txt
    host=app.fameex-testnet.xyz ;;
  *) echo 'Unknown deployment environment'; exit 1 ;;
esac
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ && "$DEPLOY_PORT" -ge 1 && "$DEPLOY_PORT" -le 65535 ]]
[[ "$RELEASE_ID" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]]
[[ -n "$PRIVATE_KEY" && -n "$KNOWN_HOSTS" ]]
ssh_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/fameex-release.XXXXXX")
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
unset PRIVATE_KEY KNOWN_HOSTS
ssh_options=(-i "$ssh_dir/key" -p "$DEPLOY_PORT" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=15)
target="$DEPLOY_USER@$DEPLOY_HOST"
if [[ "$EXPECTED_CURRENT" == auto-staging && "$DEPLOY_ENVIRONMENT" == aliyun-staging ]]; then
  # 目标路径固定，插入值已用白名单校验。
  # shellcheck disable=SC2029
  EXPECTED_CURRENT=$(ssh "${ssh_options[@]}" "$target" "if test -L $root/current; then cat $root/current/version.txt; elif test -e $root/current; then exit 1; else echo none; fi")
fi
[[ "$EXPECTED_CURRENT" == none || "$EXPECTED_CURRENT" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]]
if [[ "$OPERATION" == deploy ]]; then
  python3 deploy/release.py "$RELEASE_ID" --verify candidate
  # 目标路径固定，插入值已用白名单校验。
  # shellcheck disable=SC2029
  ssh "${ssh_options[@]}" "$target" "test ! -L $root/incoming && mkdir -p $root/incoming/$RELEASE_ID && test ! -L $root/incoming/$RELEASE_ID"
  printf -v transport '%q ' ssh "${ssh_options[@]}"
  rsync -rzc --delete --perms --chmod=D755,F644 -e "$transport" candidate/ "$target:$root/incoming/$RELEASE_ID/"
  # 目标路径固定，插入值已用白名单校验。
  # shellcheck disable=SC2029
  ssh "${ssh_options[@]}" "$target" "DEPLOY_ROOT=$root DEPLOY_HEALTH_URL=$health DEPLOY_HOST_HEADER=$host python3 - $RELEASE_ID --expected-current $EXPECTED_CURRENT" < deploy/release.py
elif [[ "$OPERATION" == rollback && "$DEPLOY_ENVIRONMENT" == aliyun-production ]]; then
  # 目标路径固定，插入值已用白名单校验。
  # shellcheck disable=SC2029
  ssh "${ssh_options[@]}" "$target" "DEPLOY_ROOT=$root DEPLOY_HEALTH_URL=$health DEPLOY_HOST_HEADER=$host python3 - --rollback --target-release $RELEASE_ID --expected-current $EXPECTED_CURRENT" < deploy/release.py
else
  echo 'Invalid operation'; exit 1
fi
actual=$(curl --fail --silent --show-error --retry 3 --max-time 30 "$site/version.txt")
[[ "$actual" == "$RELEASE_ID" ]] || { echo 'Public version mismatch; inspect before rollback'; exit 1; }
config_hash=$(curl --fail --silent --show-error --max-time 15 "$site/runtime-config.json" | sha256sum | cut -d ' ' -f1)
printf 'Environment: %s\n\nPrevious current: %s\n\nActive release: %s\n\nRuntime configuration SHA-256: %s\n\n%s\n' "$DEPLOY_ENVIRONMENT" "$EXPECTED_CURRENT" "$RELEASE_ID" "$config_hash" "$site" >> "$GITHUB_STEP_SUMMARY"
