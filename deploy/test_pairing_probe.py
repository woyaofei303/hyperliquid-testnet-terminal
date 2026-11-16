"""探针异常也不能把会话令牌写入 CI 或管理员终端。"""
from pathlib import Path
import subprocess
import unittest
from urllib.parse import quote


class ProbeOutputTest(unittest.TestCase):
    def test_invalid_or_duplicate_tokens_are_not_logged(self):
        probe = Path(__file__).with_name('probe-staging-pairing.mjs')
        for token in ('synthetic-private-token', 'a' * 64):
            with self.subTest(token_kind=len(token)):
                fixture = f'''
let calls = 0;
globalThis.fetch = async () => new Response(JSON.stringify(++calls === 1 ? {{error:403}} : {{
 id:'b'.repeat(32), webToken:'{token}', phoneToken:'{token}', expiresAt:Date.now()+300000
}}), {{status:calls === 1 ? 403 : 200, headers:{{'Cache-Control':'no-store'}}}});
'''
                result = subprocess.run(
                    ['node', '--import', 'data:text/javascript,' + quote(fixture),
                     str(probe), 'http://127.0.0.1:3211'],
                    capture_output=True, text=True, timeout=10, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('"passedChecks":2', result.stderr)
                self.assertNotIn(token, result.stderr + result.stdout)
