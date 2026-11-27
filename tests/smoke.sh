#!/usr/bin/env bash
set -euo pipefail

image=${1:-trc-ai:0.3.1}
backup_tool=${TRC_TEST_BACKUP_TOOL_IMAGE:-busybox:1.37}
instance="trc-test-$$-$RANDOM"
data="$instance-data"
archive="$instance-archive"
fixture=$(mktemp -d)
restored="$instance-restored"
export TRC_TEST_ADMIN="admin_test_only_000000000000000000000"
export TRC_TEST_CHAT="chat_test_only_0000000000000000000000"
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

mkdir -p "$fixture/shared/knowledge"
chmod 755 "$fixture" "$fixture/shared" "$fixture/shared/knowledge"
printf '# Vault-Freigabe\n\nDie Kennung im beobachteten Ordner lautet LOKALSPEICHER.\n' > "$fixture/shared/knowledge/vault.md"
chmod 644 "$fixture/shared/knowledge/vault.md"
printf '{"admin_token":"%s","workflow_token":"%s","chat_token":"%s","rag_chat_model":"fixture","rag_shared_dir":"knowledge","rag_poll_seconds":10}\n' "$TRC_TEST_ADMIN" "$TRC_TEST_WORKFLOW" "$TRC_TEST_CHAT" |
    docker run --rm -i -v "$data:/data" --entrypoint sh "$backup_tool" -c 'umask 077; cat > /data/options.json'

start() {
    docker run -d --name "$instance" -v "$fixture/shared:/share:ro" -p 127.0.0.1::8099 -v "$1:/data" "$image" >/dev/null
    docker cp tests/rag_model_fixture.py "$instance:/tmp/trc_model_fixture.py"
    docker exec -d "$instance" python /tmp/trc_model_fixture.py
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

if [[ -n "${TRC_TEST_BASELINE_IMAGE:-}" ]]; then
    docker run -d --name "$instance" -p 127.0.0.1::8099 -v "$data:/data" "$TRC_TEST_BASELINE_IMAGE" >/dev/null
    legacy_api="http://$(docker port "$instance" 8099/tcp)"
    for attempt in {1..40}; do
        if curl -fsS "$legacy_api/healthz" >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    replay_id=ea42bc23-cca2-4eff-a90b-80bcf8b1703f
    curl -fsS "$legacy_api/api/v1/workflow/records/tasks" \
        -H "Authorization: Bearer $TRC_TEST_WORKFLOW" -H "Idempotency-Key: $replay_id" \
        -H "Content-Type: application/json" --data-binary @contracts/examples/tasks.json >/dev/null
    docker cp tests/rag_model_fixture.py "$instance:/tmp/trc_model_fixture.py"
    docker exec -d "$instance" python /tmp/trc_model_fixture.py
    curl -fsS -X PUT "$legacy_api/api/v1/admin/network/services/ollama" \
         -H "Authorization: Bearer $TRC_TEST_ADMIN" -H "Content-Type: application/json" \
         --data '{"enabled":true,"internal_url":"http://127.0.0.1:11435"}' >/dev/null
    printf '# Bestehender Beleg\n\nALTBELEG bleibt nach dem Upgrade abrufbar.\n' |         curl -fsS -X PUT "$legacy_api/api/v1/knowledge/documents/altbeleg.md" \
             -H "Authorization: Bearer $TRC_TEST_ADMIN" -H "Content-Type: application/octet-stream" \
             --data-binary @- >/dev/null
    migrated_source=0
    for attempt in {1..35}; do
        if curl -fsS "$legacy_api/api/v1/knowledge/documents" -H "Authorization: Bearer $TRC_TEST_ADMIN" | \
            python3 -c 'import json,sys; assert any(item["path"]=="upload/altbeleg.md" and item["state"]=="done" for item in json.load(sys.stdin)["documents"])' 2>/dev/null; then
            migrated_source=1
            break
        fi
        sleep 1
    done
    test "$migrated_source" = 1
    export TRC_TEST_UPGRADE_SEEDED=1
    stop
    printf 'Release 0.2.0 mit bestehendem Datensatz für das Upgrade vorbereitet.\n'
fi

start "$data"
docker exec -i "$instance" python - fresh < tests/vector_store.py
python3 tests/smoke.py fresh
test "$(check_database 'SELECT count(*) FROM schema_migrations')" = 2
test "$(check_database 'SELECT count(*) FROM workflow_records')" = 3
docker exec -i "$instance" python - /tmp/trc-fake-documents < tests/rag_fixtures.py
docker cp "$instance:/tmp/trc-fake-documents" "$fixture/"
python3 tests/rag_smoke.py fresh "$fixture/trc-fake-documents"
python3 tests/intelligence_smoke.py fresh
export TRC_TEST_CHAT_GLOBAL=1
mv "$fixture/shared/knowledge" "$fixture/shared/offline"
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
printf '{"admin_token":"%s","workflow_token":"%s","chat_token":"%s","network_proxy_mode":"trusted_proxy","network_trusted_proxies":["127.0.0.1"],"network_tls_mode":"proxy_https","network_public_url":"https://after.example.invalid","rag_chat_model":"fixture","rag_shared_dir":"knowledge","rag_poll_seconds":10}\n'     "$TRC_TEST_ADMIN" "$TRC_TEST_WORKFLOW" "$TRC_TEST_CHAT" |
    docker run --rm -i -v "$data:/data" --entrypoint sh "$backup_tool" -c 'umask 077; cat > /data/options.json'
start "$data"
python3 tests/smoke.py persisted
python3 tests/rag_smoke.py persisted
python3 tests/intelligence_smoke.py persisted
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
docker run --rm -v "$data:/data:ro" -v "$archive:/archive" --entrypoint tar "$backup_tool"     -C /data -czf /archive/trc.tar.gz .
docker run --rm -v "$restored:/data" -v "$archive:/archive:ro" --entrypoint tar "$backup_tool"     -C /data -xzf /archive/trc.tar.gz
start "$restored"
docker exec -i "$instance" python - restored < tests/vector_store.py
python3 tests/smoke.py persisted
python3 tests/rag_smoke.py persisted
python3 tests/intelligence_smoke.py persisted
docker exec "$instance" python -c 'import urllib.request; urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:6333/collections/trc_knowledge_v1", method="DELETE")).close()'
curl -fsS -X POST "$TRC_TEST_URL/api/v1/knowledge/index/repair" \
    -H "Authorization: Bearer $TRC_TEST_ADMIN" >/dev/null
restored_points=0
for attempt in {1..40}; do
    if docker exec "$instance" python -c 'import json, urllib.request; assert json.load(urllib.request.urlopen("http://127.0.0.1:6333/collections/trc_knowledge_v1"))["result"]["points_count"] >= 9' >/dev/null 2>&1; then
        restored_points=1
        break
    fi
    sleep 1
done
test "$restored_points" = 1
python3 tests/rag_smoke.py persisted
python3 tests/intelligence_smoke.py persisted
test "$(check_database "SELECT payload->>'title' FROM workflow_records WHERE external_id = 'task-42'")" = 'Aktualisiert'
stop
printf 'Kalter Backup- und Restore-Test in neuem Volume erfolgreich.\n'
