# 交付流程完整代码

与[操作手册](ci-cd-handbook.md)配套。此文件由 `python3 scripts/sync-delivery-code.py` 生成；修改实现后必须重新生成。每个文件列出 SHA-256，代码不是伪代码。密钥不在本文中。

## `.github/workflows/deploy-aliyun.yml`

SHA-256：`780f950c0867a8674fe0582a1abbd6e20b90c8cf002976d6603226c0ddbf718f`

````yaml
name: CI & Production

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      operation:
        description: 发布候选到预发并等待生产批准，或回滚
        type: choice
        required: true
        default: deploy
        options: [deploy, rollback]
      expected_current:
        description: 当前生产 version.txt 的完整值；首次发布填 none
        required: true
        type: string
      rollback_target:
        description: 回滚时必填：服务器 previous 的完整发布 ID
        type: string
      reviewed_sha:
        description: deploy 必填：独立审查覆盖的完整 main SHA
        type: string
      review_url:
        description: deploy 必填：本仓库 PR 中的审查与测试证据链接
        type: string
      risk:
        description: 本次变更风险
        type: choice
        options: [low, medium, high]
        default: high
      specialized_checks:
        description: 高风险涉及资金或配对时，专项验收已完成；不涉及则审查记录已解释
        type: boolean
        default: false

permissions:
  contents: read
  actions: read
  attestations: read

# 手动发布不互相取消；服务器短锁和 expected_current 阻止过期候选覆盖。
concurrency:
  group: ${{ github.event_name == 'workflow_dispatch' && format('release-{0}', github.run_id) || format('ci-{0}', github.ref) }}
  cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}

