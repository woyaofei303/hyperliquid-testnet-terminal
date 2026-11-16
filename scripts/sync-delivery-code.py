#!/usr/bin/env python3
"""将交付实现复制为手册附录；CI 用 --check 阻止文档代码过期。"""
import hashlib
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
files = [
    '.github/workflows/deploy-aliyun.yml', '.github/workflows/release-environment.yml',
    '.github/workflows/monitor.yml', '.github/main-ruleset.json', '.github/dependabot.yml',
    '.github/pull_request_template.md', '.gitleaksignore', '.husky/pre-commit',
    'scripts/install-ci-tools.sh', 'deploy/release.py', 'deploy/adopt-legacy.py',
    'deploy/publish.sh', 'deploy/bootstrap-staging.sh', 'deploy/upgrade-production.sh',
    'deploy/drill-staging-recovery.py',
    'deploy/compose.yml', 'deploy/nginx.conf', 'deploy/runtime-config.json',
    'deploy/staging/compose.yml', 'deploy/staging/nginx.conf', 'deploy/staging/Caddyfile',
    'deploy/staging/runtime-config.json', 'src/features/wallet/lib/runtime-config.ts',
    'deploy/staging/pairing.compose.yml', 'deploy/probe-staging-pairing.mjs',
    'deploy/staging-pairing-window.sh',
    'deploy/staging/pairing-reset.service',
    'playwright.smoke.config.ts', 'tests/deploy-smoke.spec.ts',
]
blocks = ['# 交付流程完整代码\n\n与[操作手册](ci-cd-handbook.md)配套。此文件由 `python3 scripts/sync-delivery-code.py` 生成；修改实现后必须重新生成。每个文件列出 SHA-256，代码不是伪代码。密钥不在本文中。\n']
languages = {'.py': 'python', '.sh': 'bash', '.yml': 'yaml', '.ts': 'typescript', '.json': 'json', '.md': 'markdown'}
for name in files:
    content = (root / name).read_text()
    checksum = hashlib.sha256(content.encode()).hexdigest()
    fence = '`' * max(4, max((len(line) for line in content.splitlines() if line and set(line) == {'`'}), default=0) + 1)
    blocks.append(f'## `{name}`\n\nSHA-256：`{checksum}`\n\n{fence}{languages.get(Path(name).suffix, "text")}\n{content.rstrip()}\n{fence}\n')
result = '\n'.join(blocks)
output = root / 'docs/ci-cd-code.md'
if '--check' in sys.argv:
    assert output.read_text() == result, '交付代码附录已过期，请运行 python3 scripts/sync-delivery-code.py'
else:
    output.write_text(result)
print(f'{len(files)} 个文件与手册代码一致')
