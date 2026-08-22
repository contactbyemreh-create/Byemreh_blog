// netlify/functions/blog-article.js
//
// Renvoie un article complet (titre, image, date, contenu HTML) à partir
// de ?slug=mon-article. Va chercher le fichier .md brut directement sur
// raw.githubusercontent.com (pas de limite de requêtes/heure contrairement
// à l'API GitHub classique, donc pas besoin de token ici).
//
// Dépendance à installer : marked (conversion Markdown -> HTML)
//   npm install marked

const { marked } = require("marked");

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

// Reconstitue une URL d'image exploitable, quel que soit le format renvoyé
// par le CMS :
//  - déjà une URL absolue (http/https)        -> inchangée
//  - un chemin relatif au site ("/images/..")  -> inchangée (servi par Netlify)
//  - un simple nom de fichier ("photo.jpg")    -> reconstruite via raw.githubusercontent.com
function resolveImageUrl(value, { owner, repo, branch, mediaPath }) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value; // servi tel quel par Netlify (repo public)
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${mediaPath}/${value}`;
}

exports.handler = async function (event) {
  try {
    const slug = event.queryStringParameters && event.queryStringParameters.slug;
    if (!slug) {
      return { statusCode: 400, body: JSON.stringify({ error: "Paramètre ?slug= manquant." }) };
    }

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";
    const contentPath = process.env.CONTENT_PATH || "content/blog";
    const mediaPath = process.env.MEDIA_PATH || "static/images/uploads";

    if (!owner || !repo) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "GITHUB_OWNER et GITHUB_REPO doivent être définis dans les variables d'environnement Netlify.",
        }),
      };
    }

    // Sécurité basique : un slug ne doit contenir ni "/" ni "..".
    if (!/^[a-zA-Z0-9\-_]+$/.test(slug)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Slug invalide." }) };
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${contentPath}/${slug}.md`;
    const res = await fetch(rawUrl);

    if (!res.ok) {
      return { statusCode: 404, body: JSON.stringify({ error: "Article introuvable." }) };
    }

    const raw = await res.text();
    const { data, content } = parseFrontmatter(raw);

    const article = {
      slug,
      title: data.title || "Sans titre",
      date: data.date || null,
      cover: resolveImageUrl(data.cover || data.image || data.thumbnail, { owner, repo, branch, mediaPath }),
      summary: data.summary || data.description || data.excerpt || "",
      html: marked.parse(content || ""),
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      },
      body: JSON.stringify(article),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur.", details: String(err) }) };
  }
};

