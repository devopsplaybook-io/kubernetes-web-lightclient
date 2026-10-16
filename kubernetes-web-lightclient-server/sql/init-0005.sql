-- Per-user list triage preferences (sort + quick filters), keyed by resource
-- type id and stored as a JSON object; NULL means no preferences stored yet
ALTER TABLE users_resource_selections ADD COLUMN listPreferences TEXT;
