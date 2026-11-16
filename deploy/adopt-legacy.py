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
