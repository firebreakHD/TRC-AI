#!/bin/bash
set -euo pipefail

install -d -m 0700 -o postgres -g postgres /data/postgresql
install -d -m 0750 -o trc -g trc /data/config
install -d -m 0700 -o trc -g trc /data/documents
install -d -m 0700 -o qdrant -g qdrant /data/qdrant
install -d -m 0755 -o postgres -g postgres /run/postgresql
install -d -m 0750 -o root -g trc /run/trc

# Copy only runtime settings. The supervisor provides options.json as root.
umask 077
if [[ -f /data/options.json ]]; then
    install -m 0640 -o root -g trc /data/options.json /run/trc/options.json
else
    printf '{}\n' > /run/trc/options.json
    chgrp trc /run/trc/options.json
    chmod 0640 /run/trc/options.json
fi

# Build the initial cluster in a staging directory so an interrupted bootstrap
# cannot leave a nominally initialized cluster without its app role and DB.
if [[ ! -e /data/postgresql/cluster ]]; then
    staging=$(mktemp -d /data/postgresql/.init.XXXXXX)
    chown postgres:postgres "$staging"
    trap 'gosu postgres pg_ctl -D "$staging" -m fast -w stop >/dev/null 2>&1 || true; rm -rf -- "$staging"' EXIT
    trap 'exit 143' TERM INT
    gosu postgres initdb -D "$staging" --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
    gosu postgres pg_ctl -D "$staging" -o "-c listen_addresses='' -k /run/postgresql" -w start
    gosu postgres createuser --host=/run/postgresql trc
    gosu postgres createdb --host=/run/postgresql --owner=trc trc
    gosu postgres pg_ctl -D "$staging" -m fast -w stop
    mv -- "$staging" /data/postgresql/cluster
    trap - EXIT TERM INT
fi

TRC_PG_BUFFERS_MB=$(/opt/venv/bin/python -c 'from trc.rag.config import load; print(load().rag_pg_buffers_mib)')
export TRC_PG_BUFFERS_MB

exec /usr/bin/supervisord -n -c /opt/trc/supervisord.conf
