import importlib.util
import json
import http.server
from functools import partial
import threading
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'releases').mkdir()
        (self.root / 'incoming').mkdir()
        self.health = patch.object(release, 'check_health', return_value=None)
        self.health.start()

    def tearDown(self):
        self.health.stop()
        self.tmp.cleanup()

    def fixture(self, n, incoming=False):
        rid = f'{n:040x}-{n}-1'
        target = self.root / ('incoming' if incoming else 'releases') / rid
        (target / '_next/static').mkdir(parents=True)
        (target / '_next/static' / f'app-{n}.js').write_text(f'v{n}')
        (target / 'index.html').write_text(f'<script src="/_next/static/app-{n}.js"></script>')
        (target / '404.html').write_text('not found')
        release.create_manifest(target, rid)
        return target

    def publish(self, target, old=None):
        release.deploy(self.root, target.name, old.name if old else 'none')

    def test_promote_then_rollback_preserves_assets(self):
        first, second = self.fixture(1, True), self.fixture(2, True)
        self.publish(first)
        first = self.root / 'releases' / first.name
        self.publish(second, first)
        second = self.root / 'releases' / second.name
        release.deploy(self.root, '--rollback', second.name, first.name)
        self.assertEqual((self.root / 'current').resolve(), first)
        self.assertEqual((self.root / 'previous').resolve(), second)
        self.assertTrue((self.root / 'shared/_next/static/app-2.js').is_file())

    def test_manifest_detects_changed_missing_and_extra_files(self):
        for mode in ('change', 'missing', 'extra'):
            with self.subTest(mode=mode):
                target = self.fixture({'change': 1, 'missing': 2, 'extra': 3}[mode])
                if mode == 'change':
                    (target / 'index.html').write_text('tampered')
                elif mode == 'missing':
                    (target / 'index.html').unlink()
                else:
                    (target / 'extra.txt').write_text('extra')
                with self.assertRaises(ValueError):
                    release.verify_manifest(target, target.name)

    def test_rejects_symlinks_secrets_and_maps(self):
        for n, name in enumerate(('.env', 'private.pem', 'app.js.map', 'runtime-config.json'), 1):
            target = self.fixture(n)
            (target / name).write_text('forbidden')
            with self.assertRaises(ValueError):
                release.create_manifest(target, target.name)
        target = self.fixture(9)
        (target / 'escape').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):
            release.create_manifest(target, target.name)

    def test_rejects_mismatched_identity_and_path_escape(self):
        target = self.fixture(1)
        manifest = target / 'release-manifest.json'
        data = json.loads(manifest.read_text())
        data['commitSha'] = 'f' * 40
        manifest.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            release.verify_manifest(target, target.name)
        for invalid in ('../../other', '--unknown', ''):
            with self.assertRaises(ValueError):
                release.deploy(self.root, invalid, 'none')

    def test_stale_candidate_and_rollback_target_are_rejected(self):
        first, second, third = self.fixture(1), self.fixture(2), self.fixture(3)
        self.publish(first)
        self.publish(second, first)
        with self.assertRaisesRegex(ValueError, '当前版本'):
            self.publish(third, first)
        with self.assertRaises(ValueError):
            release.deploy(self.root, '--rollback', second.name, third.name)
        self.assertEqual((self.root / 'current').resolve(), second)

    def test_failed_health_restores_and_verifies_old(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        with patch.object(release, 'check_health', side_effect=[RuntimeError('bad'), None]) as health:
            with self.assertRaisesRegex(RuntimeError, '已恢复'):
                self.publish(second, first)
            self.assertEqual(health.call_count, 2)
        self.assertEqual((self.root / 'current').resolve(), first)

    def test_failed_recovery_is_not_reported_as_success(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        with patch.object(release, 'check_health', side_effect=RuntimeError('bad')):
            with self.assertRaisesRegex(RuntimeError, '恢复失败'):
                self.publish(second, first)
        self.assertTrue((self.root / '.deployment.json').exists())
        with self.assertRaisesRegex(ValueError, '未完成'):
            self.publish(second, first)
        release.recover(self.root, first.name)
        self.assertFalse((self.root / '.deployment.json').exists())

    def test_first_failed_deploy_restores_empty_state(self):
        target = self.fixture(1)
        with patch.object(release, 'check_health', side_effect=RuntimeError('bad')):
            with self.assertRaisesRegex(RuntimeError, '无版本'):
                self.publish(target)
        self.assertFalse((self.root / 'current').is_symlink())

    def test_asset_collision_does_not_change_old_site(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        (second / '_next/static/app-1.js').write_text('collision')
        release.create_manifest(second, second.name)
        with self.assertRaisesRegex(ValueError, '资源冲突'):
            self.publish(second, first)
        self.assertEqual((self.root / 'shared/_next/static/app-1.js').read_text(), 'v1')
        self.assertEqual((self.root / 'current').resolve(), first)

    def test_upload_failure_and_repeat_do_not_replace_current(self):
        first, second = self.fixture(1), self.fixture(2, True)
        self.publish(first)
        (second / 'index.html').unlink()
        with self.assertRaises(ValueError):
            self.publish(second, first)
        self.publish(first, first)
        self.assertEqual((self.root / 'current').resolve(), first)

    def test_disk_full_before_switch_keeps_current(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        with patch.object(release, 'copy_asset', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.publish(second, first)
        self.assertEqual((self.root / 'current').resolve(), first)

    def test_previous_link_failure_restores_both_links(self):
        first, second, third = self.fixture(1), self.fixture(2), self.fixture(3)
        self.publish(first)
        self.publish(second, first)
        original = release.switch_link
        def fail_previous(root, name, target):
            if name == 'previous' and target == second:
                raise OSError('disk full')
            original(root, name, target)
        with patch.object(release, 'switch_link', side_effect=fail_previous):
            with self.assertRaisesRegex(RuntimeError, '已恢复'):
                self.publish(third, second)
        self.assertEqual((self.root / 'current').resolve(), second)
        self.assertEqual((self.root / 'previous').resolve(), first)

    def test_interrupted_switch_requires_explicit_guarded_recovery(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        with patch.object(release, 'check_health', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.publish(second, first)
        with self.assertRaises(ValueError):
            release.recover(self.root, first.name)
        release.recover(self.root, second.name)
        self.assertEqual((self.root / 'current').resolve(), first)
        self.assertFalse((self.root / '.deployment.json').exists())

    def test_concurrent_candidates_cannot_both_replace_the_same_version(self):
        first, second, third = self.fixture(1), self.fixture(2), self.fixture(3)
        self.publish(first)
        def attempt(target):
            try:
                self.publish(target, first)
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(attempt, [second, third]))
        self.assertEqual(sorted(results), [False, True])
        self.assertEqual((self.root / 'previous').resolve(), first)
        self.assertFalse((self.root / '.deployment.json').exists())

    def test_real_http_health_checks_version_home_and_script(self):
        self.health.stop()
        target = self.fixture(1)
        handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(target))
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                env = {'DEPLOY_ROOT': str(self.root), 'DEPLOY_HEALTH_URL': f'http://127.0.0.1:{server.server_port}/version.txt'}
                with patch.dict(os.environ, env), patch.object(release.time, 'sleep'):
                    release.check_health(target.name)
                    (target / 'index.html').write_text('corrupt')
                    with self.assertRaises(ValueError):
                        release.check_health(target.name)
            finally:
                server.shutdown()
                worker.join()

    def test_legacy_adoption_is_guarded_and_does_not_change_files_or_links(self):
        import sys
        sys.modules['release'] = release
        spec = importlib.util.spec_from_file_location('adopt', Path(__file__).with_name('adopt-legacy.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        first, second = self.fixture(1), self.fixture(2)
        for target in [first, second]:
            (target / release.MANIFEST).unlink()
        release.switch_link(self.root, 'current', second)
        release.switch_link(self.root, 'previous', first)
        with self.assertRaises(ValueError):
            module.adopt(self.root, first.name, second.name)
        before = release.inventory(second)
        module.adopt(self.root, second.name, first.name)
        module.adopt(self.root, second.name, first.name)
        self.assertEqual(release.inventory(second), before)
        self.assertEqual((self.root / 'current').resolve(), second)
        self.assertIn('not-attested', (self.root / '.legacy-adoption.json').read_text())

    def test_rollback_can_withdraw_corrupt_current_but_not_activate_corrupt_target(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        self.publish(second, first)
        (second / 'index.html').write_text('corrupted after publish')
        (first / '404.html').unlink()
        with self.assertRaises(ValueError):
            release.deploy(self.root, '--rollback', second.name, first.name)
        (first / '404.html').write_text('not found')
        release.deploy(self.root, '--rollback', second.name, first.name)
        self.assertEqual((self.root / 'current').resolve(), first)
        (self.root / 'current').unlink()
        (self.root / 'current').symlink_to('/etc')
        with self.assertRaises(ValueError):
            release.deploy(self.root, '--rollback', first.name, second.name)

    def test_recover_can_withdraw_current_with_missing_file(self):
        first, second = self.fixture(1), self.fixture(2)
        self.publish(first)
        with patch.object(release, 'check_health', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.publish(second, first)
        (second / 'index.html').unlink()
        release.recover(self.root, second.name)
        self.assertEqual((self.root / 'current').resolve(), first)


if __name__ == '__main__':
    unittest.main()
