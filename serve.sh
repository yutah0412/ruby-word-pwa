#!/bin/bash
# ローカル動作確認用の簡易HTTPサーバー起動スクリプト
# 使い方: ./serve.sh  → http://localhost:8000 でアクセス

cd "$(dirname "$0")"

echo "================================"
echo " ルビ振りWord PWA - Local Server"
echo "================================"
echo ""

# Python 3 があればそれを使う
if command -v python3 &> /dev/null; then
    echo "Starting Python HTTP server on port 8000..."
    echo "→ http://localhost:8000"
    echo ""
    echo "Press Ctrl+C to stop."
    python3 -m http.server 8000
elif command -v node &> /dev/null; then
    echo "Starting Node.js HTTP server on port 8000..."
    echo "→ http://localhost:8000"
    echo ""
    npx serve . -p 8000
else
    echo "Error: Python3 or Node.js is required."
    echo "Please install either one."
    exit 1
fi
