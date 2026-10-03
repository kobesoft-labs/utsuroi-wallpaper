#!/usr/bin/env python3
"""開発用サーバー: キャッシュさせない (更新した JS や画像がすぐ反映されるように)。  python3 tools/serve.py [port]"""
import http.server, sys, functools, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8350
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
http.server.ThreadingHTTPServer(("", port), functools.partial(NoCache, directory=root)).serve_forever()
