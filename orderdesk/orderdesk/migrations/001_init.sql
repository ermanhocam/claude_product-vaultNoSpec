CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'customer',
  archived    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE orders (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL,
  country      TEXT,
  total_cents  INTEGER NOT NULL,
  created_at   TIMESTAMP NOT NULL
);
