#!/usr/bin/env bash
# Starts the whole Flora platform on one machine: Root → Canopy → Gateway → 2 Leaves,
# then opens a demo case on each Leaf. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then echo "  ok  $name"; return 0; fi
    sleep 2
  done
  echo "  !!  $name did not become healthy: $url" >&2
  exit 1
}

echo "[1/4] flora-root (cloud)"
docker compose -f flora-root/compose.yaml up -d --build
wait_for "root api" http://localhost:7100/health

echo "[2/4] flora-canopy (hospital)"
docker compose -f flora-canopy/compose.yaml up -d --build
wait_for "canopy sync api" http://localhost:7203/health
wait_for "haber" http://localhost:7204/health

echo "[3/4] flora-gateway (devices) + simulator"
docker compose -f flora-gateway/compose.yaml --profile demo up -d --build
wait_for "gateway service" http://localhost:7400/health
wait_for "gateway data-api (kong)" http://localhost:7410/data-api/health

echo "[4/4] flora-leaf x2 (workstations)"
for leaf in leaf-or-01 leaf-icu-01; do
  docker compose -f flora-leaf/compose.yaml -p "flora-$leaf" --env-file "flora-leaf/env/$leaf.env" up -d --build
done
wait_for "leaf-or-01 api" http://localhost:7301/health
wait_for "leaf-icu-01 api" http://localhost:7311/health

echo "Opening demo cases"
python3 demo/seed-cases.py

cat <<'URLS'

Flora demo is running (all data is synthetic):
  Root admin            http://localhost:7100
  Canopy viewer         http://localhost:7200   (admin / admin, change on first sign-in)
  Canopy Haber          http://localhost:7204
  Gateway admin         http://localhost:7400
  Device simulator      http://localhost:7420
  Leaf  OR-1            http://localhost:7300   (admin / FloraDemo-2026)
  Leaf  ICU bed 1       http://localhost:7310   (admin / FloraDemo-2026)
Vitals appear on each Leaf chart within about a minute. See demo/README.md.
URLS
