CREATE TABLE client_socials (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(client_id, url)
);
PRAGMA user_version = 5;