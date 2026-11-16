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
