FROM qdrant/qdrant:v1.18.0 AS vector_store
FROM postgres:18-trixie
LABEL org.opencontainers.image.source="https://github.com/firebreakHD/TRC-AI" \
      org.opencontainers.image.version="0.2.0"
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv supervisor tini libunwind8 libgomp1 poppler-utils \
       tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home trc \
    && useradd --system --no-create-home qdrant
WORKDIR /opt/trc
RUN --mount=type=bind,source=.,target=/tmp/backend \
    --mount=type=bind,from=vector_store,source=/qdrant,target=/tmp/vector_store \
    --mount=type=secret,id=pip_ca,target=/run/secrets/pip_ca \
    if [ -f /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes --only-binary=:all: -r /tmp/backend/requirements.lock \
    && install -m 755 /tmp/vector_store/qdrant /usr/local/bin/qdrant \
    && install -Dm644 /tmp/vector_store/qdrant.spdx.json /usr/share/doc/qdrant/qdrant.spdx.json \
    && install -m 644 /tmp/backend/qdrant.LICENSE /usr/share/doc/qdrant/LICENSE \
    && cp -R /tmp/backend/trc /tmp/backend/migrations /opt/trc/ \
    && install -m 644 /tmp/backend/supervisord.conf /tmp/backend/qdrant.yaml /tmp/backend/run.sh /opt/trc/ \
    && chmod -R a+rX /opt/trc \
    && qdrant --version
ENV PATH="/opt/venv/bin:${PATH}" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8099
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8099/healthz', timeout=3).close()"
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/opt/trc/run.sh"]
