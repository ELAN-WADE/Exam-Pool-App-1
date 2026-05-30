#!/usr/bin/env sh
set -eu

echo "Starting Exampool LAN backend..."
bun server.ts
