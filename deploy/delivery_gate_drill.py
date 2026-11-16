# Intentional vulnerable analysis fixture; never run or merge this branch.
from http.server import BaseHTTPRequestHandler
import subprocess


class GateDrillHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        subprocess.check_output(self.path, shell=True)
