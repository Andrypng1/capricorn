CREATE TABLE link_thumbnails (
  link_id TEXT PRIMARY KEY REFERENCES links(id) ON DELETE CASCADE,
  jpeg TEXT NOT NULL CHECK(length(jpeg) BETWEEN 8 AND 350000)
);
CREATE TRIGGER reset_link_thumbnail AFTER UPDATE OF url ON links
WHEN OLD.url <> NEW.url
BEGIN
  DELETE FROM link_thumbnails WHERE link_id=NEW.id;
END;
PRAGMA user_version = 3;