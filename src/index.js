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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Échappement pour le texte "courant" (pas encore dans un attribut) :
// on laisse les guillemets droits pour que la syntaxe Markdown ![alt](url "titre") reste détectable.
function escapeText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Échappement pour une valeur insérée dans un attribut HTML (href, src, alt, title...).
function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rendu Markdown → HTML minimal, sans dépendance externe.
// Supporte : titres, gras/italique, code inline/bloc, liens, IMAGES (![alt](url)),
// listes à puces/numérotées, citations, séparateurs, paragraphes.
function markdownToHtml(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let inList = null; // 'ul' | 'ol' | null
  let inCodeBlock = false;
  let codeBuffer = [];
  let paragraphBuffer = [];

  function inlineFmt(text) {
    let t = escapeText(text);
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, alt, src, title) => `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${title ? ` title="${escapeAttr(title)}"` : ''} loading="lazy" />`);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, txt, href, title) => `<a href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ''} target="_blank" rel="noopener">${txt}</a>`);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
    t = t.replace(/\*([^*]+)\*|_([^_]+)_/g, (_, a, b) => `<em>${a || b}</em>`);
    return t;
  }
  function flushParagraph() {
    if (paragraphBuffer.length) {
      html += `<p>${inlineFmt(paragraphBuffer.join(' '))}</p>\n`;
      paragraphBuffer = [];
    }
  }
  function closeList() {
    if (inList) { html += `</${inList}>\n`; inList = null; }
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>\n`;
        codeBuffer = []; inCodeBlock = false;
      } else {
        flushParagraph(); closeList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { codeBuffer.push(raw); continue; }

    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(); closeList();
      const level = h[1].length;
      html += `<h${level}>${inlineFmt(h[2])}</h${level}>\n`;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph(); closeList();
      html += '<hr />\n';
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushParagraph(); closeList();
      html += `<blockquote>${inlineFmt(bq[1])}</blockquote>\n`;
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (inList !== 'ul') { closeList(); html += '<ul>\n'; inList = 'ul'; }
      html += `<li>${inlineFmt(ul[1])}</li>\n`;
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (inList !== 'ol') { closeList(); html += '<ol>\n'; inList = 'ol'; }
      html += `<li>${inlineFmt(ol[1])}</li>\n`;
      continue;
    }

    closeList();
    paragraphBuffer.push(line);
  }
  flushParagraph();
  closeList();
  if (inCodeBlock && codeBuffer.length) {
    html += `<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>\n`;
  }
  return html;
}

app.get('/style.css', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/favicon.ico', (c) => c.env.ASSETS.fetch(c.req.raw));

app.get('/blog', async (c) => {
  const posts = await c.env.DB.prepare(
    'SELECT id, title, slug, excerpt, image_url, created_at FROM posts WHERE status = ? ORDER BY created_at DESC'
  ).bind('published').all();

  const postList = posts.results.map(p => html`
    <article class="post-card">
      ${p.image_url ? html`<a href="/blog/article/${p.slug}"><img class="post-thumb" src="${p.image_url}" alt="${p.title}" loading="lazy" /></a>` : ''}
      <h2><a href="/blog/article/${p.slug}">${p.title}</a></h2>
      <time datetime="${p.created_at}">${new Date(p.created_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
      ${p.excerpt ? html`<p>${p.excerpt}</p>` : ''}
      <a href="/blog/article/${p.slug}" class="read-more">Lire l'article →</a>
    </article>
  `);

  return c.html(layout('Blog', html`
    <script type="application/ld+json">${html([JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'ByEmreh Blog',
      url: 'https://www.byemreh.fr/blog',
      description: 'Conseils, astuces et réflexions sur la création de sites internet pour commerçants et artisans locaux.',
      blogPost: posts.results.map(p => ({
        '@type': 'BlogPosting',
        headline: p.title,
        url: `https://www.byemreh.fr/blog/article/${p.slug}`,
        datePublished: p.created_at,
      })),
    })])}</script>
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
  `, {
    description: 'Conseils, astuces et réflexions sur la création de sites internet pour commerçants et artisans locaux, par ByEmreh.',
    path: '',
  }));
});

app.get('/blog/article/:slug', async (c) => {
  const slug = c.req.param('slug');
  const post = await c.env.DB.prepare(
    'SELECT * FROM posts WHERE slug = ? AND status = ?'
  ).bind(slug, 'published').first();

  if (!post) return c.html(notFound(), 404);

  const contentHtml = markdownToHtml(post.content);
  const description = post.excerpt || post.content.replace(/[#*`>_\-\[\]!]/g, '').slice(0, 155).trim() + '…';
  const ogImage = post.image_url || 'https://www.byemreh.fr/og-image.jpg';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description,
    image: ogImage,
    datePublished: post.created_at,
    dateModified: post.updated_at || post.created_at,
    author: { '@type': 'Person', name: 'Aydin Emreh' },
    publisher: { '@type': 'Organization', name: 'ByEmreh' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `https://www.byemreh.fr/blog/article/${post.slug}` },
  });

  return c.html(layout(post.title, html`
    <script type="application/ld+json">${html([jsonLd])}</script>
    <div class="container">
      <article class="article-full">
        <a href="/blog" class="back">← Retour au blog</a>
        <h1>${post.title}</h1>
        <time datetime="${post.created_at}">${new Date(post.created_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
        ${post.image_url ? html`<img class="article-cover" src="${post.image_url}" alt="${post.title}" />` : ''}
        <div class="content">${html([contentHtml])}</div>
        <a href="/blog" class="back" style="display:inline-block;margin-top:2.5rem;">← Retour au blog</a>
      </article>
    </div>
  `, {
    description,
    image: ogImage,
    path: `/article/${post.slug}`,
    type: 'article',
  }));
});

