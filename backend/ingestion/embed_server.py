"""
Minimal embedding microservice.
Loads sentence-transformers/all-mpnet-base-v2 once and serves POST /embed.

Usage:
    uv run python embed_server.py          # default port 8000
    uv run python embed_server.py --port 8001
"""

import argparse
from sentence_transformers import SentenceTransformer
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

MODEL_NAME = "sentence-transformers/all-mpnet-base-v2"

print(f"Loading {MODEL_NAME} …", flush=True)
_model = SentenceTransformer(MODEL_NAME)
print("Model ready.", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # silence access logs
        pass

    def do_POST(self):
        if self.path != "/embed":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        text = body.get("text", "")

        embedding = _model.encode(text, convert_to_numpy=True).tolist()

        payload = json.dumps({"embedding": embedding}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = HTTPServer(("0.0.0.0", args.port), Handler)
    print(f"Embed server listening on http://0.0.0.0:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
