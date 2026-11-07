#!/usr/bin/env python3
"""切换静态站点版本；本机 HTTP 检查失败时恢复原版本。"""

import fcntl
import os
from pathlib import Path
import re
import shutil
import sys
import time
import urllib.request


def release_path(root, release_id):
    if not re.fullmatch(r"[0-9a-f]{40}-[0-9]+-[0-9]+", release_id):
        raise ValueError("版本目录必须使用 commit-run_id-run_attempt 格式")
    path = root / "releases" / release_id
    if path.is_symlink() or not path.is_dir():
        raise ValueError("版本目录不存在或不是普通目录")
    if not (path / "index.html").is_file():
        raise ValueError("版本缺少 index.html")
    if (path / "version.txt").read_text().strip() != release_id:
        raise ValueError("版本标识与目录不一致")
    return path


def linked_release(root, name):
    link = root / name
    if not link.is_symlink():
        if link.exists():
            raise ValueError(f"{name} 已存在且不是软链接，停止发布")
        return None
    target = link.resolve(strict=True)
    if target.parent != root / "releases":
        raise ValueError(f"{name} 指向项目版本目录之外，停止发布")
    return release_path(root, target.name)


def switch_link(root, name, target):
    temporary = root / (name + ".next")
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(target.relative_to(root))
    os.replace(temporary, root / name)


def copy_asset(source, destination):
    destination = Path(destination)
    temporary = destination.with_name("." + destination.name + ".upload")
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return str(destination)


def check_health(release_id):
    url = os.environ.get("DEPLOY_HEALTH_URL", "http://127.0.0.1:8089/version.txt")
    request = urllib.request.Request(
        url, headers={"Host": "app.fameex-testnet.xyz", "Cache-Control": "no-cache"}
    )
    # 本机探测不经过服务器可能配置的 HTTP 代理。
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(5):
        try:
            with opener.open(request, timeout=5) as response:
                if response.read().decode().strip() == release_id:
                    return
        except (OSError, UnicodeError):
            pass
        if attempt < 4:
            time.sleep(1)
    raise RuntimeError("本机 HTTP 返回的版本不匹配")


def deploy(root, release_id):
    root = Path(root).resolve(strict=True)
    with (root / ".deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = linked_release(root, "current")
        previous = linked_release(root, "previous")
        target = previous if release_id == "--rollback" else release_path(root, release_id)
        if target is None:
            raise ValueError("没有可回退的版本")
        if old == target:
            check_health(target.name)
            return

        # 保留旧页面仍可能请求的带哈希资源，避免切换版本后懒加载失败。
        for directory in ("_next/static",):
            source = target / directory
            if source.is_dir():
                shutil.copytree(
                    source, root / "shared" / directory,
                    dirs_exist_ok=True, copy_function=copy_asset
                )
        switch_link(root, "current", target)
        try:
            check_health(target.name)
        except Exception:
            if old is not None:
                switch_link(root, "current", old)
            else:
                (root / "current").unlink()
            raise RuntimeError("发布检查失败，已恢复发布前状态") from None
        if old is not None:
            switch_link(root, "previous", old)
        print(f"当前版本：{target.name}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法：python3 release.py <版本标识|--rollback>")
    try:
        deploy(os.environ.get("DEPLOY_ROOT", "/srv/hyperliquid"), sys.argv[1])
    except (OSError, ValueError, RuntimeError) as error:
        sys.exit(str(error))
