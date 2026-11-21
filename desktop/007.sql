CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  cents INTEGER NOT NULL CHECK(cents > 0),
  platform TEXT NOT NULL,
  received_on TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX payments_received ON payments(received_on DESC);
CREATE INDEX payments_client ON payments(client_id, project_id);
PRAGMA user_version = 7;