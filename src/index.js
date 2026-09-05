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

const SITE_STYLES = html`
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --ink:        #0B0C10;
    --ink-soft:   #15161C;
    --ink-line:   #24252D;
    --paper:      #F6F4EE;
    --paper-dim:  #EDEAE0;
    --signal:     #0E7C66;
    --signal-lt:  #E1F3EE;
    --signal-brt: #3ECFAE;
    --coral:      #FF6B4A;
    --coral-lt:   #FFE8E1;
    --gold:       #C9A227;
    --gold-lt:    #F3E3A8;
    --gold-dk:    #8A6C15;
    --muted:      #6B6A74;
    --muted-dk:   #9694A6;
    --border:     #E3DFD3;
    --code-bg:    #101116;
    --code-line:  #1B1C23;
    --ease: cubic-bezier(.16,1,.3,1);
    --ff-disp: 'Fraunces', Georgia, serif;
    --ff-body: 'Plus Jakarta Sans', system-ui, sans-serif;
    --ff-mono: 'JetBrains Mono', 'SF Mono', monospace;
  }
  html { scroll-behavior: smooth; }
  body {
    background: var(--paper); color: var(--ink); font-family: var(--ff-body);
    font-weight: 400; line-height: 1.7; -webkit-tap-highlight-color: transparent;
  }
  ::selection { background: var(--signal); color: #fff; }
  a { color: inherit; }
  em { font-style: italic; color: var(--signal); }

  a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
    outline: 2px solid var(--signal); outline-offset: 3px; border-radius: 4px;
  }

  /* ── NAV ── */
  nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(246,244,238,.82); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%);
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
    padding: 1rem 2rem;
  }
  .nav-brand { font-family: var(--ff-mono); font-weight: 700; font-size: 1rem; color: var(--ink); text-decoration: none; }
  .nav-brand span { color: var(--signal); }
  .nav-actions { display: flex; align-items: center; gap: .7rem; }
  .nav-cta {
    background: var(--signal); color: #fff; border: none; padding: .65rem 1.4rem; font-family: var(--ff-body);
    font-size: .82rem; font-weight: 600; border-radius: 99px; text-decoration: none; transition: background .25s var(--ease), transform .2s;
  }
  .nav-cta:hover { background: #0A6353; transform: translateY(-1px); }

  /* ── HERO (page blog) ── */
  .hero { position: relative; padding: 5.5rem 2rem 4rem; overflow: hidden; text-align: center; }
  .hero-mesh { position: absolute; inset: -20% -10%; z-index: 0; pointer-events: none; filter: blur(70px); opacity: .35; }
  .hero-mesh span { position: absolute; border-radius: 50%; }
  .hero-mesh span:nth-child(1) { width: 320px; height: 320px; background: var(--signal); top: -40px; left: 10%; }
  .hero-mesh span:nth-child(2) { width: 280px; height: 280px; background: var(--gold); bottom: -60px; right: 12%; }
  .hero-mesh span:nth-child(3) { width: 220px; height: 220px; background: var(--coral); top: 30%; right: 35%; }
  .hero-content { position: relative; z-index: 1; max-width: 700px; margin: 0 auto; }
  .hero-badge {
    display: inline-flex; align-items: center; gap: .5rem; background: var(--signal-lt); border: 1px solid rgba(14,124,102,.3);
    color: #0A5C4C; font-family: var(--ff-mono); font-size: .72rem; font-weight: 500; padding: .4rem 1rem; border-radius: 99px; margin-bottom: 1.6rem;
  }
  .hero h1 { font-family: var(--ff-disp); font-size: clamp(2rem, 5vw, 3rem); font-weight: 600; line-height: 1.15; color: var(--ink); }
  .hero-sub { margin-top: 1.2rem; font-size: 1.02rem; color: var(--muted); max-width: 52ch; margin-left: auto; margin-right: auto; line-height: 1.7; }

  /* ── LISTE D'ARTICLES ── */
  .container { max-width: 760px; margin: 0 auto; padding: 3rem 2rem 5rem; }
  .section-label { font-family: var(--ff-mono); font-size: .72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--signal); margin-bottom: 1.6rem; }
  .posts { display: flex; flex-direction: column; }
  .post-card { padding: 1.8rem 0; border-bottom: 1px solid var(--border); transition: padding-left .3s var(--ease); }
  .post-card:hover { padding-left: .5rem; }
  .post-thumb { display: block; width: 100%; max-height: 320px; object-fit: cover; border-radius: 14px; margin-bottom: 1.1rem; }
  .post-card h2 { font-family: var(--ff-disp); font-size: 1.4rem; font-weight: 600; margin-bottom: .3rem; }
  .post-card h2 a { color: var(--ink); text-decoration: none; transition: color .2s; }
  .post-card h2 a:hover { color: var(--signal); }
  .post-card time { color: var(--muted-dk); font-size: .82rem; font-family: var(--ff-mono); }
  .post-card p { margin: .7rem 0; color: var(--muted); font-size: .92rem; line-height: 1.7; }
  .read-more { color: var(--signal); font-weight: 600; font-size: .88rem; text-decoration: none; }
  .read-more:hover { text-decoration: underline; }
  .empty { color: var(--muted-dk); text-align: center; padding: 2rem 0; }

  /* ── ARTICLE ── */
  .article-full { max-width: 700px; margin: 0 auto; }
  .back { color: var(--signal); font-size: .88rem; font-weight: 600; text-decoration: none; }
  .back:hover { text-decoration: underline; }
  .article-full h1 { font-family: var(--ff-disp); font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 600; margin: 1rem 0 .5rem; letter-spacing: -.02em; }
  .article-full time { color: var(--muted-dk); font-size: .85rem; font-family: var(--ff-mono); }
  .article-cover { display: block; width: 100%; max-height: 460px; object-fit: cover; border-radius: 16px; margin: 1.4rem 0 1.6rem; }
  .content { margin-top: 2rem; font-size: 1.02rem; line-height: 1.85; color: #33323C; }
  .content h1, .content h2, .content h3 { font-family: var(--ff-disp); font-weight: 600; color: var(--ink); margin: 2rem 0 .8rem; }
  .content h2 { font-size: 1.5rem; }
  .content h3 { font-size: 1.2rem; }
  .content p { margin-bottom: 1.2rem; }
  .content a { color: var(--signal); }
  .content img { max-width: 100%; border-radius: 12px; margin: 1.2rem 0; }
  .content ul, .content ol { margin: 0 0 1.2rem 1.4rem; }
  .content li { margin-bottom: .5rem; }
  .content blockquote { border-left: 3px solid var(--signal); padding-left: 1.2rem; color: var(--muted); font-style: italic; margin: 1.4rem 0; }
  .content code { background: var(--paper-dim); padding: .15rem .4rem; border-radius: 4px; font-family: var(--ff-mono); font-size: .88em; }
  .content pre { background: var(--code-bg); color: #D8D6E3; padding: 1.2rem; border-radius: 10px; overflow-x: auto; margin: 1.4rem 0; }
  .content pre code { background: none; padding: 0; color: inherit; }
  .content hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  /* ── FOOTER ── */
  footer { background: var(--paper-dim); color: var(--muted-dk); text-align: center; padding: 2.5rem; font-size: .82rem; border-top: 1px solid var(--border); }
  footer strong { color: var(--ink); font-family: var(--ff-mono); }
  footer a { color: var(--muted); text-decoration: underline; }
  footer a:hover { color: var(--signal); }

  .not-found { text-align: center; padding: 4rem 0; }
  .not-found h1 { font-family: var(--ff-disp); font-size: 4rem; color: var(--signal); }
  .not-found p { color: var(--muted); margin: 1rem 0 1.6rem; }

  /* ── ADMIN ── */
  .admin-body { background: var(--ink); color: #fff; min-height: 100vh; }
  .admin-body nav { background: rgba(11,12,16,.85); border-bottom: 1px solid var(--ink-line); }
  .admin-body .nav-brand { color: #fff; }
  .admin-container { max-width: 640px; margin: 0 auto; padding: 0 2rem 4rem; }

  .login-box { max-width: 380px; margin: 4rem auto 0; text-align: center; }
  .login-box h1 { font-family: var(--ff-disp); font-size: 1.8rem; margin-bottom: .6rem; }
  .login-box p { color: var(--muted-dk); margin-bottom: 1.8rem; }
  #login-form { display: flex; flex-direction: column; gap: 1rem; }
  input[type="password"], input[type="text"], textarea {
    width: 100%; background: var(--ink-soft); border: 1px solid var(--ink-line); border-radius: 8px; padding: .85rem 1rem;
    color: #fff; font-family: var(--ff-body); font-size: .92rem; outline: none; transition: border-color .2s;
  }
  input[type="password"]:focus, input[type="text"]:focus, textarea:focus { border-color: var(--signal); }
  textarea { min-height: 260px; resize: vertical; font-family: var(--ff-mono); font-size: .88rem; line-height: 1.6; }
  button[type="submit"], .btn-primary, .btn-secondary {
    display: inline-block; text-align: center; padding: .85rem 1.4rem; border-radius: 8px; font-weight: 700; font-size: .88rem;
    border: none; cursor: pointer; text-decoration: none; font-family: var(--ff-body); transition: background .25s var(--ease), transform .2s;
  }
  button[type="submit"], .btn-primary { background: var(--signal); color: #fff; }
  button[type="submit"]:hover, .btn-primary:hover { background: #0A6353; transform: translateY(-1px); }
  .btn-secondary { background: var(--ink-soft); color: #fff; border: 1px solid var(--ink-line); }
  .btn-secondary:hover { border-color: var(--signal); }
  .error-msg { color: #FF8266; font-size: .85rem; margin-top: 1rem; min-height: 1.2em; }

  #dashboard { padding-top: 1rem; }
  .dash-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
  .dash-header h1 { font-family: var(--ff-disp); font-size: 1.8rem; }
  .post-row {
    display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;
    padding: 1.2rem 0; border-bottom: 1px solid var(--ink-line);
  }
  .post-row strong { display: block; margin-bottom: .3rem; }
  .badge { display: inline-block; font-family: var(--ff-mono); font-size: .68rem; font-weight: 700; text-transform: uppercase; padding: .2rem .6rem; border-radius: 99px; margin-right: .6rem; }
  .badge.published { background: rgba(62,207,174,.18); color: var(--signal-brt); }
  .badge.draft { background: rgba(201,162,39,.18); color: var(--gold-lt); }
  .post-row small { color: var(--muted-dk); font-family: var(--ff-mono); font-size: .76rem; }
  .actions { display: flex; gap: .6rem; }
  .btn-small { font-family: var(--ff-body); font-size: .8rem; font-weight: 600; padding: .5rem 1rem; border-radius: 6px; border: none; cursor: pointer; text-decoration: none; }
  .btn-small { background: var(--ink-soft); color: #fff; border: 1px solid var(--ink-line); }
  .btn-small:hover { border-color: var(--signal); }
  .btn-small.btn-danger { color: #FF8266; }
  .btn-small.btn-danger:hover { border-color: #FF8266; }
  .btn-logout { background: none; border: 1px solid var(--ink-line); color: var(--muted-dk); padding: .6rem 1.2rem; border-radius: 8px; font-size: .82rem; cursor: pointer; float: right; }
  .btn-logout:hover { border-color: var(--coral); color: var(--coral); }

  #editor h1 { font-family: var(--ff-disp); font-size: 1.8rem; margin: 1rem 0 1.6rem; }
  #editor input, #editor textarea { margin-bottom: 1rem; }
  .editor-actions { display: flex; gap: 1rem; margin-top: .5rem; }

  @media (max-width: 640px) {
    nav { padding: .8rem 1.2rem; }
    .hero { padding: 4rem 1.2rem 3rem; }
    .container { padding: 2rem 1.2rem 3.5rem; }
    .admin-container { padding: 0 1.2rem 3rem; }
    .dash-header { flex-direction: column; align-items: flex-start; }
    .btn-logout { float: none; margin-top: 1rem; }
  }
</style>
`;

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

  ${SITE_STYLES}
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
  ${SITE_STYLES}
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
