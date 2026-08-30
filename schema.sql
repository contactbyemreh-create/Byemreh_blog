CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  excerpt TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);

INSERT INTO posts (title, slug, content, excerpt, status) VALUES (
  'Bienvenue sur ByEmreh Blog',
  'bienvenue-sur-byemreh-blog',
  '# Bienvenue !

Ceci est votre premier article. Vous pouvez le modifier ou le supprimer depuis l''espace d''administration.

Connectez-vous sur **/admin** pour gérer vos articles.',
  'Votre premier article sur ByEmreh Blog.',
  'published'
);
