#!/bin/zsh
set -e
TRAPZERR() {
  echo "本机音轨助手未能启动。请将上方错误发给我；按任意键关闭窗口。"
  read -k 1
}
cd "$(dirname "$0")/.."
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
    python_bin="$(command -v "$candidate")"
    break
  fi
done
if [[ -z "$python_bin" ]]; then
  echo "需要 Python 3.10 或更新版本。请先安装 Python，然后再次双击此文件。"
  read -k 1
  exit 1
fi
mkdir -p .local-youtube-tools
yt_dlp_file="$PWD/.local-youtube-tools/yt-dlp"
expected_sha='1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6'
if [[ ! -f "$yt_dlp_file" ]] || [[ "$(shasum -a 256 "$yt_dlp_file" | awk '{print $1}')" != "$expected_sha" ]]; then
  curl -fL --retry 3 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp' -o "$yt_dlp_file.tmp"
  if [[ "$(shasum -a 256 "$yt_dlp_file.tmp" | awk '{print $1}')" != "$expected_sha" ]]; then
    echo "下载校验失败，请重试。"
    rm -f "$yt_dlp_file.tmp"
    read -k 1
    exit 1
  fi
  mv "$yt_dlp_file.tmp" "$yt_dlp_file"
fi
export YT_DLP_PATH="$yt_dlp_file"
export YT_DLP_PYTHON="$python_bin"
"$python_bin" tools/local-youtube-bridge.py
