-- SQLite schema dla Autopilot.
-- Zero zewnętrznych baz danych. Wszystkie historyczne dane lokalnie.

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_changed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary TEXT,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS run_log_module ON run_log(module, started_at DESC);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pl',
  source TEXT NOT NULL,
  parent_keyword TEXT,
  captured_at TEXT NOT NULL,
  UNIQUE(keyword, language, source)
);

CREATE INDEX IF NOT EXISTS keywords_keyword ON keywords(keyword);

CREATE TABLE IF NOT EXISTS ranks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pl',
  domain TEXT NOT NULL,
  position INTEGER,
  url TEXT,
  engine TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ranks_keyword_date ON ranks(keyword, captured_at DESC);
CREATE INDEX IF NOT EXISTS ranks_domain ON ranks(domain, captured_at DESC);

CREATE TABLE IF NOT EXISTS backlinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_text TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source TEXT NOT NULL,
  UNIQUE(source_url, target_url)
);

CREATE INDEX IF NOT EXISTS backlinks_target ON backlinks(target_url);
CREATE INDEX IF NOT EXISTS backlinks_source_domain ON backlinks(source_domain);

CREATE TABLE IF NOT EXISTS alt_texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_src TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  page_url TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  UNIQUE(image_src)
);

CREATE TABLE IF NOT EXISTS broken_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  found_on_page TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  fixed_at TEXT
);

CREATE INDEX IF NOT EXISTS broken_links_status ON broken_links(status, fixed_at);

CREATE TABLE IF NOT EXISTS vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  strategy TEXT NOT NULL,
  lcp REAL,
  cls REAL,
  inp REAL,
  ttfb REAL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS vitals_url_date ON vitals(url, captured_at DESC);

CREATE TABLE IF NOT EXISTS gsc_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT NOT NULL,
  query TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(page, query, date)
);

CREATE INDEX IF NOT EXISTS gsc_page ON gsc_data(page, date DESC);

CREATE TABLE IF NOT EXISTS refresh_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  age_days INTEGER NOT NULL,
  suggestion TEXT NOT NULL,
  suggested_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS internal_link_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_page TEXT NOT NULL,
  to_page TEXT NOT NULL,
  similarity REAL NOT NULL,
  proposed_anchor TEXT NOT NULL,
  suggested_at TEXT NOT NULL,
  applied_at TEXT,
  UNIQUE(from_page, to_page)
);

CREATE TABLE IF NOT EXISTS competitor_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  word_count INTEGER,
  schema_types_json TEXT,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS competitor_pages_domain ON competitor_pages(domain, captured_at DESC);

CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  embedding BLOB NOT NULL,
  text_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS index_now_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  engine TEXT NOT NULL,
  status INTEGER,
  pushed_at TEXT NOT NULL
);