app.get('/blog/sitemap.xml', async (c) => {
  const posts = await c.env.DB.prepare(
    'SELECT slug, updated_at, created_at FROM posts WHERE status = ? ORDER BY created_at DESC'
  ).bind('published').all();

  const urls = [
    `<url><loc>https://www.byemreh.fr/blog</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ...posts.results.map(p => `<url><loc>https://www.byemreh.fr/blog/article/${p.slug}</loc><lastmod>${(p.updated_at || p.created_at).slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`),
  ].join('\n  ');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

app.get('/blog/rss.xml', async (c) => {
  const posts = await c.env.DB.prepare(
    'SELECT title, slug, excerpt, created_at FROM posts WHERE status = ? ORDER BY created_at DESC LIMIT 20'
  ).bind('published').all();

  const items = posts.results.map(p => `
    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>https://www.byemreh.fr/blog/article/${p.slug}</link>
      <guid>https://www.byemreh.fr/blog/article/${p.slug}</guid>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
      <description>${escapeHtml(p.excerpt || '')}</description>
    </item>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>ByEmreh Blog</title>
  <link>https://www.byemreh.fr/blog</link>
  <description>Conseils, astuces et réflexions sur la création de sites internet pour commerçants et artisans locaux.</description>
  <language>fr-FR</language>
  ${items}
</channel>
</rss>`;

  return c.text(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
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
        list.innerHTML = posts.map(p => \`
          <div class="post-row \${p.status}">
            <div>
              <strong>\${p.title}</strong>
              <span class="badge \${p.status}">\${p.status === 'published' ? 'Publié' : 'Brouillon'}</span>
              <small>\${new Date(p.created_at).toLocaleDateString('fr-FR')}</small>
            </div>
            <div class="actions">
              <a href="/admin/edit/\${p.id}" class="btn-small">Modifier</a>
              <button onclick="deletePost(\${p.id})" class="btn-small btn-danger">Supprimer</button>
            </div>
          </div>
        \`).join('');
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
      <input type="text" id="image_url" placeholder="URL de l'image de couverture (optionnel)" />
      <textarea id="content" placeholder="Contenu en Markdown... (ex: ![description](https://.../photo.jpg) pour insérer une image)"></textarea>
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
        const image_url = document.getElementById('image_url').value.trim();
        if (!title || !content) { document.getElementById('msg').textContent = 'Titre et contenu requis.'; return; }
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + password },
          body: JSON.stringify({ title, content, excerpt, image_url, status })
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
      <input type="text" id="image_url" placeholder="URL de l'image de couverture (optionnel)" value="${post.image_url || ''}" />
      <textarea id="content" placeholder="Contenu en Markdown... (ex: ![description](https://.../photo.jpg) pour insérer une image)">${post.content}</textarea>
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
        const image_url = document.getElementById('image_url').value.trim();
        if (!title || !content) { document.getElementById('msg').textContent = 'Titre et contenu requis.'; return; }
        const res = await fetch('/api/posts/' + postId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + password },
          body: JSON.stringify({ title, content, excerpt, image_url, status })
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
  const { title, content, excerpt, image_url, status } = await c.req.json();
  const slug = slugify(title) + '-' + Date.now().toString(36);
  await c.env.DB.prepare(
    'INSERT INTO posts (title, slug, content, excerpt, image_url, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(title, slug, content, excerpt || null, image_url || null, status || 'draft').run();
  return c.json({ success: true });
});

app.put('/api/posts/:id', checkAuth, async (c) => {
  const id = c.req.param('id');
  const { title, content, excerpt, image_url, status } = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE posts SET title = ?, content = ?, excerpt = ?, image_url = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(title, content, excerpt || null, image_url || null, status || 'draft', id).run();
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
  `, { noindex: true });
}

function layout(title, content, opts = {}) {
  const {
    description = "Conseils, astuces et réflexions sur la création de sites internet pour commerçants et artisans locaux, par ByEmreh.",
    image = 'https://www.byemreh.fr/og-image.jpg',
    path = '',
    type = 'website',
    noindex = false,
  } = opts;
  const canonicalUrl = `https://www.byemreh.fr/blog${path}`;

  return html`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0B0C10">
  <title>${title} — ByEmreh Blog</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}">
  <link rel="canonical" href="${canonicalUrl}">

  <meta property="og:type" content="${type}">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:site_name" content="ByEmreh Blog">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">

  <link rel="alternate" type="application/rss+xml" title="ByEmreh Blog" href="https://www.byemreh.fr/blog/rss.xml">

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
