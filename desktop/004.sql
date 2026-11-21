ALTER TABLE deliveries ADD COLUMN updated_at TEXT;
ALTER TABLE deliveries ADD COLUMN archived_at TEXT;
ALTER TABLE revisions ADD COLUMN updated_at TEXT;
ALTER TABLE revisions ADD COLUMN archived_at TEXT;
UPDATE projects SET currency='USD' WHERE currency IS NOT NULL OR price IS NOT NULL;
PRAGMA user_version = 4;