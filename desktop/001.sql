CREATE TABLE clients (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, notes TEXT, color TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), archived_at TEXT
);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), title TEXT NOT NULL, type TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('received','editing','review','changes_requested','approved','delivered','archived')),
 due_date TEXT, local_folder TEXT, price REAL, currency TEXT, payment_status TEXT NOT NULL DEFAULT 'pending', notes TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), archived_at TEXT
);
CREATE INDEX projects_client ON projects(client_id);
CREATE TABLE links (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 kind TEXT NOT NULL CHECK(kind IN ('material','delivery','revision','reference')), title TEXT NOT NULL,
 url TEXT NOT NULL, service TEXT NOT NULL, password_ref TEXT, expires_at TEXT,
 download_status TEXT NOT NULL CHECK(download_status IN ('pending','downloaded','archived')),
 local_path TEXT, last_checked_at TEXT, health TEXT NOT NULL DEFAULT 'unknown', notes TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), archived_at TEXT
);
CREATE INDEX links_project ON links(project_id);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;