import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.fail_health = False
        test = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                file = test.root / "current" / "version.txt"
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"wrong version" if test.fail_health else file.read_bytes())

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.old_url = os.environ.get("DEPLOY_HEALTH_URL")
        os.environ["DEPLOY_HEALTH_URL"] = (
            f"http://127.0.0.1:{self.server.server_port}/version.txt"
        )

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()
        if self.old_url is None:
            os.environ.pop("DEPLOY_HEALTH_URL", None)
        else:
            os.environ["DEPLOY_HEALTH_URL"] = self.old_url

    def fixture(self, number):
        release_id = f"{number:040x}-{number}-1"
        target = self.root / "releases" / release_id
        (target / "_next/static").mkdir(parents=True)
        (target / "_next/static" / f"app-{number}.js").write_text(f"version {number}")
        (target / "index.html").write_text("<html>app</html>")
        (target / "version.txt").write_text(release_id + "\n")
        return target

    def test_publish_and_manual_rollback_preserve_old_assets(self):
        first, second = self.fixture(1), self.fixture(2)
        release.deploy(self.root, first.name)
        release.deploy(self.root, second.name)
        self.assertEqual((self.root / "current").resolve(), second)
        self.assertEqual((self.root / "previous").resolve(), first)
        self.assertTrue((self.root / "shared/_next/static/app-1.js").exists())
        release.deploy(self.root, "--rollback")
        self.assertEqual((self.root / "current").resolve(), first)
        self.assertEqual((self.root / "previous").resolve(), second)

    def test_failed_health_check_restores_old_release(self):
        first, second = self.fixture(1), self.fixture(2)
        release.deploy(self.root, first.name)
        self.fail_health = True
        with self.assertRaisesRegex(RuntimeError, "恢复"):
            release.deploy(self.root, second.name)
        self.assertEqual((self.root / "current").resolve(), first)

    def test_first_failed_release_does_not_leave_current(self):
        target = self.fixture(1)
        self.fail_health = True
        with self.assertRaises(RuntimeError):
            release.deploy(self.root, target.name)
        self.assertFalse((self.root / "current").exists())

    def test_rollback_without_previous_keeps_current(self):
        first = self.fixture(1)
        release.deploy(self.root, first.name)
        with self.assertRaisesRegex(ValueError, "没有可回退"):
            release.deploy(self.root, "--rollback")
        self.assertEqual((self.root / "current").resolve(), first)

    def test_failed_rollback_keeps_both_release_links(self):
        first, second = self.fixture(1), self.fixture(2)
        release.deploy(self.root, first.name)
        release.deploy(self.root, second.name)
        self.fail_health = True
        with self.assertRaisesRegex(RuntimeError, "恢复"):
            release.deploy(self.root, "--rollback")
        self.assertEqual((self.root / "current").resolve(), second)
        self.assertEqual((self.root / "previous").resolve(), first)

    def test_incomplete_release_and_path_escape_leave_current_unchanged(self):
        first, second = self.fixture(1), self.fixture(2)
        release.deploy(self.root, first.name)
        (second / "index.html").unlink()
        for invalid in (second.name, "../../other"):
            with self.assertRaises(ValueError):
                release.deploy(self.root, invalid)
        self.assertEqual((self.root / "current").resolve(), first)


if __name__ == "__main__":
    unittest.main()
