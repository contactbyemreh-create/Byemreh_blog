// netlify/functions/blog-list.js
//
// Renvoie la liste des articles de blog publiés via Decap/Netlify CMS,
// en lisant directement les fichiers .md du dépôt GitHub.
//
// Variables d'environnement à définir dans Netlify (Site settings > Environment variables) :
//   GITHUB_OWNER    -> ton nom d'utilisateur ou organisation GitHub (ex: "emreh")
//   GITHUB_REPO     -> le nom du dépôt (ex: "byemreh")
//   GITHUB_BRANCH   -> la branche publiée (par défaut "main")
//   CONTENT_PATH    -> le dossier où Decap CMS écrit les articles (par défaut "content/blog")
//   GITHUB_TOKEN    -> (optionnel mais recommandé) un Personal Access Token GitHub
//                      en lecture seule sur le repo, pour passer de 60 à 5000 requêtes/heure.

const gitHubApiBase = "https://api.github.com";

// Petit cache en mémoire : tant que la fonction reste "chaude" (quelques minutes),
// on évite de re-taper l'API GitHub à chaque visiteur.
let cache = { data: null, timestamp: 0 };
const CACHE_TTL_MS = 60 * 1000; // 60 secondes

function githubHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function slugFromFilename(filename) {
  return filename.replace(/\.md$/i, "");
}

// Extrait le frontmatter (--- ... ---) sans dépendance externe, pour rester léger.
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
    // Retire les guillemets simples/doubles autour de la valeur si présents.
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

exports.handler = async function () {
  try {
    const now = Date.now();
    if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
        body: JSON.stringify(cache.data),
      };
    }

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";
    const contentPath = process.env.CONTENT_PATH || "content/blog";

    if (!owner || !repo) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error:
            "GITHUB_OWNER et GITHUB_REPO doivent être définis dans les variables d'environnement Netlify.",
        }),
      };
    }

    const listUrl = `${gitHubApiBase}/repos/${owner}/${repo}/contents/${contentPath}?ref=${branch}`;
    const listRes = await fetch(listUrl, { headers: githubHeaders() });

    if (!listRes.ok) {
      const errBody = await listRes.text();
      return {
        statusCode: listRes.status,
        body: JSON.stringify({
          error: "Impossible de lister les articles depuis GitHub.",
          details: errBody,
        }),
      };
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

    // Tri du plus récent au plus ancien. Les articles sans date passent en dernier.
    articles.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    cache = { data: articles, timestamp: now };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
      body: JSON.stringify(articles),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erreur serveur.", details: String(err) }),
    };
  }
};
