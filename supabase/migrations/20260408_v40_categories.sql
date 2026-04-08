-- V4.0: Add categories (folders) for organizing knowledge maps

-- 1. Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '新文件夹',
  icon TEXT NOT NULL DEFAULT '📁',
  color TEXT NOT NULL DEFAULT '#22d3a7',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add category_id to maps table
ALTER TABLE maps ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;

-- 3. Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- 4. Create policies (allow all reads/writes - adjust for auth later)
CREATE POLICY "Allow all on categories" ON categories FOR ALL USING (true) WITH CHECK (true);

-- 5. Update maps policy to allow setting category_id
-- (Assuming existing policy covers this; if not, add one)

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_maps_category_id ON maps(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
