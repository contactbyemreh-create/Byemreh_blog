// worker/index.js
//
// Ce Worker fait deux choses :
// 1. Il répond aux deux mêmes URLs que les anciennes fonctions Netlify
//    (/.netlify/functions/blog-list et /.netlify/functions/blog-article)
//    donc blog.html et blog-article.html n'ont RIEN à changer.
// 2. Pour toutes les autres URLs, il sert simplement le site statique
//    (index.html, blog.html, admin/, images, etc.) via env.ASSETS.
//
// Variables à définir dans Cloudflare (Workers & Pages > ton projet >
// Settings > Variables and Secrets) :
//   GITHUB_OWNER  (texte)   -> ex: contactbyemreh-create
//   GITHUB_REPO   (texte)   -> ex: Byemreh_blog
//   GITHUB_BRANCH (texte)   -> ex: main
//   CONTENT_PATH  (texte)   -> ex: contenu/articles
//   MEDIA_PATH    (texte)   -> ex: images
//   GITHUB_TOKEN  (secret)  -> Personal Access Token GitHub, lecture seule sur le repo

import { marked } from "marked";

const gitHubApiBase = "https://api.github.com";

function githubHeaders(env) {
  const headers = { Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, content: raw };
  const [, frontmatterBlock, body] = match;
  const data = {};
  frontmatterBlock.split(/\r?\n/).forEach((line) => {
    const lineMatch = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(line);
    if (!lineMatch) return;
    let [, key, value] = lineMatch;
    value = value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  });
  return { data, content: body };
}

function slugFromFilename(filename) {
  return filename.replace(/\.md$/i, "");
}

function resolveImageUrl(value, { owner, repo, branch, mediaPath }) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${mediaPath}/${value}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

async function handleBlogList(env) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const contentPath = env.CONTENT_PATH || "content/blog";

  if (!owner || !repo) {
    return json({ error: "GITHUB_OWNER et GITHUB_REPO ne sont pas configurés." }, 500);
  }

  const listUrl = `${gitHubApiBase}/repos/${owner}/${repo}/contents/${contentPath}?ref=${branch}`;
  const listRes = await fetch(listUrl, { headers: githubHeaders(env) });

  if (!listRes.ok) {
    return json({ error: "Impossible de lister les articles depuis GitHub." }, listRes.status);
  }

  const files = await listRes.json();
  const markdownFiles = Array.isArray(files)
    ? files.filter((f) => f.type === "file" && f.name.endsWith(".md"))
    : [];

  const articles = await Promise.all(
    markdownFiles.map(async (file) => {
      const rawRes = await fetch(file.download_url);
      const raw = await rawRes.text();
      const { data } = parseFrontmatter(raw);
      return {
        slug: data.slug || slugFromFilename(file.name),
        title: data.title || "Sans titre",
        date: data.date || null,
        cover: data.cover || data.image || data.thumbnail || null,
        summary: data.summary || data.description || data.excerpt || "",
      };
    })
  );

  articles.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  return json(articles);
}

async function handleBlogArticle(url, env) {
  const slug = url.searchParams.get("slug");
  if (!slug) return json({ error: "Paramètre ?slug= manquant." }, 400);
  if (!/^[a-zA-Z0-9\-_]+$/.test(slug)) return json({ error: "Slug invalide." }, 400);

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const contentPath = env.CONTENT_PATH || "content/blog";
  const mediaPath = env.MEDIA_PATH || "images";

  if (!owner || !repo) {
    return json({ error: "GITHUB_OWNER et GITHUB_REPO ne sont pas configurés." }, 500);
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${contentPath}/${slug}.md`;
  const res = await fetch(rawUrl);
  if (!res.ok) return json({ error: "Article introuvable." }, 404);

  const raw = await res.text();
  const { data, content } = parseFrontmatter(raw);

  return json({
    slug,
    title: data.title || "Sans titre",
    date: data.date || null,
    cover: resolveImageUrl(data.cover || data.image || data.thumbnail, { owner, repo, branch, mediaPath }),
    summary: data.summary || data.description || data.excerpt || "",
    html: marked.parse(content || ""),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/.netlify/functions/blog-list") {
        return await handleBlogList(env);
      }
      if (url.pathname === "/.netlify/functions/blog-article") {
        return await handleBlogArticle(url, env);
      }
    } catch (err) {
      return json({ error: "Erreur serveur.", details: String(err) }, 500);
    }

    // Toutes les autres URLs -> site statique (index.html, blog.html, admin/, images...)
    return env.ASSETS.fetch(request);
  },
};