jobs:
  verify:
    if: inputs.operation != 'rollback'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      HUSKY: '0'
    outputs:
      release_id: ${{ steps.release.outputs.release_id }}
      artifact_id: ${{ steps.upload.outputs.artifact-id }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run test:deploy
      - run: npm run build:static
      - run: npm run typecheck
      - run: npx playwright install --with-deps chrome
      - name: Static mocked interactions
        env:
          STATIC_EXPORT: '1'
        run: npm run test:e2e -- --workers=2
      - name: Create and verify manifest
        id: release
        run: |
          release="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          python3 deploy/release.py "$release" --manifest out
          python3 deploy/release.py "$release" --verify out
          echo "release_id=$release" >> "$GITHUB_OUTPUT"
      - name: Save the immutable candidate
        id: upload
        if: github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: release-${{ steps.release.outputs.release_id }}
          path: out/
          retention-days: 30
          if-no-files-found: error
      - name: Save test evidence
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: browser-${{ github.run_id }}-${{ github.run_attempt }}
          path: output-tdd/playwright/fameex-testnet/
          retention-days: 7
          if-no-files-found: ignore

  security:
    if: inputs.operation != 'rollback'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      HUSKY: '0'
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm audit --audit-level=high
      - run: bash scripts/install-ci-tools.sh
      - name: Workflow and shell checks
        run: |
          output-tdd/ci-tools/actionlint
          shellcheck deploy/*.sh scripts/install-ci-tools.sh
          for script in deploy/*.sh scripts/install-ci-tools.sh; do bash -n "$script"; done
          python3 scripts/sync-delivery-code.py --check
          docker compose -f deploy/compose.yml config --quiet
          docker compose -f deploy/staging/compose.yml config --quiet
          docker compose -f deploy/staging/pairing.compose.yml config --quiet
      - name: Scan the candidate commit and its complete history
        run: output-tdd/ci-tools/gitleaks git --log-opts="$GITHUB_SHA" --redact --no-banner

  codeql:
    if: inputs.operation != 'rollback'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      security-events: write
      packages: read
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript, python, actions]
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - uses: github/codeql-action/init@5895b2c9be147bc7f1c75ce72c5cb577febb1907 # v4
        with:
          languages: ${{ matrix.language }}
          build-mode: none
          queries: security-extended
      - uses: github/codeql-action/analyze@5895b2c9be147bc7f1c75ce72c5cb577febb1907 # v4
        with:
          category: /language:${{ matrix.language }}

  ci-required:
    name: ci-required
    if: always() && inputs.operation != 'rollback'
    needs: [verify, security, codeql]
    runs-on: ubuntu-latest
    steps:
      - name: Require every check to succeed
        env:
          VERIFY: ${{ needs.verify.result }}
          SECURITY: ${{ needs.security.result }}
          CODEQL: ${{ needs.codeql.result }}
        run: test "$VERIFY" = success && test "$SECURITY" = success && test "$CODEQL" = success

  attest:
    needs: [ci-required, verify]
    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.operation == 'deploy'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
      id-token: write
      attestations: write
    steps:
      - name: Validate review identity
        env:
          REVIEWED_SHA: ${{ inputs.reviewed_sha }}
          REVIEW_URL: ${{ inputs.review_url }}
        run: |
          test "$REVIEWED_SHA" = "$GITHUB_SHA"
          [[ "$REVIEW_URL" =~ ^https://github.com/woyaofei303/hyperliquid-testnet-terminal/pull/[0-9]+([/#].*)?$ ]]
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          artifact-ids: ${{ needs.verify.outputs.artifact_id }}
          path: candidate
          merge-multiple: true
      - uses: actions/attest-build-provenance@43d14bc2b83dec42d39ecae14e916627a18bb661 # v3
        with:
          subject-path: candidate/release-manifest.json

  staging:
    needs: [attest, verify]
    uses: ./.github/workflows/release-environment.yml
    secrets:
      ALIYUN_SSH_PRIVATE_KEY: ${{ secrets.ALIYUN_SSH_PRIVATE_KEY }}
      ALIYUN_SSH_KNOWN_HOSTS: ${{ secrets.ALIYUN_SSH_KNOWN_HOSTS }}
    with:
      environment: aliyun-staging
      operation: deploy
      release_id: ${{ needs.verify.outputs.release_id }}
      artifact_id: ${{ needs.verify.outputs.artifact_id }}
      expected_current: auto-staging
      review_url: ${{ inputs.review_url }}
      production_current: ${{ inputs.expected_current }}

  production-ready:
    needs: staging
    runs-on: ubuntu-latest
    steps:
      - name: Require specialized acceptance before production approval
        env:
          RISK: ${{ inputs.risk }}
          SPECIALIZED: ${{ inputs.specialized_checks }}
        run: |
          if [[ "$RISK" == high && "$SPECIALIZED" != true ]]; then
            echo '预发布已验收；高风险专项确认尚未完成，生产放行已阻断。'
            exit 1
          fi

  production:
    needs: [staging, verify, production-ready]
    uses: ./.github/workflows/release-environment.yml
    secrets:
      ALIYUN_SSH_PRIVATE_KEY: ${{ secrets.ALIYUN_SSH_PRIVATE_KEY }}
      ALIYUN_SSH_KNOWN_HOSTS: ${{ secrets.ALIYUN_SSH_KNOWN_HOSTS }}
    with:
      environment: aliyun-production
      operation: deploy
      release_id: ${{ needs.verify.outputs.release_id }}
      artifact_id: ${{ needs.verify.outputs.artifact_id }}
      expected_current: ${{ inputs.expected_current }}
      review_url: ${{ inputs.review_url }}

  rollback:
    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.operation == 'rollback'
    uses: ./.github/workflows/release-environment.yml
    secrets:
      ALIYUN_SSH_PRIVATE_KEY: ${{ secrets.ALIYUN_SSH_PRIVATE_KEY }}
      ALIYUN_SSH_KNOWN_HOSTS: ${{ secrets.ALIYUN_SSH_KNOWN_HOSTS }}
    with:
      environment: aliyun-production
      operation: rollback
      release_id: ${{ inputs.rollback_target }}
      expected_current: ${{ inputs.expected_current }}
````

## `.github/workflows/release-environment.yml`

SHA-256：`98d7a3093953bc26d994c86b8e835a4202ed65edde8f1f9e69e90470e2ea200f`

````yaml
name: Deploy verified environment
on:
  workflow_call:
    secrets:
      ALIYUN_SSH_PRIVATE_KEY:
        required: true
      ALIYUN_SSH_KNOWN_HOSTS:
        required: true
    inputs:
      environment:
        type: string
        required: true
      operation:
        type: string
        required: true
      release_id:
        type: string
        required: true
      artifact_id:
        type: string
        default: ''
      expected_current:
        type: string
        required: true
      production_current:
        type: string
        default: ''
      review_url:
        type: string
        default: ''
permissions:
  contents: read
  actions: read
  attestations: read
jobs:
  release:
    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 35
    environment:
      name: ${{ inputs.environment }}
      url: ${{ inputs.environment == 'aliyun-production' && 'https://app.fameex-testnet.xyz' || 'https://staging-app.fameex-testnet.xyz' }}
    env:
      HUSKY: '0'
      GH_TOKEN: ${{ github.token }}
      RELEASE_ID: ${{ inputs.release_id }}
      EXPECTED_CURRENT: ${{ inputs.expected_current }}
      OPERATION: ${{ inputs.operation }}
      DEPLOY_ENVIRONMENT: ${{ inputs.environment }}
      SMOKE_BASE_URL: ${{ inputs.environment == 'aliyun-production' && 'https://app.fameex-testnet.xyz' || 'https://staging-app.fameex-testnet.xyz' }}
      EXPECTED_RELEASE_ID: ${{ inputs.release_id }}
      EXPECT_PHONE_PAIRING: ${{ inputs.environment == 'aliyun-production' && 'true' || 'false' }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - name: Check candidate identity
        if: inputs.operation == 'deploy'
        env:
          ARTIFACT_ID: ${{ inputs.artifact_id }}
        run: |
          [[ "$ARTIFACT_ID" =~ ^[0-9]+$ ]]
          test "$RELEASE_ID" = "$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$ARTIFACT_ID" > artifact.json
          jq -e --arg sha "$GITHUB_SHA" --arg run "$GITHUB_RUN_ID" --arg name "release-$RELEASE_ID" \
            '.expired == false and .name == $name and .workflow_run.head_sha == $sha and (.workflow_run.id|tostring) == $run and .workflow_run.head_branch == "main"' artifact.json
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        if: inputs.operation == 'deploy'
        with:
          artifact-ids: ${{ inputs.artifact_id }}
          path: candidate
          merge-multiple: true
      - name: Verify signed manifest and every file
        if: inputs.operation == 'deploy'
        run: |
          gh attestation verify candidate/release-manifest.json --repo "$GITHUB_REPOSITORY" \
            --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/deploy-aliyun.yml" \
            --source-ref refs/heads/main --source-digest "$GITHUB_SHA"
          python3 deploy/release.py "$RELEASE_ID" --verify candidate
      - name: Publish or roll back
        env:
          DEPLOY_HOST: ${{ vars.ALIYUN_HOST }}
          DEPLOY_USER: ${{ vars.ALIYUN_USER }}
          DEPLOY_PORT: ${{ vars.ALIYUN_PORT || '22' }}
          PRIVATE_KEY: ${{ secrets.ALIYUN_SSH_PRIVATE_KEY }}
          KNOWN_HOSTS: ${{ secrets.ALIYUN_SSH_KNOWN_HOSTS }}
        run: bash deploy/publish.sh
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        if: inputs.operation == 'deploy'
        with:
          node-version: '24'
          cache: npm
      - if: inputs.operation == 'deploy'
        run: npm ci
      - if: inputs.operation == 'deploy'
        run: npx playwright install --with-deps chrome
      - name: Read-only smoke
        if: inputs.operation == 'deploy'
        run: npm run test:smoke
      - name: Candidate approval evidence
        if: inputs.environment == 'aliyun-staging'
        env:
          REVIEW_URL: ${{ inputs.review_url }}
          ARTIFACT_ID: ${{ inputs.artifact_id }}
          PRODUCTION_CURRENT: ${{ inputs.production_current }}
        run: |
          actual=$(curl --fail --silent --show-error --max-time 15 https://app.fameex-testnet.xyz/version.txt)
          test "$actual" = "$PRODUCTION_CURRENT"
          digest=$(sha256sum candidate/release-manifest.json | cut -d ' ' -f1)
          printf '## 生产审批证据\n\n提交：%s\n\n发布 ID：%s\n\nArtifact ID：%s\n\n清单 SHA-256：%s\n\n审查记录：%s\n\nCI 与测试报告：https://github.com/%s/actions/runs/%s\n\n预发布：https://staging-app.fameex-testnet.xyz\n\n当前生产 / 上线后回滚目标：%s\n\n预发布 smoke 已通过；配对默认关闭。资金与真机专项结果、未验证项见 PR，由批准人逐项核对。\n' \
            "$GITHUB_SHA" "$RELEASE_ID" "$ARTIFACT_ID" "$digest" "$REVIEW_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" "$actual" >> "$GITHUB_STEP_SUMMARY"
      - name: Observe production for 15 minutes
        if: inputs.environment == 'aliyun-production' && inputs.operation == 'deploy'
        run: |
          for attempt in $(seq 1 15); do
            echo "Production observation $attempt/15"
            sleep 60
            actual=$(curl --fail --silent --show-error --retry 2 --max-time 15 "$SMOKE_BASE_URL/version.txt")
            test "$actual" = "$EXPECTED_RELEASE_ID"
          done
      - name: Save failed smoke evidence
        if: failure()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: smoke-${{ inputs.environment }}-${{ github.run_id }}-${{ github.run_attempt }}
          path: output-tdd/playwright/deployment-smoke/
          retention-days: 7
          if-no-files-found: ignore
````

## `.github/workflows/monitor.yml`

SHA-256：`81f0082782a27f735505ed60b839ffeddd4755acbbfa0d30949513276638f6d1`

````yaml
name: Read-only site monitoring
on:
  schedule:
    - cron: '7,17,27,37,47,57 * * * *'
    - cron: '23 2 * * *'
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: read-only-site-monitor
  cancel-in-progress: false
jobs:
  http:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Public HTTPS, version and static resource
        run: |
          site=https://app.fameex-testnet.xyz
          version=$(curl --fail --silent --show-error --retry 2 --max-time 15 "$site/version.txt")
          [[ "$version" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]]
          curl --fail --silent --show-error --retry 2 --max-time 15 "$site/index.html" -o /tmp/home.html
          test -s /tmp/home.html
          curl --fail --silent --show-error --max-time 15 "$site/release-manifest.json" -o /tmp/manifest.json
          jq -e --arg version "$version" '.releaseId == $version' /tmp/manifest.json
          home_hash=$(jq -er '.files["index.html"]' /tmp/manifest.json)
          test "$(sha256sum /tmp/home.html | cut -d ' ' -f1)" = "$home_hash"
          asset=$(jq -er '.files | [keys[] | select(startswith("_next/static/") and endswith(".js"))][0]' /tmp/manifest.json)
          [[ "$asset" =~ ^_next/static/[a-zA-Z0-9_./-]+\.js$ ]]
          curl --fail --silent --show-error --max-time 15 "$site/$asset" -o /tmp/asset.js
          expected=$(jq -r --arg asset "$asset" '.files[$asset]' /tmp/manifest.json)
          test "$(sha256sum /tmp/asset.js | cut -d ' ' -f1)" = "$expected"
  contract:
    if: github.event_name == 'workflow_dispatch' || github.event.schedule == '23 2 * * *'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      HUSKY: '0'
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run verify:read
````

## `.github/main-ruleset.json`

SHA-256：`e764c070bedcda6ed330fa3294bf90ea7d9ae122f7d301cc1a162215dd093cf8`

````json
{
  "name": "main-delivery-gates",
  "target": "branch",
  "enforcement": "disabled",
  "bypass_actors": [],
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "ci-required", "integration_id": 15368 }
        ]
      }
    },
    {
      "type": "code_scanning",
      "parameters": {
        "code_scanning_tools": [
          {
            "tool": "CodeQL",
            "security_alerts_threshold": "high_or_higher",
            "alerts_threshold": "errors"
          }
        ]
      }
    }
  ]
}
````

## `.github/dependabot.yml`

SHA-256：`06c866a85cd0a1c3d033f0d3774ae43993506bca4984d095de7e6ab53cac95c6`

````yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
````

## `.github/pull_request_template.md`

SHA-256：`5e735917a150d5c2f88de2ac1a0d308505fd9f9e5b8da636d398e25068728195`

````markdown
## 问题与结果

- 要解决的问题：
- 用户可观察到的结果：
- 本次不包含：
- 风险：低 / 中 / 高（原因）：
- 涉及入口、调用方、共享逻辑和外部接口：

## 验收和恢复

- 正常场景：
- 边界与失败场景：
- 兼容及回滚方式：
- 执行的命令、结果和证据链接：
- 未验证或跳过的项目：

## 独立审查

- Base SHA：
- 最终 Head SHA：
- 独立 Codex 审查记录：
- 发现问题、处理结果及未采纳理由：
- 人工核对的关键调用链：
- 资金 / 手机配对专项验收（不涉及则明确写不涉及）：

禁止粘贴私钥、真实钱包签名载荷、配对二维码或会话内容。新增提交使旧审查结论失效，须补审并更新 SHA。
````

## `.gitleaksignore`

SHA-256：`beb8474d94f3f939db6f8b2409e80b21284051a1038f45fe07dfbc602b5cf6a6`

````text
# TOKEN_MESSENGER 是公开的 EVM 合约地址（0x + 40 位十六进制），不是 API key。
# 只放行已核对的历史提交及这一行；未来变动仍重新扫描。
637210c65e9102a62fdee943174c415983c4d0d3:src/lib/funding.ts:generic-api-key:24
````

## `.husky/pre-commit`

SHA-256：`ed424eab92ca83781d644895c348850fc7d246cb31dd8edc93be4f21818bef20`

````text
npx lint-staged
npm run typecheck
npm test
````

## `scripts/install-ci-tools.sh`

SHA-256：`c8f986a53deafe3ff6d4e0b79521636c46fbd569d298c9a39b88506fef9c8593`

````bash
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
````

## `deploy/release.py`

SHA-256：`0868288048707fa2ce894e2b8ff7d32344bd2fe514e2636c50cdce8a69461a48`

````python
#!/usr/bin/env python3
"""验证静态产物，在短锁内切换版本；失败恢复，进程中断留记录。"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import time
import urllib.parse
import urllib.request

MANIFEST = 'release-manifest.json'
RELEASE = re.compile(r'([0-9a-f]{40})-([0-9]+)-([0-9]+)')


def identity(release_id):
    match = RELEASE.fullmatch(release_id)
    if not match:
        raise ValueError('版本必须使用 commit-run_id-run_attempt 格式')
    return dict(schemaVersion=1, releaseId=release_id, commitSha=match[1],
                runId=match[2], runAttempt=match[3])


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('产物必须是普通目录')
    files = {}
    for path in sorted(directory.rglob('*')):
        name = path.relative_to(directory).as_posix()
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError(f'产物包含链接或特殊文件：{name}')
        if any(part.startswith('.') for part in Path(name).parts):
            raise ValueError(f'产物包含隐藏文件：{name}')
        if path.is_dir():
            continue
        if name == MANIFEST:
            continue
        if (path.suffix.lower() in {'.pem', '.key', '.p12', '.log', '.map'}
                or path.name == 'runtime-config.json'
                or '.test.' in name or 'test-results' in Path(name).parts):
            raise ValueError(f'产物包含禁止发布的文件：{name}')
        files[name] = digest(path)
    if not {'index.html', '404.html', 'version.txt'} <= files.keys():
        raise ValueError('版本缺少 index.html、404.html 或 version.txt')
    if not any(name.startswith('_next/static/') and name.endswith('.js') for name in files):
        raise ValueError('版本缺少 JavaScript 静态资源')
    return files


def atomic_json(path, data):
    temporary = path.with_name(path.name + '.next')
    # 不跟随残留链接；同一项目的调用方必须持有发布锁。
    if temporary.is_symlink():
        raise ValueError('临时记录不是普通文件')
    with temporary.open('w') as stream:
        json.dump(data, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    parent = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def create_manifest(directory, release_id):
    directory = Path(directory)
    data = identity(release_id)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('产物目录无效')
    for name in ('version.txt', MANIFEST):
        if (directory / name).is_symlink():
            raise ValueError('元数据不能是符号链接')
    (directory / 'version.txt').write_text(release_id + '\n')
    data['files'] = inventory(directory)
    atomic_json(directory / MANIFEST, data)
    return data


def verify_manifest(directory, release_id):
    directory = Path(directory)
    expected = identity(release_id)
    actual_files = inventory(directory)
    data = json.loads((directory / MANIFEST).read_text())
    if not isinstance(data, dict) or set(data) != set(expected) | {'files'}:
        raise ValueError('产物清单结构无效')
    if any(data.get(key) != value for key, value in expected.items()):
        raise ValueError('产物清单来源与版本不一致')
    if data['files'] != actual_files:
        raise ValueError('产物文件清单或 SHA-256 不一致')
    if (directory / 'version.txt').read_text().strip() != release_id:
        raise ValueError('version.txt 与发布 ID 不一致')
    return data


def release_path(root, release_id):
    identity(release_id)
    path = root / 'releases' / release_id
    verify_manifest(path, release_id)
    return path


def linked_release(root, name, verify_content=True):
    link = root / name
    if not link.is_symlink():
        if link.exists():
            raise ValueError(f'{name} 不是软链接')
        return None
    target = link.resolve(strict=verify_content)
    if target.parent != root / 'releases':
        raise ValueError(f'{name} 指向项目之外')
    identity(target.name)
    # 恢复可以撤下损坏的 current，但不能放松即将启用版本的校验。
    return release_path(root, target.name) if verify_content else target


def switch_link(root, name, target):
    temporary = root / (name + '.next')
    if temporary.is_symlink():
        temporary.unlink()
    if target is None:
        (root / name).unlink(missing_ok=True)
        return
    temporary.symlink_to(target.relative_to(root))
    os.replace(temporary, root / name)


def copy_asset(source, destination):
    destination = Path(destination)
    if any(parent.is_symlink() for parent in destination.parents):
        raise ValueError('共享资源目录不能是符号链接')
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not destination.is_file() or digest(source) != digest(destination):
            raise ValueError(f'共享资源冲突：{destination.name}')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if any(parent.is_symlink() for parent in destination.parents):
        raise ValueError('共享资源目录不能是符号链接')
    temporary = destination.with_name('.' + destination.name + '.upload')
    if temporary.is_symlink():
        raise ValueError('共享资源临时文件不能是符号链接')
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def check_health(release_id):
    root = Path(os.environ.get('DEPLOY_ROOT', '/srv/hyperliquid'))
    target = root / 'releases' / release_id
    data = verify_manifest(target, release_id)
    asset = next(name for name in data['files'] if name.startswith('_next/static/') and name.endswith('.js'))
    base = os.environ.get('DEPLOY_HEALTH_URL', 'http://127.0.0.1:8089/version.txt')
    host = os.environ.get('DEPLOY_HOST_HEADER', 'app.fameex-testnet.xyz')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(5):
        try:
            for name in ('version.txt', 'index.html', asset):
                request = urllib.request.Request(urllib.parse.urljoin(base, '/' + name),
                                                headers={'Host': host, 'Cache-Control': 'no-cache'})
                with opener.open(request, timeout=5) as response:
                    if hashlib.sha256(response.read()).hexdigest() != data['files'][name]:
                        raise ValueError('HTTP 内容与清单不一致')
            return
        except (OSError, ValueError):
            if attempt < 4:
                time.sleep(1)
    raise RuntimeError('本机 HTTP 版本、首页或资源检查失败')


def assert_current(old, expected):
    actual = old.name if old else 'none'
    if expected != actual:
        raise ValueError(f'当前版本已变化：预期 {expected}，实际 {actual}')


def restore(root, record):
    old = release_path(root, record['old']) if record['old'] else None
    previous = release_path(root, record['previous']) if record['previous'] else None
    switch_link(root, 'current', old)
    switch_link(root, 'previous', previous)
    if old:
        check_health(old.name)
    (root / '.deployment.json').unlink()


def project_root(root):
    root = Path(root).resolve(strict=True)
    for name in ('releases', 'incoming', 'shared', '.deploy.lock', '.deployment.json'):
        if (root / name).is_symlink():
            raise ValueError(f'{name} 不能是符号链接')
    return root


def recover(root, expected_current):
    root = project_root(root)
    with (root / '.deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = linked_release(root, 'current', verify_content=False)
        assert_current(current, expected_current)
        record = json.loads((root / '.deployment.json').read_text())
        if (current.name if current else None) not in (record['old'], record['target']):
            raise ValueError('当前版本不属于未完成发布，停止恢复')
        restore(root, record)
        print('已恢复中断发布前的状态并核验')


def deploy(root, release_id, expected_current, rollback_target=None):
    root = project_root(root)
    with (root / '.deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (root / '.deployment.json').exists():
            raise ValueError('存在未完成发布，请先检查并执行 --recover')
        old = linked_release(root, 'current', verify_content=release_id != '--rollback')
        previous = linked_release(root, 'previous')
        assert_current(old, expected_current)
        if release_id == '--rollback':
            if previous is None or previous.name != rollback_target:
                raise ValueError('没有已确认的可回退版本')
            target = previous
        else:
            identity(release_id)
            target = root / 'releases' / release_id
            incoming = root / 'incoming' / release_id
            if incoming.exists() or incoming.is_symlink():
                verify_manifest(incoming, release_id)
                if target.exists() or target.is_symlink():
                    if verify_manifest(target, release_id) != verify_manifest(incoming, release_id):
                        raise ValueError('拒绝覆盖已有版本')
                else:
                    incoming.rename(target)
            target = release_path(root, release_id)
        if old == target:
            check_health(target.name)
            return
        for source in sorted((target / '_next/static').rglob('*')):
            if source.is_file():
                copy_asset(source, root / 'shared' / source.relative_to(target))
        record = dict(old=old.name if old else None, previous=previous.name if previous else None,
                      target=target.name)
        atomic_json(root / '.deployment.json', record)
        try:
            switch_link(root, 'current', target)
            check_health(target.name)
            switch_link(root, 'previous', old)
        except Exception as error:
            try:
                restore(root, record)
            except Exception as restore_error:
                raise RuntimeError(f'发布失败且恢复失败；保留记录，请人工处理：{restore_error}') from error
            state = '已恢复并核验旧版本' if old else '已恢复首次发布前的无版本状态'
            raise RuntimeError(f'发布失败；{state}') from error
        (root / '.deployment.json').unlink()
        print(f'当前版本：{target.name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release_id', nargs='?')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--manifest', metavar='DIRECTORY')
    mode.add_argument('--verify', metavar='DIRECTORY')
    mode.add_argument('--rollback', action='store_true')
    mode.add_argument('--recover', action='store_true')
    parser.add_argument('--expected-current')
    parser.add_argument('--target-release')
    args = parser.parse_args()
    if args.manifest or args.verify:
        if not args.release_id:
            parser.error('需要发布 ID')
        (create_manifest if args.manifest else verify_manifest)(Path(args.manifest or args.verify), args.release_id)
        return
    if not args.expected_current:
        parser.error('切换或恢复必须提供 --expected-current（首次发布用 none）')
    root = os.environ.get('DEPLOY_ROOT', '/srv/hyperliquid')
    if args.recover:
        recover(root, args.expected_current)
    else:
        deploy(root, '--rollback' if args.rollback else args.release_id or '',
               args.expected_current, args.target_release)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        sys.exit(str(error))
````

## `deploy/adopt-legacy.py`

SHA-256：`db3c59f66a1fbeca032f91edb8575d86091d22a437a7b6951169db194fab389d`

````python
#!/usr/bin/env python3
"""给明确核验的两个历史版本补文件清单，不声称它们有 CI 来源证明。"""
import argparse
import fcntl
import json
from pathlib import Path
import release


def adopt(root, current, previous):
    root = release.project_root(root)
    with (root / '.deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (root / '.deployment.json').exists():
            raise ValueError('有未完成发布，停止迁移')
        candidates = []
        for link, expected in [('current', current), ('previous', previous)]:
            release.identity(expected)
            target = root / 'releases' / expected
            if not (root / link).is_symlink() or (root / link).resolve(strict=True) != target:
                raise ValueError('历史版本已变化，停止迁移')
            if (target / 'version.txt').read_text().strip() != expected:
                raise ValueError('历史版本标识不一致')
            data = dict(**release.identity(expected), files=release.inventory(target))
            if (target / release.MANIFEST).exists():
                release.verify_manifest(target, expected)
            candidates.append((target, data))
        evidence = root / '.legacy-adoption.json'
        record = {'provenance': 'legacy-server-baseline-not-attested',
                  'versions': [data for _, data in candidates]}
        if evidence.exists() and json.loads(evidence.read_text()) != record:
            raise ValueError('已有不同迁移记录，停止')
        release.atomic_json(evidence, record)
        for target, data in candidates:
            if not (target / release.MANIFEST).exists():
                release.atomic_json(target / release.MANIFEST, data)
            release.verify_manifest(target, target.name)
        print('历史版本文件清单已核验；没有补造 CI 来源证明；未切换版本')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='/srv/hyperliquid')
    parser.add_argument('--current', required=True)
    parser.add_argument('--previous', required=True)
    args = parser.parse_args()
    adopt(Path(args.root), args.current, args.previous)
````

## `deploy/publish.sh`

SHA-256：`f37b9d0f767387c6de089b8bbc9ec4fa5ded57bebf53dc60be607c3840cc7b10`

````bash
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
````

## `deploy/bootstrap-staging.sh`

SHA-256：`b23ad7b70b2e9e7f234a324902fbe7d634020f091531809b43281ffb0f4478a4`

````bash
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
````

## `deploy/upgrade-production.sh`

SHA-256：`d66de5b1ac021c4ec93370361932c06e1797f212bf739aa09d05fee921210484`

````bash
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
````

## `deploy/drill-staging-recovery.py`

SHA-256：`376e5ef8f81c85be3b0f55e400e02f119510930adb2796dc4773cf2707c7f85c`

````python
"""仅预发布：候选健康失败注入，恢复后仍执行真实 HTTP 检查。"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch

if sys.flags.optimize:
    raise RuntimeError('禁止优化模式运行演练，恢复断言必须启用')

root = Path('/srv/hyperliquid-staging')
candidate, expected = sys.argv[1:]
assert candidate != expected, '必须使用两个不同的已验证版本'
os.environ.update(DEPLOY_ROOT=str(root),
                  DEPLOY_HEALTH_URL='http://127.0.0.1:8090/version.txt',
                  DEPLOY_HOST_HEADER='staging-app.fameex-testnet.xyz')
source = Path(__file__).with_name('release.py')
spec = importlib.util.spec_from_file_location('release', source)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.release_path(root, candidate)
release.release_path(root, expected)
assert release.linked_release(root, 'current').name == expected
before = {name: os.readlink(root / name) if (root / name).is_symlink() else None
          for name in ('current', 'previous')}
real_health = release.check_health
real_health(expected)
checks = []

def candidate_failure(release_id):
    checks.append(release_id)
    if release_id == candidate:
        assert release.linked_release(root, 'current').name == candidate
        raise RuntimeError('演练注入：候选健康失败；不改变站点文件或健康 URL')
    real_health(release_id)

started = time.monotonic()
with patch.object(release, 'check_health', side_effect=candidate_failure):
    try:
        release.deploy(root, candidate, expected)
    except RuntimeError as error:
        assert '已恢复并核验旧版本' in str(error), str(error)
        result = str(error)
    else:
        raise AssertionError('故障注入没有触发发布失败')
elapsed = time.monotonic() - started
assert checks == [candidate, expected], checks
assert all((os.readlink(root / name) if (root / name).is_symlink() else None) == target
           for name, target in before.items())
assert not (root / '.deployment.json').exists()
real_health(expected)
print(json.dumps(dict(environment='aliyun-staging', candidate=candidate,
                      restored=expected, previous=before['previous'],
                      result=result, recoverySeconds=round(elapsed, 3),
                      injection='candidate-health-only',
                      restoredHttpVerified=True), ensure_ascii=False))
````

## `deploy/compose.yml`

SHA-256：`0dbd9587e193d0233fbaf73f08cec7776129f69adf5789b04c34e0b334a43943`

````yaml
name: hyperliquid

services:
  web:
    image: nginx:1.28-alpine
    restart: unless-stopped
    ports:
      - '127.0.0.1:8089:80'
    volumes:
      - /srv/hyperliquid:/srv/hyperliquid:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    mem_limit: 64m
    cpus: 0.5
    logging:
      options:
        max-size: '10m'
        max-file: '3'
````

## `deploy/nginx.conf`

SHA-256：`8d138debc38f5faa3536960666b391332468ad76212bc55ea96a0ce08f14e2ea`

````text
server {
    listen 80;
    server_name app.fameex-testnet.xyz;
    root /srv/hyperliquid/current;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # 二维码只指向本站 HTTPS；请求转给同一 Docker 网络内的配对服务。
    location ~ ^/pairings(?:/|$) {
        access_log off;
        client_max_body_size 6k;
        proxy_connect_timeout 5s;
        proxy_read_timeout 20s;
        proxy_pass http://phone-pairing:3211;
    }

    location = /runtime-config.json {
        alias /srv/hyperliquid/config/runtime-config.json;
        default_type application/json;
        add_header Cache-Control "no-store" always;
    }

    location = /version.txt {
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }

    location /_next/static/ {
        alias /srv/hyperliquid/shared/_next/static/;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri.html $uri/ =404;
    }

    error_page 404 /404.html;
}
````

## `deploy/runtime-config.json`

SHA-256：`a3009c29e13f9e9a99057745922a039a7b83e0f616055051f0e4f998c1c9b6a9`

````json
{ "schemaVersion": 1, "phonePairingEnabled": true }
````

## `deploy/staging/compose.yml`

SHA-256：`d2597ead64a236d2c5aeb5cde477eeb987e07b535dd9d23cf960ee35bc9c4b17`

````yaml
name: hyperliquid-staging

services:
  web:
    image: nginx:1.28-alpine
    restart: unless-stopped
    ports:
      - '127.0.0.1:8090:80'
    volumes:
      - /srv/hyperliquid-staging:/srv/hyperliquid-staging:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./runtime-config.json:/etc/nginx/runtime-config.json:ro
    mem_limit: 64m
    cpus: 0.5
    logging:
      options:
        max-size: '10m'
        max-file: '3'
````

## `deploy/staging/nginx.conf`

SHA-256：`c05a7f26b927dd6116ddb154110ad85b63e78f7077a97e5604c449179c0276e8`

````text
server {
    listen 80;
    server_name staging-app.fameex-testnet.xyz;
    root /srv/hyperliquid-staging/current;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # 预发布不连接生产配对服务，也不创建任何配对会话。
    location ~ ^/pairings(?:/|$) {
        return 503;
    }

    location = /runtime-config.json {
        alias /etc/nginx/runtime-config.json;
        default_type application/json;
        add_header Cache-Control "no-store" always;
    }

    location = /version.txt {
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }

    location /_next/static/ {
        alias /srv/hyperliquid-staging/shared/_next/static/;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri.html $uri/ =404;
    }

    error_page 404 /404.html;
}
````

## `deploy/staging/Caddyfile`

SHA-256：`7964c096bcb790239073b4055b65cc1f30b74bc9ef6051c534b411fe4993c10e`

````text
staging-app.fameex-testnet.xyz {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8090
}
````

## `deploy/staging/runtime-config.json`

SHA-256：`3bc4b53d51cafe556d544d53007c8c500e45d08fde854e3714d3d18393cf5895`

````json
{ "schemaVersion": 1, "phonePairingEnabled": false }
````

## `src/features/wallet/lib/runtime-config.ts`

SHA-256：`f8126f640419362768f9fa6c0b6fe62710768a7a638b3aaed3dc74a2c69ac9d3`

````typescript
export interface PublicRuntimeConfig {
  schemaVersion: 1
  phonePairingEnabled: boolean
}

export function pairingOrigin(value: unknown, origin: string): string {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('phonePairingEnabled' in value) ||
    value.phonePairingEnabled !== true
  )
    throw new Error('手机配对服务暂不可用，请稍后重试。')
  const url = new URL(origin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.origin !== origin ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new Error('手机配对服务必须使用本站 HTTPS 地址')
  return url.origin
}

export async function loadPairingOrigin(origin: string): Promise<string> {
  const response = await fetch(`${origin}/runtime-config.json`, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('手机配对配置读取失败')
  return pairingOrigin(await response.json(), origin)
}
````

## `deploy/staging/pairing.compose.yml`

SHA-256：`d2e28825dc6cef949e49e0c96d3c0f7893b4d2cb3025a2f5be50bd81f468fe3b`

````yaml
name: hyperliquid-staging-pairing

services:
  staging-phone-pairing:
    # 复用已部署的官方 Node 镜像摘要；不读取生产目录或会话。
    image: node@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
    command: ['node', '/app/server.mjs']
    user: '1000:1000'
    read_only: true
    restart: 'no'
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    environment:
      PAIRING_HOST: 0.0.0.0
      PAIRING_PORT: '3211'
      PAIRING_ORIGINS: https://staging-app.fameex-testnet.xyz
    volumes:
      - /srv/hyperliquid-staging-pairing:/app:ro
    networks: [staging]
    mem_limit: 64m
    cpus: 0.25
    pids_limit: 64
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3211/pairings').then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 3s
      retries: 3
    logging:
      options:
        max-size: '1m'
        max-file: '2'

networks:
  staging:
    external: true
    name: hyperliquid-staging_default
````

## `deploy/probe-staging-pairing.mjs`

SHA-256：`f43c5254dd092e26624342d3af848c366b60718bee7b83473a3e58e951fa2796`

````text
// 仅创建短时合成密文，不连接钱包、交易所，也不输出会话凭据。
import assert from 'node:assert/strict'

const base = process.argv[2]
assert.ok(
  ['http://127.0.0.1:3211', 'https://staging-app.fameex-testnet.xyz'].includes(
    base,
  ),
  '只允许容器内环回地址或预发布域名',
)
let checks = 0
async function request(
  path,
  status,
  method = 'GET',
  token,
  body,
  origin = 'https://staging-app.fameex-testnet.xyz',
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  })
  assert.equal(response.status, status, `${method} 配对请求状态不符`)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  checks++
  return response.json()
}

async function main() {
  await request(
    '/pairings',
    403,
    'POST',
    undefined,
    undefined,
    'https://app.fameex-testnet.xyz',
  )
  const session = await request('/pairings', 200, 'POST')
  assert.match(session.id, /^[a-f0-9]{32}$/)
  assert.ok(/^[a-f0-9]{64}$/.test(session.webToken), 'Web 令牌格式无效')
  assert.ok(/^[a-f0-9]{64}$/.test(session.phoneToken), '手机令牌格式无效')
  assert.ok(session.webToken !== session.phoneToken, '两端令牌不能相同')
  assert.ok(
    session.expiresAt > Date.now() && session.expiresAt <= Date.now() + 300000,
  )
  const path = `/pairings/${session.id}`
  try {
    await request(path, 401)
    await request(`${path}/approval`, 409, 'POST', session.webToken, {
      envelope: 'ab'.repeat(28),
    })
    await request(`${path}/request`, 401, 'POST', session.webToken, {
      envelope: 'ab'.repeat(28),
    })
    await request(`${path}/request`, 400, 'POST', session.phoneToken, {
      envelope: 'invalid',
    })
    const envelope = 'ab'.repeat(28)
    await request(`${path}/request`, 200, 'POST', session.phoneToken, {
      envelope,
    })
    await request(`${path}/request`, 200, 'POST', session.phoneToken, {
      envelope,
    })
    await request(`${path}/request`, 409, 'POST', session.phoneToken, {
      envelope: 'cd'.repeat(28),
    })
    assert.equal(
      (await request(path, 200, 'GET', session.webToken)).request,
      envelope,
    )
    await request(`${path}/approval`, 401, 'POST', session.phoneToken, {
      envelope,
    })
    await request(`${path}/approval`, 200, 'POST', session.webToken, {
      envelope,
    })
    assert.equal(
      (await request(path, 200, 'GET', session.phoneToken)).approval,
      envelope,
    )
  } finally {
    await request(path, 200, 'DELETE', session.webToken)
  }
  await request(path, 410, 'GET', session.webToken)
  console.log(
    JSON.stringify({
      checks,
      syntheticOnly: true,
      walletActions: 0,
      sessionRemoved: true,
    }),
  )
}

void main().catch(() => {
  console.error(
    JSON.stringify({
      passedChecks: checks,
      error: '配对探针失败；响应和会话凭据不写入日志',
    }),
  )
  process.exitCode = 1
})
````

## `deploy/staging-pairing-window.sh`

SHA-256：`89e88bce48a9fc66403efa9a78ec0c1bc790bb3d1c3a58dde79934aa3d9864fe`

````bash
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
````

## `deploy/staging/pairing-reset.service`

SHA-256：`fa206fb6979b24549778b50fa40e08c3860dbb0ce11c4e46386e031a7f497fc5`

````text
[Unit]
Description=Close the staging phone pairing window after boot
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash /etc/hyperliquid-staging-pairing/staging-pairing-window.sh off

[Install]
WantedBy=multi-user.target
````

## `playwright.smoke.config.ts`

SHA-256：`a8bdf4e0000e311e599963ee992ed1f6065d81a16acbce21ecfcf6c8f23301c5`

````typescript
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SMOKE_BASE_URL
const url = new URL(baseURL || 'invalid:')
if (
  ![
    'https://app.fameex-testnet.xyz',
    'https://staging-app.fameex-testnet.xyz',
  ].includes(url.origin) &&
  !(
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname)
  )
)
  throw new Error('SMOKE_BASE_URL 必须是已知部署站点或本机测试端口')
if (!/^[0-9a-f]{40}-\d+-\d+$/.test(process.env.EXPECTED_RELEASE_ID || ''))
  throw new Error('必须提供 EXPECTED_RELEASE_ID')
if (!['true', 'false'].includes(process.env.EXPECT_PHONE_PAIRING || ''))
  throw new Error('必须提供 EXPECT_PHONE_PAIRING=true|false')

export default defineConfig({
  testDir: './tests',
  testMatch: 'deploy-smoke.spec.ts',
  retries: 0,
  workers: 1,
  timeout: 90000,
  reporter: [['list']],
  outputDir: 'output-tdd/playwright/deployment-smoke',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
````

## `tests/deploy-smoke.spec.ts`

SHA-256：`0e50bad8e1e67e3a1318684ac623d47b7ace035cdf059a6da27eba0f081fc305`

````typescript
import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('部署版本、配置、资源和只读行情可用', async ({ page, request }) => {
  const expected = process.env.EXPECTED_RELEASE_ID
  const version = await request.get('/version.txt')
  expect(version.status()).toBe(200)
  expect((await version.text()).trim()).toBe(expected)
  expect(version.headers()['cache-control']).toContain('no-store')
  const config = await request.get('/runtime-config.json')
  expect(config.status()).toBe(200)
  expect(config.headers()['cache-control']).toContain('no-store')
  expect(await config.json()).toEqual({
    schemaVersion: 1,
    phonePairingEnabled: process.env.EXPECT_PHONE_PAIRING === 'true',
  })
  const manifestResponse = await request.get('/release-manifest.json')
  expect(manifestResponse.status()).toBe(200)
  const manifest = await manifestResponse.json()
  expect(manifest.releaseId).toBe(expected)
  const asset = Object.keys(manifest.files).find((name) =>
    /^_next\/static\/[\w./-]+\.js$/.test(name),
  )
  expect(asset).toBeTruthy()
  for (const name of ['index.html', asset as string]) {
    const response = await request.get(`/${name}`)
    expect(response.status()).toBe(200)
    expect(
      createHash('sha256')
        .update(await response.body())
        .digest('hex'),
    ).toBe(manifest.files[name])
  }
  expect((await request.get('/deployment-smoke-nonexistent')).status()).toBe(
    404,
  )
  const blocked: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const read =
      ['GET', 'HEAD'].includes(req.method()) ||
      (req.method() === 'POST' &&
        url.origin === 'https://api.hyperliquid-testnet.xyz' &&
        url.pathname === '/info')
    if (!read || url.pathname === '/exchange') {
      blocked.push(`${req.method()} ${url.origin}${url.pathname}`)
      await route.abort()
    } else await route.continue()
  })
  await page.goto('/')
  for (const name of ['行情图表', '订单簿', '下单面板'])
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  await expect(
    page.getByRole('region', { name: /基础版 K 线图，已加载 [1-9]\d* 根/ }),
  ).toBeVisible({ timeout: 45000 })
  expect(blocked).toEqual([])
  expect(errors).toEqual([])
})
````
