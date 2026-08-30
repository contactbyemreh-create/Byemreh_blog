import { Hono } from 'hono';
import { html } from 'hono/html';

const app = new Hono();

// Servir le site vitrine (public/) pour tout sauf /blog, /admin, /api
app.get('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/' || path.startsWith('/blog') || path.startsWith('/admin') || path.startsWith('/api')) {
    return next();
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

function checkAuth(c, next) {
  const auth = c.req.header('Authorization');
  if (!auth || auth !== `Bearer ${c.env.ADMIN_PASSWORD}`) {
    return c.json({ error: 'Non autorisé' }, 401);
  }
  return next();
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

app.get('/style.css', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/favicon.ico', (c) => c.env.ASSETS.fetch(c.req.raw));

app.get('/blog', async (c) => {
  const posts = await c.env.DB.prepare(
    'SELECT id, title, slug, excerpt, created_at FROM posts WHERE status = ? ORDER BY created_at DESC'
  ).bind('published').all();

  const postList = posts.results.map(p => html`
    <article class="post-card">
      <h2><a href="/blog/article/${p.slug}">${p.title}</a></h2>
      <time datetime="${p.created_at}">${new Date(p.created_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
      ${p.excerpt ? html`<p>${p.excerpt}</p>` : ''}
      <a href="/blog/article/${p.slug}" class="read-more">Lire l'article →</a>
    </article>
  `);

  return c.html(layout('Blog', html`
    <section class="hero">
      <div class="hero-mesh"><span></span><span></span><span></span></div>
      <div class="hero-content">
        <div class="hero-badge">ByEmreh Blog · Un article par semaine</div>
        <h1>Le <em>blog</em> de ByEmreh</h1>
        <p class="hero-sub">Conseils, astuces et réflexions sur la création de sites internet pour commerçants et artisans locaux.</p>
      </div>
    </section>
    <div class="container">
      <div class="section-label">Derniers articles</div>
      <div class="posts">
        ${postList.length > 0 ? postList : html`<p class="empty">Aucun article publié pour le moment. Revenez bientôt !</p>`}
      </div>
    </div>
  `));
});

app.get('/blog/article/:slug', async (c) => {
  const slug = c.req.param('slug');
  const post = await c.env.DB.prepare(
    'SELECT * FROM posts WHERE slug = ? AND status = ?'
  ).bind(slug, 'published').first();

  if (!post) return c.html(notFound(), 404);

  return c.html(layout(post.title, html`
    <div class="container">
      <article class="article-full">
        <a href="/blog" class="back">← Retour au blog</a>
        <h1>${post.title}</h1>
        <time datetime="${post.created_at}">${new Date(post.created_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
        <div class="content">${html([post.content])}</div>
        <a href="/blog" class="back" style="display:inline-block;margin-top:2.5rem;">← Retour au blog</a>
      </article>
    </div>
  `));
});

app.get('/admin', (c) => {
  return c.html(adminLayout('Administration', html`
    <div class="login-box">
      <h1>🔐 Administration</h1>
      <p>Connectez-vous pour gérer vos articles.</p>
      <form id="login-form">
        <input type="password" id="password" placeholder="Mot de passe" required />
        <button type="submit">Se connecter</button>
      </form>
      <p id="login-error" class="error-msg"></p>
    </div>
    <script>
      const password = sessionStorage.getItem('admin_password') || '';
      if (password) { window.location.href = '/admin/dashboard'; }

      document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('password').value;
        const res = await fetch('/api/posts', { headers: { Authorization: 'Bearer ' + pwd } });
        if (res.ok) {
          sessionStorage.setItem('admin_password', pwd);
          window.location.href = '/admin/dashboard';
        } else {
          document.getElementById('login-error').textContent = 'Mot de passe incorrect.';
        }
      });
    </script>
  `));
});

app.get('/admin/dashboard', (c) => {
  return c.html(adminLayout('Dashboard', html`
    <div id="dashboard">
      <div class="dash-header">
        <h1>Mes articles</h1>
        <a href="/admin/new" class="btn-primary">+ Nouvel article</a>
      </div>
      <div id="posts-list"><p class="empty">Chargement...</p></div>
      <a href="/blog" class="back" style="display:inline-block;margin-top:2rem;">← Voir le blog</a>
      <button id="logout" class="btn-logout">Déconnexion</button>
    </div>
    <script>
      const password = sessionStorage.getItem('admin_password');
      if (!password) { window.location.href = '/admin'; }

      async function loadPosts() {
        const res = await fetch('/api/posts', { headers: { Authorization: 'Bearer ' + password } });
        const posts = await res.json();
        const list = document.getElementById('posts-list');
        if (posts.length === 0) {
          list.innerHTML = '<p class="empty">Aucun article. Créez-en un !</p>';
          return;
        }
        list.innerHTML = posts.map(p => `
          <div class="post-row ${p.status}">
            <div>
              <strong>${p.title}</strong>
              <span class="badge ${p.status}">${p.status === 'published' ? 'Publié' : 'Brouillon'}</span>
              <small>${new Date(p.created_at).toLocaleDateString('fr-FR')}</small>
            </div>
            <div class="actions">
              <a href="/admin/edit/${p.id}" class="btn-small">Modifier</a>
              <button onclick="deletePost(${p.id})" class="btn-small btn-danger">Supprimer</button>
            </div>
          </div>
        `).join('');
      }

      async function deletePost(id) {
        if (!confirm('Supprimer cet article ?')) return;
        await fetch('/api/posts/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + password } });
        loadPosts();
      }

      document.getElementById('logout').addEventListener('click', () => {
        sessionStorage.removeItem('admin_password');
        window.location.href = '/admin';
      });

      loadPosts();
    </script>
  `));
});

app.get('/admin/new', (c) => {
  return c.html(adminLayout('Nouvel article', html`
    <div id="editor">
      <a href="/admin/dashboard" class="back">← Retour</a>
      <h1>Nouvel article</h1>
      <input type="text" id="title" placeholder="Titre de l'article" />
      <textarea id="content" placeholder="Contenu en Markdown..."></textarea>
      <input type="text" id="excerpt" placeholder="Résumé court (optionnel)" />
      <div class="editor-actions">
        <button onclick="save('draft')" class="btn-secondary">Sauver en brouillon</button>
        <button onclick="save('published')" class="btn-primary">Publier</button>
      </div>
      <p id="msg" class="error-msg"></p>
    </div>
    <script>
      const password = sessionStorage.getItem('admin_password');
      if (!password) { window.location.href = '/admin'; }

      async function save(status) {
        const title = document.getElementById('title').value.trim();
        const content = document.getElementById('content').value.trim();
        const excerpt = document.getElementById('excerpt').value.trim();
        if (!title || !content) { document.getElementById('msg').textContent = 'Titre et contenu requis.'; return; }
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + password },
          body: JSON.stringify({ title, content, excerpt, status })
        });
        if (res.ok) { window.location.href = '/admin/dashboard'; }
        else { document.getElementById('msg').textContent = 'Erreur lors de la sauvegarde.'; }
      }
    </script>
  `));
});

app.get('/admin/edit/:id', async (c) => {
  const id = c.req.param('id');
  const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!post) return c.html(notFound(), 404);

  return c.html(adminLayout('Modifier', html`
    <div id="editor">
      <a href="/admin/dashboard" class="back">← Retour</a>
      <h1>Modifier l'article</h1>
      <input type="text" id="title" value="${post.title}" />
      <textarea id="content">${post.content}</textarea>
      <input type="text" id="excerpt" value="${post.excerpt || ''}" />
      <div class="editor-actions">
        <button onclick="save('draft')" class="btn-secondary">Sauver en brouillon</button>
        <button onclick="save('published')" class="btn-primary">Publier</button>
      </div>
      <p id="msg" class="error-msg"></p>
    </div>
    <script>
      const password = sessionStorage.getItem('admin_password');
      if (!password) { window.location.href = '/admin'; }
      const postId = ${post.id};

      async function save(status) {
        const title = document.getElementById('title').value.trim();
        const content = document.getElementById('content').value.trim();
        const excerpt = document.getElementById('excerpt').value.trim();
        if (!title || !content) { document.getElementById('msg').textContent = 'Titre et contenu requis.'; return; }
        const res = await fetch('/api/posts/' + postId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + password },
          body: JSON.stringify({ title, content, excerpt, status })
        });
        if (res.ok) { window.location.href = '/admin/dashboard'; }
        else { document.getElementById('msg').textContent = 'Erreur lors de la sauvegarde.'; }
      }
    </script>
  `));
});

app.get('/api/posts', checkAuth, async (c) => {
  const posts = await c.env.DB.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
  return c.json(posts.results);
});

app.post('/api/posts', checkAuth, async (c) => {
  const { title, content, excerpt, status } = await c.req.json();
  const slug = slugify(title) + '-' + Date.now().toString(36);
  await c.env.DB.prepare(
    'INSERT INTO posts (title, slug, content, excerpt, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(title, slug, content, excerpt || null, status || 'draft').run();
  return c.json({ success: true });
});

app.put('/api/posts/:id', checkAuth, async (c) => {
  const id = c.req.param('id');
  const { title, content, excerpt, status } = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE posts SET title = ?, content = ?, excerpt = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(title, content, excerpt || null, status || 'draft', id).run();
  return c.json({ success: true });
});

app.delete('/api/posts/:id', checkAuth, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

function notFound() {
  return layout('404', html`
    <div class="container">
      <div class="not-found">
        <h1>404</h1>
        <p>Page introuvable</p>
        <a href="/blog">← Retour à l'accueil</a>
      </div>
    </div>
  `);
}

function layout(title, content) {
  return html`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0B0C10">
  <title>${title} — ByEmreh Blog</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <nav>
    <a href="/" class="nav-brand">By<span>Emreh</span></a>
    <div class="nav-actions">
      <a href="https://www.byemreh.fr" class="nav-cta">Retour au site →</a>
    </div>
  </nav>
  <main>${content}</main>
  <footer>
    <p><strong>ByEmreh</strong> — Blog · Un article par semaine</p>
    <p style="margin-top:.6rem;font-size:.8rem;">
      <a href="https://www.byemreh.fr">byemreh.fr</a>
    </p>
    <p style="margin-top:.4rem">© ${new Date().getFullYear()} · Tous droits réservés</p>
  </footer>
</body>
</html>`;
}

function adminLayout(title, content) {
  return html`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0B0C10">
  <title>${title} — Admin ByEmreh</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body class="admin-body">
  <nav>
    <a href="/" class="nav-brand">By<span>Emreh</span></a>
    <div class="nav-actions">
      <a href="/admin/dashboard" class="nav-cta" style="background:var(--signal);">Dashboard</a>
    </div>
  </nav>
  <main class="admin-container" style="padding-top:6rem;">${content}</main>
</body>
</html>`;
}

export default app;
