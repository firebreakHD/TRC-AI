CREATE TABLE rag_index (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    model text NOT NULL, dimensions integer NOT NULL CHECK (dimensions > 0),
    collection text NOT NULL
);
CREATE TABLE rag_documents (
    path text PRIMARY KEY,
    digest varchar(64) NOT NULL,
    indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rag_jobs (
    path text PRIMARY KEY,
    digest varchar(64) NOT NULL,
    state text NOT NULL CHECK (state IN ('pending','running','done','failed')),
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    lease_token uuid,
    error_code text
);
CREATE INDEX rag_jobs_available ON rag_jobs (available_at, path)
    WHERE state IN ('pending','running');
CREATE TABLE rag_chunks (
    id uuid PRIMARY KEY,
    path text NOT NULL REFERENCES rag_documents(path) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    body text NOT NULL,
    meta jsonb NOT NULL,
    embedding real[] NOT NULL,
    terms tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(meta->>'heading', '')), 'A')
        || setweight(to_tsvector('simple', body), 'B')
    ) STORED,
    UNIQUE (path, ordinal)
);
CREATE INDEX rag_chunks_terms ON rag_chunks USING gin (terms);

CREATE TABLE rag_worker (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    heartbeat timestamptz NOT NULL DEFAULT now(),
    phase text NOT NULL,
    paused boolean NOT NULL DEFAULT false,
    repair_requested boolean NOT NULL DEFAULT false,
    detail text
);

CREATE INDEX workflow_records_read_idx
    ON workflow_records (area, observed_at DESC, source DESC, external_id DESC);
