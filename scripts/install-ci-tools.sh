#!/usr/bin/env bash
set -euo pipefail
task_tools="${1:-output-tdd/ci-tools}"
mkdir -p "$task_tools"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    action_archive=actionlint_1.7.12_linux_amd64.tar.gz
    action_hash=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
    leak_archive=gitleaks_8.30.1_linux_x64.tar.gz
    leak_hash=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Darwin-arm64)
    action_archive=actionlint_1.7.12_darwin_arm64.tar.gz
    action_hash=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f
    leak_archive=gitleaks_8.30.1_darwin_arm64.tar.gz
    leak_hash=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  *) echo '仅支持 Linux x64 和 macOS arm64'; exit 1 ;;
esac
fetch_tool() {
  local repository=$1 version=$2 archive=$3 checksum=$4 binary=$5
  curl --fail --silent --show-error --location --retry 3 --max-time 120 \
    "https://github.com/$repository/releases/download/v$version/$archive" -o "$task_tools/$archive"
  [[ "$(shasum -a 256 "$task_tools/$archive" | cut -d ' ' -f1)" == "$checksum" ]] || { echo '工具校验失败'; exit 1; }
  tar -xzf "$task_tools/$archive" -C "$task_tools" "$binary"
  "$task_tools/$binary" --version
}
fetch_tool rhysd/actionlint 1.7.12 "$action_archive" "$action_hash" actionlint
fetch_tool gitleaks/gitleaks 8.30.1 "$leak_archive" "$leak_hash" gitleaks
