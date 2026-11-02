"""在独立端口验收导出的站点，404 行为与生产 Nginx 保持一致。"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class StaticHandler(SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        if code != 404:
            return super().send_error(code, message, explain)
        body = (Path(self.directory) / "404.html").read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


if __name__ == "__main__":
    with ThreadingHTTPServer(
        ("127.0.0.1", 33211), partial(StaticHandler, directory="out")
    ) as server:
        server.serve_forever()
