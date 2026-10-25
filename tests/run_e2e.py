"""Runs every browser test (tests/test_*.py) against a static server this script starts itself.
   python3 tests/run_e2e.py            all tests
   python3 tests/run_e2e.py ruled      only test files whose name contains 'ruled'
Needs: python3, playwright (pip install playwright pillow numpy; playwright install chromium)."""
import functools, glob, http.server, os, socketserver, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True

def main():
    srv = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    env = dict(os.environ, NOTEFLOW_URL=f"http://127.0.0.1:{port}/index.html")
    pick = sys.argv[1:] 
    files = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
    if pick: files = [f for f in files if any(p in os.path.basename(f) for p in pick)]
    failed = []
    for f in files:
        t = time.time(); print(f"\n===== {os.path.basename(f)} =====", flush=True)
        r = subprocess.run([sys.executable, f], cwd=HERE, env=env)
        print(f"----- {os.path.basename(f)}: {'ok' if r.returncode == 0 else 'FAILED'} ({time.time() - t:.0f}s)", flush=True)
        if r.returncode: failed.append(os.path.basename(f))
    srv.shutdown()
    print("\nFAILED: " + ", ".join(failed) if failed else "\nAll browser tests passed.")
    sys.exit(1 if failed else 0)
main()
