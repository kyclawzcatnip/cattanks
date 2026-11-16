# Dev server: serves the game and accepts POST /log (used by browser test pages).
# Usage: python3 tests/devserver.py [port]
import http.server, sys, os

LOG = os.path.join(os.path.dirname(__file__), 'browser.log')

class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n).decode('utf-8', 'replace')
        with open(LOG, 'a') as f:
            f.write(data + '\n')
        self.send_response(204); self.end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(__file__), '..'))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
