CREATE TABLE workflow_records (
    area text NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    observed_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (area, source, external_id)
);

CREATE TABLE workflow_requests (
    idempotency_key uuid PRIMARY KEY,
    fingerprint text NOT NULL,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
