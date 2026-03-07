#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SERVER_URL=$(terraform output -raw run_server_url)
CLIENT_URL=$(terraform output -raw client_url)

echo "Server health: $SERVER_URL/health"
curl -fsS "$SERVER_URL/health" | jq -r '.' || true

echo "Client HEAD: $CLIENT_URL"
curl -I "$CLIENT_URL" || true
