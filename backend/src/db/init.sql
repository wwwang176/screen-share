CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    meeting_code VARCHAR(12) UNIQUE NOT NULL,
    title VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Schema migrations: add columns that may not exist yet
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS host_token VARCHAR(32);
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS cf_live_input_uid VARCHAR(255);
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS whip_url TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS whep_url TEXT;
