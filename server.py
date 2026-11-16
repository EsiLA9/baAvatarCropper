import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
INDEX = "assets-index.json"


def scan(folder, extensions):
    directory = ROOT / folder
    result = []
    for file in sorted(directory.rglob("*"), key=lambda path: (str(path).casefold(), str(path))):
        try:
            if (file.suffix.lower() not in extensions or not file.is_file()
                    or file.is_symlink() or not file.resolve().is_relative_to(directory)):
                continue
            stat = file.stat()
        except OSError:
            continue
        result.append({
            "path": file.relative_to(ROOT).as_posix(),
            "revision": f"{stat.st_mtime_ns}-{stat.st_size}",
            "addedAt": round(getattr(stat, "st_birthtime", stat.st_mtime) * 1000),
        })
    return result


def asset_index():
    return json.dumps({
        "guides": scan("reference-images", {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp"}),
        "packs": scan("background-packs", {".zip"}),
    }, ensure_ascii=False).encode("utf-8")


class AssetHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path != f"/{INDEX}":
            return super().do_GET()
        data = asset_index()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve the avatar editor and discover its asset folders.")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--index-only", action="store_true", help="Write the asset index for a static host.")
    args = parser.parse_args()
    if args.index_only:
        (ROOT / INDEX).write_bytes(asset_index())
    else:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(AssetHandler, directory=ROOT))
        print(f"http://127.0.0.1:{server.server_port}/", flush=True)
        with server:
            server.serve_forever()
