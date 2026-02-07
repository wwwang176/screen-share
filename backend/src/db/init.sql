CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    meeting_code VARCHAR(12) UNIQUE NOT NULL,
    title VARCHAR(255),
    cf_live_input_uid VARCHAR(255),
    whip_url TEXT,
    whep_url TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
