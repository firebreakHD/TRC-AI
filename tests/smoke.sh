#!/usr/bin/env bash
set -euo pipefail

image=${1:-trc-ai:0.2.0}
instance="trc-test-$$-$RANDOM"
data="$instance-data"
archive="$instance-archive"
fixture=$(mktemp -d)
restored="$instance-restored"
export TRC_TEST_ADMIN="admin_test_only_000000000000000000000"
export TRC_TEST_WORKFLOW="workflow_test_only_000000000000000000"
cleanup() {
    docker rm -f "$instance" >/dev/null 2>&1 || true
    docker volume rm "$data" "$archive" "$restored" >/dev/null 2>&1 || true
    rm -rf -- "$fixture"
}
trap cleanup EXIT
trap 'docker logs --tail=100 "$instance" >&2 || true' ERR

for volume in "$data" "$archive" "$restored"; do
    docker volume create "$volume" >/dev/null
done

printf '{"admin_token":"%s","workflow_token":"%s"}\n' "$TRC_TEST_ADMIN" "$TRC_TEST_WORKFLOW" |
    docker run --rm -i -v "$data:/data" --entrypoint sh "$image" -c 'umask 077; cat > /data/options.json'

start() {
    docker run -d --name "$instance" -p 127.0.0.1::8099 -v "$1:/data" "$image" >/dev/null
    export TRC_TEST_URL="http://$(docker port "$instance" 8099/tcp)"
    for attempt in {1..40}; do
        if curl -fsS "$TRC_TEST_URL/healthz" >/dev/null 2>&1 &&
            docker exec "$instance" python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:6333/readyz", timeout=2)' >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done
    return 1
}

check_database() {
    docker exec -u trc "$instance" psql -At -h /run/postgresql trc -c "$1"
}
stop() {
    docker stop --time 45 "$instance" >/dev/null
    test "$(docker inspect -f '{{.State.ExitCode}}' "$instance")" = 0
    docker logs "$instance" 2>&1 | grep 'database system is shut down' >/dev/null
    docker rm "$instance" >/dev/null
}

start "$data"
docker exec -i "$instance" python - fresh < tests/vector_store.py
python3 tests/smoke.py fresh
test "$(check_database 'SELECT count(*) FROM schema_migrations')" = 1
test "$(check_database 'SELECT count(*) FROM workflow_records')" = 3
if [[ "${TRC_TEST_BROWSER:-0}" = 1 ]]; then
    python3 tests/browser.py
fi

old_pid=$(docker exec "$instance" head -n 1 /data/postgresql/cluster/postmaster.pid)
docker exec "$instance" gosu postgres pg_ctl -D /data/postgresql/cluster -m fast -W stop >/dev/null
restarted=0
for attempt in {1..15}; do
    new_pid=$(docker exec "$instance" head -n 1 /data/postgresql/cluster/postmaster.pid 2>/dev/null || true)
    if [[ -n "$new_pid" && "$old_pid" != "$new_pid" ]] &&
        curl -fsS "$TRC_TEST_URL/healthz" >/dev/null 2>&1; then
        restarted=1
        break
    fi
    sleep 1
done
test "$restarted" = 1
curl -fsS "$TRC_TEST_URL/healthz"
printf '\nAutomatischer PostgreSQL-Neustart geprüft.\n'

stop
printf '{"admin_token":"%s","workflow_token":"%s","network_proxy_mode":"trusted_proxy","network_trusted_proxies":["127.0.0.1"],"network_tls_mode":"proxy_https","network_public_url":"https://after.example.invalid"}\n'     "$TRC_TEST_ADMIN" "$TRC_TEST_WORKFLOW" |
    docker run --rm -i -v "$data:/data" --entrypoint sh "$image" -c 'umask 077; cat > /data/options.json'
start "$data"
python3 tests/smoke.py persisted
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=trc-proxy-fixture     -addext subjectAltName=IP:127.0.0.1 -out "$fixture/test-ca.pem" -keyout "$fixture/test-key.pem" 2>/dev/null
docker cp "$fixture/test-ca.pem" "$instance:/tmp/trc-test-ca.pem"
docker cp "$fixture/test-key.pem" "$instance:/tmp/trc-test-key.pem"
docker exec -i "$instance" python - "$TRC_TEST_ADMIN" /tmp/trc-test-ca.pem /tmp/trc-test-key.pem < tests/network_proxy.py
docker stats --no-stream --format 'Docker-Statistik im Leerlauf: CPU {{.CPUPerc}}, RAM {{.MemUsage}}' "$instance"
docker exec "$instance" python -c '
import os
from pathlib import Path

for status in sorted(Path("/proc").glob("[0-9]*/status")):
    if status.parent.name == str(os.getpid()):
        continue
    values = dict(line.split(":", 1) for line in status.read_text().splitlines())
    if "VmRSS" in values:
        name = values["Name"].strip()
        rss = values["VmRSS"].strip()
        print(f"{name}: {rss} RSS")
'

stop

# Cold archive of the same data directory used by the HAOS app.
docker run --rm -v "$data:/data:ro" -v "$archive:/archive" --entrypoint tar "$image"     -C /data -czf /archive/trc.tar.gz .
docker run --rm -v "$restored:/data" -v "$archive:/archive:ro" --entrypoint tar "$image"     -C /data -xzf /archive/trc.tar.gz
start "$restored"
docker exec -i "$instance" python - restored < tests/vector_store.py
python3 tests/smoke.py persisted
test "$(check_database "SELECT payload->>'title' FROM workflow_records WHERE external_id = 'task-42'")" = 'Aktualisiert'
stop
printf 'Kalter Backup- und Restore-Test in neuem Volume erfolgreich.\n'
