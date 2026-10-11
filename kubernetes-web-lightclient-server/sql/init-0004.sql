-- User resource selections: one row per user; selectedIds stored as a JSON array
CREATE TABLE IF NOT EXISTS users_resource_selections (
    userId VARCHAR(50) NOT NULL,
    selectedIds TEXT NOT NULL,
    dateCreated VARCHAR(50) NOT NULL,
    dateUpdated VARCHAR(50) NOT NULL,
    PRIMARY KEY (userId)
);
