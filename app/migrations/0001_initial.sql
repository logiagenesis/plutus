-- Plutus — initial schema (Cloudflare D1 / SQLite).
-- Money: integer cents. Quantities, discount % and tax rates: exact decimal strings.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  registered_name TEXT,
  registration_number TEXT,
  vat_number TEXT,
  email TEXT,
  telephone TEXT,
  address_json TEXT,
  default_message TEXT,
  set_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  sage_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  contact_name TEXT,
  email TEXT,
  telephone TEXT,
  mobile TEXT,
  vat_number TEXT,
  postal_address_json TEXT,
  delivery_address_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sage_balance_cents INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX customers_company ON customers(company_id, name);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  sage_id INTEGER UNIQUE,
  code TEXT,
  description TEXT NOT NULL,
  category TEXT,
  unit TEXT,
  price_excl_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_excl_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX items_company ON items(company_id, description);

-- Invoices, quotes and credit notes. Drafts have no number; a number is assigned when issued.
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('invoice','quote','credit_note')),
  number TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','issued','void')),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  customer_snapshot_json TEXT,
  date TEXT NOT NULL,
  due_date TEXT,
  reference TEXT,
  message TEXT,
  vat_rate TEXT NOT NULL DEFAULT '0',
  discount_cents INTEGER NOT NULL DEFAULT 0,
  exclusive_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  from_document_id INTEGER REFERENCES documents(id),
  from_number TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','sage')),
  sage_id INTEGER UNIQUE,
  sage_status TEXT,
  sage_amount_due_cents INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  issued_at TEXT,
  create_token TEXT UNIQUE,
  CHECK ((status = 'draft' AND number IS NULL) OR (status <> 'draft' AND number IS NOT NULL))
);
CREATE UNIQUE INDEX documents_number ON documents(company_id, kind, number) WHERE number IS NOT NULL;
CREATE INDEX documents_list ON documents(company_id, kind, date DESC);
CREATE INDEX documents_customer ON documents(customer_id, date DESC);

CREATE TABLE document_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  description TEXT NOT NULL,
  comments TEXT,
  unit TEXT,
  quantity TEXT NOT NULL,
  unit_price_excl_cents INTEGER NOT NULL,
  discount_percent TEXT NOT NULL DEFAULT '0',
  tax_rate TEXT NOT NULL DEFAULT '0',
  exclusive_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  UNIQUE (document_id, line_no)
);

CREATE TABLE recurring_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  sage_id INTEGER UNIQUE,
  sage_number TEXT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','annually')),
  start_date TEXT NOT NULL,
  last_run_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  reference TEXT,
  message TEXT,
  exclusive_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE recurring_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  description TEXT NOT NULL,
  comments TEXT,
  unit TEXT,
  quantity TEXT NOT NULL,
  unit_price_excl_cents INTEGER NOT NULL,
  discount_percent TEXT NOT NULL DEFAULT '0',
  tax_rate TEXT NOT NULL DEFAULT '0',
  exclusive_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  UNIQUE (template_id, line_no)
);

CREATE TABLE number_sequences (
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL,
  prefix TEXT NOT NULL,
  width INTEGER NOT NULL,
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  PRIMARY KEY (company_id, kind)
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail_json TEXT
);
CREATE INDEX audit_entity ON audit_events(entity, entity_id);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  counts_json TEXT
);

INSERT INTO companies (id, display_name, set_up) VALUES ('logia-services', 'Logia Services (Pty) Ltd', 1), ('logi-ink', 'Logi-Ink (Pty) Ltd', 0);
INSERT INTO number_sequences (company_id, kind, prefix, width, next_value) VALUES
  ('logia-services','invoice','INV',8,1), ('logia-services','quote','QUO',6,1), ('logia-services','credit_note','CRN',7,1),
  ('logi-ink','invoice','INV',6,1), ('logi-ink','quote','QUO',6,1), ('logi-ink','credit_note','CRN',6,1);
