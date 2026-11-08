"""Runs every browser test (tests/test_*.py) against a static server this script starts itself.
   python3 tests/run_e2e.py            all tests
   python3 tests/run_e2e.py ruled      only test files whose name contains 'ruled'
   python3 tests/run_e2e.py --jobs 3   run up to 3 test files at the same time (faster; each file has its own browser. The timing tests
                                       (test_perf, test_caret_draw) are always run alone, after the others, so a busy machine cannot upset them)
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
    args = sys.argv[1:]; jobs = 1
    if "--jobs" in args: i = args.index("--jobs"); jobs = max(1, int(args[i + 1])); del args[i:i + 2]
    pick = args
    files = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
    if pick: files = [f for f in files if any(p in os.path.basename(f) for p in pick)]
    failed = []
    SOLO = ("test_perf", "test_caret_draw")                                     # (wall-clock sensitive: never in parallel with anything)
    def run(f):
        t = time.time()
        r = subprocess.run([sys.executable, f], cwd=HERE, env=env, capture_output=jobs > 1, text=True)
        out = f"\n===== {os.path.basename(f)} =====\n" + (r.stdout or "") + (r.stderr or "") if jobs > 1 else ""
        return f, r.returncode, time.time() - t, out
    def report(f, code, dt, out):
        if out: print(out, flush=True)
        print(f"----- {os.path.basename(f)}: {'ok' if code == 0 else 'FAILED'} ({dt:.0f}s)", flush=True)
        if code: failed.append(os.path.basename(f))
    if jobs == 1:
        for f in files:
            print(f"\n===== {os.path.basename(f)} =====", flush=True); report(*run(f))
    else:
        from concurrent.futures import ThreadPoolExecutor
        par = [f for f in files if not any(n in os.path.basename(f) for n in SOLO)]; solo = [f for f in files if f not in par]
        with ThreadPoolExecutor(jobs) as ex:
            for res in ex.map(run, par): report(*res)
        for f in solo: report(*run(f))
    srv.shutdown()
    print("\nFAILED: " + ", ".join(failed) if failed else "\nAll browser tests passed.")
    sys.exit(1 if failed else 0)
main()
