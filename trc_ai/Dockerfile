FROM qdrant/qdrant:v1.18.0 AS vector_store
FROM postgres:18-trixie
LABEL org.opencontainers.image.source="https://github.com/firebreakHD/TRC-AI" \
      org.opencontainers.image.version="0.2.0"
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv supervisor tini libunwind8 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home trc \
    && useradd --system --no-create-home qdrant
WORKDIR /opt/trc
COPY requirements.lock .
RUN --mount=type=secret,id=pip_ca,target=/run/secrets/pip_ca \
    if [ -f /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.lock
COPY --from=vector_store /qdrant/qdrant /usr/local/bin/qdrant
COPY --from=vector_store /qdrant/qdrant.spdx.json /usr/share/doc/qdrant/qdrant.spdx.json
COPY qdrant.LICENSE /usr/share/doc/qdrant/LICENSE
RUN qdrant --version
COPY trc trc
COPY migrations migrations
COPY supervisord.conf qdrant.yaml run.sh ./
RUN chmod -R a+rX /opt/trc
ENV PATH="/opt/venv/bin:${PATH}" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8099
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8099/healthz', timeout=3).close()"
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/opt/trc/run.sh"]
