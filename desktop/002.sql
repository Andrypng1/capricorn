CREATE TABLE deliveries (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL,
 link_id TEXT REFERENCES links(id), delivered_at TEXT NOT NULL, notes TEXT,
 UNIQUE(project_id, version)
);
CREATE TABLE revisions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), delivery_id TEXT REFERENCES deliveries(id),
 text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
 created_at TEXT NOT NULL, done_at TEXT
);
CREATE INDEX revisions_project ON revisions(project_id);
CREATE INDEX links_expiration ON links(expires_at, download_status);
PRAGMA user_version = 2;