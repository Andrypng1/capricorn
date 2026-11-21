CREATE TABLE client_avatars (
  client_id TEXT PRIMARY KEY REFERENCES clients(id),
  jpeg TEXT NOT NULL CHECK(length(jpeg) BETWEEN 8 AND 350000),
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 6;