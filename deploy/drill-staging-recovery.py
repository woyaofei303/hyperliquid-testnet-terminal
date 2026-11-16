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
