#!/usr/bin/env python3
"""Local, opt-in YouTube audio bridge for the IELTS study site.

Runs only on 127.0.0.1. A browser request must come from the configured site,
and only a canonical 11-character YouTube video ID is accepted.
"""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 18765
MAX_BYTES = 200 * 1024 * 1024
ALLOWED_ORIGINS = {
    "https://ielts.grincaq.info",
    "http://localhost:3000",
    "http://localhost:5173",
}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
MIME_TYPES = {".m4a": "audio/mp4", ".webm": "audio/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg"}


def download_audio(video_id: str, directory: Path) -> Path:
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError("视频链接无效。")
    executable = os.environ.get("YT_DLP_PATH", "yt-dlp")
    python = os.environ.get("YT_DLP_PYTHON")
    base = ([python, executable] if python else [executable]) + ["--ignore-config", "--no-playlist", "--js-runtimes", "node", "--socket-timeout", "20", "--retries", "1", "--quiet", "--no-warnings", "-f", "bestaudio[abr<=80]/bestaudio"]
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        metadata = subprocess.run(base + ["--skip-download", "--dump-single-json", "--", url], capture_output=True, text=True, timeout=90, check=True)
        info = json.loads(metadata.stdout)
        duration = info.get("duration")
        if info.get("is_live") or info.get("live_status") == "is_live":
            raise ValueError("暂不支持直播视频。")
        if not isinstance(duration, (int, float)) or duration <= 0 or duration > 10800:
            raise ValueError("视频需短于 3 小时。")
        if (info.get("filesize") or info.get("filesize_approx") or 0) > MAX_BYTES:
            raise ValueError("音轨超过 200 MB。")
        output = str(directory / "audio.%(ext)s")
        subprocess.run(base + ["--max-filesize", str(MAX_BYTES), "-o", output, "--", url], capture_output=True, text=True, timeout=600, check=True)
    except FileNotFoundError as exc:
        raise ValueError("本机尚未安装 yt-dlp。请先运行 tools/start-local-youtube-bridge.command。") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError("获取音轨超时，请稍后再试。") from exc
    except subprocess.CalledProcessError as exc:
        # yt-dlp stderr can contain signed media URLs, so never return it to the browser.
        print(f"yt-dlp failed for {video_id}: exit={exc.returncode}", flush=True)
        raise ValueError("本机无法获取这个视频的音轨，请确认视频能在本机浏览器播放。") from exc
    files = [item for item in directory.iterdir() if item.is_file()]
    if len(files) != 1 or files[0].suffix not in MIME_TYPES:
        raise ValueError("未能获得受支持的音轨格式。")
    if not 1024 <= files[0].stat().st_size <= MAX_BYTES:
        raise ValueError("音轨为空或超过 200 MB。")
    return files[0]


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status: int, content_type: str, length: int = 0):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", ""))
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def _allowed(self) -> bool:
        return self.headers.get("Origin") in ALLOWED_ORIGINS

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(body))
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._allowed() or self.path not in ("/health", "/audio"):
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if not self._allowed() or self.path != "/health":
            self.send_error(403)
            return
        self._json(200, {"ok": True, "version": 1})

    def do_POST(self):
        if not self._allowed() or self.path != "/audio" or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 256:
                raise ValueError("请求格式无效。")
            video_id = json.loads(self.rfile.read(size))["videoId"]
            if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
                raise ValueError("视频链接无效。")
            with tempfile.TemporaryDirectory(prefix="ielts-local-audio-") as temp:
                file = download_audio(video_id, Path(temp))
                self._headers(200, MIME_TYPES[file.suffix], file.stat().st_size)
                with file.open("rb") as source:
                    shutil.copyfileobj(source, self.wfile)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    print(f"IELTS 本机音轨助手已启动：http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
