/**
 * Moteur générique ByEmreh — Worker Cloudflare (v2)
 * Une instance = un client (D1 + R2 séparés).
 *
 * Public :
 *   GET  /api/bootstrap            config + produits/prestations + articles (1 seule requête)
 *   GET  /api/articles/:slug
 *   POST /api/devis                simulateur -> enregistre + email Resend au pro
 *   POST /api/contact              journalise un message (l'email part via Formspree côté site)
 *   POST /api/track                statistiques anonymes (sans cookie)
 *   POST /api/cal-webhook?key=...  rendez-vous Cal.com (optionnel)
 *   GET  /images/:key
 *
 * Admin (Authorization: Bearer <token>) :
 *   POST /api/admin/login
 *   GET  /api/admin/overview?days=30
 *   GET|POST /api/admin/config
 *   GET|POST|PUT|DELETE /api/admin/prestations[/:id]
 *   GET|POST|PUT|DELETE /api/admin/articles[/:id]
 *   GET|PUT|DELETE /api/admin/devis[/:id]
 *   GET|PUT|DELETE /api/admin/contacts[/:id]
 *   GET /api/admin/rdv
 *   POST /api/admin/upload
 *   POST /api/admin/test-email
 *   GET|POST|PUT|DELETE /api/admin/avis|galerie|faq[/:id]
 *   GET /api/admin/devis/:id/pdf
 *   GET|DELETE /api/admin/abonnes[/:id] · GET|POST /api/admin/campagnes
 *   GET /api/admin/export
 * Public (suite) :
 *   GET  /api/devis-pdf?id=&sig=   PDF de l'estimation (lien signé)
 *   POST /api/subscribe            inscription newsletter (consentement requis)
 *   GET|POST /api/unsubscribe?t=   désinscription (page + one-click)
 */

const STATUTS_DEVIS = ["nouveau", "en_cours", "gagne", "perdu"];
const STATUTS_CONTACT = ["nouveau", "traite"];
const TRACK_TYPES = ["view", "page", "sim_start", "buy_click", "cal_view", "cta_click", "wa_click", "call_click"];
const IMG_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

/* ───────────── Utilitaires HTTP ───────────── */
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}
function json(data, status, env, extra) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(env), ...(extra || {}) },
  });
}
async function readBody(request) {
  const ct = request.headers.get("Content-Type") || "";
  try {
    if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
      const out = {};
      for (const [k, v] of (await request.formData()).entries()) if (typeof v === "string") out[k] = v;
      return out;
    }
    const t = await request.text();
    return t ? JSON.parse(t) : {};
  } catch { return {}; }
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function slugify(s) {
  return (s || "").toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "article";
}

/* ───────────── Auth admin : jeton HMAC-SHA256, 12 h ───────────── */
async function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}
async function signToken(secret, payload) {
  const body = btoa(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(body));
  return `${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyToken(secret, token) {
  try {
    if (!secret || !token) return false;
    const [body, sigB64] = token.split(".");
    if (!body || !sigB64) return false;
    const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, new TextEncoder().encode(body));
    return ok && JSON.parse(atob(body)).exp > Date.now();
  } catch { return false; }
}
async function requireAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return verifyToken(env.ADMIN_TOKEN_SECRET, token);
}
// Comparaison à temps constant (via empreintes SHA-256)
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const A = new Uint8Array(x), B = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

/* ───────────── Limitation de débit (D1) ───────────── */
async function rateLimit(env, key, max, windowSec) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT n, ts FROM rate_limits WHERE k = ?").bind(key).first();
  if (!row || now - row.ts > windowSec * 1000) {
    await env.DB.prepare("INSERT INTO rate_limits (k, n, ts) VALUES (?,1,?) ON CONFLICT(k) DO UPDATE SET n = 1, ts = excluded.ts").bind(key, now).run();
    return true;
  }
  if (row.n >= max) return false;
  await env.DB.prepare("UPDATE rate_limits SET n = n + 1 WHERE k = ?").bind(key).run();
  return true;
}
const ipOf = (request) => request.headers.get("CF-Connecting-IP") || "0";

/* ───────────── Simulateur : configuration + calcul (côté serveur, donc infalsifiable) ───────────── */
function parseSim(raw) {
  let s = {};
  try { s = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {}; } catch { s = {}; }
  const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
  const out = {
    mode: s.mode === "masque" ? "masque" : "affiche",
    unit_label: clean(s.unit_label || "unité(s)", 30),
    unit_price: num(s.unit_price, 20, 0, 1e6),
    qty_min: Math.round(num(s.qty_min, 1, 1, 100000)),
    qty_max: Math.round(num(s.qty_max, 30, 1, 100000)),
    qty_default: 5,
    range_low: num(s.range_low, -10, -90, 0),
    range_high: num(s.range_high, 15, 0, 300),
    options: [],
  };
  if (out.qty_max < out.qty_min) out.qty_max = out.qty_min;
  out.qty_default = Math.round(num(s.qty_default, 5, out.qty_min, out.qty_max));
  const used = new Set();
  (Array.isArray(s.options) ? s.options.slice(0, 12) : []).forEach((o, i) => {
    const label = clean(o && o.label, 80);
    if (!label) return;
    let key = slugify((o && o.key) || label).slice(0, 40) || "opt" + i;
    while (used.has(key)) key += "-" + i;
    used.add(key);
    out.options.push({ key, label, desc: clean(o.desc, 160), price: num(o.price, 0, -1e6, 1e6) });
  });
  return out;
}
const round5 = (x) => Math.round(x / 5) * 5;
function computeEstimate(sim, prest, qty, optionKeys, pct) {
  const unit = prest && prest.prix_base > 0 ? Number(prest.prix_base) : sim.unit_price;
  const q = Math.min(sim.qty_max, Math.max(sim.qty_min, Math.round(Number(qty)) || sim.qty_default));
  const chosen = sim.options.filter((o) => optionKeys.includes(o.key));
  const total = unit * q + chosen.reduce((s, o) => s + o.price, 0);
  const k = 1 - (pct || 0) / 100;
  const min = round5(Math.max(0, total * (1 + sim.range_low / 100) * k));
  const max = Math.max(min, round5(total * (1 + sim.range_high / 100) * k));
  return { qty: q, unit, chosen, total, min, max, pct: pct || 0 };
}

/* ───────────── Fonctions activables (interrupteurs) + réglages associés ───────────── */
const FEATURE_DEFAULTS = {
  produits: true, simulateur: true, rdv: true, blog: true, relance: true, seo: true,
  avis: false, galerie: false, faq: false, horaires: false, whatsapp: false, promo: false, confirmation_client: false,
  pdf: false, newsletter: false, langues: false, reseaux: false, legal: false, apropos: false,
  contact_email: false,
};
function parseFeatures(raw) {
  let f = {}; try { f = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {}; } catch { f = {}; }
  const out = {};
  for (const k of Object.keys(FEATURE_DEFAULTS)) out[k] = typeof f[k] === "boolean" ? f[k] : FEATURE_DEFAULTS[k];
  return out;
}
const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || "")) ? String(v) : d);
const DEFAULT_HOURS = [1, 1, 1, 1, 1, 1, 0].map((o) => ({ o, d: "09:00", f: "18:00", d2: "", f2: "" }));
function parseExtras(raw) {
  let x = {}; try { x = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {}; } catch { x = {}; }
  const hs = Array.isArray(x.horaires) ? x.horaires : DEFAULT_HOURS;
  const horaires = [];
  for (let i = 0; i < 7; i++) {
    const h = hs[i] || DEFAULT_HOURS[i];
    horaires.push({
      o: h.o ? 1 : 0, d: hhmm(h.d, "09:00"), f: hhmm(h.f, "18:00"),
      d2: h.d2 ? hhmm(h.d2, "") : "", f2: h.f2 ? hhmm(h.f2, "") : "",
    });
  }
  const jours = Math.round(Number(x.relance_jours));
  return {
    wa_numero: clean(x.wa_numero, 25).replace(/[^\d+ ]/g, ""),
    wa_message: clean(x.wa_message, 200),
    promo_texte: clean(x.promo_texte, 140),
    promo_code: clean(x.promo_code, 30),
    promo_fin: /^\d{4}-\d{2}-\d{2}$/.test(x.promo_fin || "") ? x.promo_fin : "",
    horaires,
    horaires_note: clean(x.horaires_note, 140),
    carte: x.carte === false || x.carte === 0 ? 0 : 1,
    seo_titre: clean(x.seo_titre, 70),
    seo_description: clean(x.seo_description, 160),
    seo_ville: clean(x.seo_ville, 80),
    relance_jours: Number.isFinite(jours) ? Math.min(30, Math.max(1, jours)) : 3,
    confirm_message: clean(x.confirm_message, 500),
    // — nouvelles fonctions —
    promo_remise: Math.min(90, Math.max(0, Math.round(Number(x.promo_remise)) || 0)),
    fermeture_texte: clean(x.fermeture_texte, 140),
    fermeture_du: /^\d{4}-\d{2}-\d{2}$/.test(x.fermeture_du || "") ? x.fermeture_du : "",
    fermeture_au: /^\d{4}-\d{2}-\d{2}$/.test(x.fermeture_au || "") ? x.fermeture_au : "",
    langues: [...new Set((Array.isArray(x.langues) ? x.langues : []).filter((l) => LANGS.includes(l)))],
    i18n: Object.fromEntries(LANGS.map((l) => { const o = (x.i18n && x.i18n[l]) || {}; return [l, { tagline: clean(o.tagline, 200), description: clean(o.description, 600), promo_texte: clean(o.promo_texte, 140) }]; })),
    reseaux: Object.fromEntries(["instagram", "facebook", "tiktok", "youtube", "linkedin", "google_avis"].map((k) => [k, urlOk((x.reseaux || {})[k])])),
    apropos_titre: clean(x.apropos_titre, 80),
    apropos_texte: clean(x.apropos_texte, 1500),
    apropos_image: clean(x.apropos_image, 300),
    chiffres: (Array.isArray(x.chiffres) ? x.chiffres : []).slice(0, 3).map((c) => ({ n: clean(c && c.n, 12), l: clean(c && c.l, 40) })).filter((c) => c.n && c.l),
    legal: Object.fromEntries(["raison", "forme", "siret", "tva", "adresse", "directeur", "email"].map((k) => [k, clean((x.legal || {})[k], k === "adresse" ? 200 : 120)])),
    devis_validite: Math.min(90, Math.max(1, Math.round(Number(x.devis_validite)) || 30)),
    devis_mention: clean(x.devis_mention, 200),
    devis_conditions: clean(x.devis_conditions, 400),
    newsletter_titre: clean(x.newsletter_titre, 80),
    newsletter_texte: clean(x.newsletter_texte, 200),
  };
}
const LANGS = ["en", "es", "ar"];
const urlOk = (v) => { const t = clean(v, 300); return /^https:\/\/[^\s]+$/i.test(t) ? t : ""; };

/* Remise du code promo (vérifiée côté serveur) */
const parisDay = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
function promoPct(feat, extras, code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c || !feat.promo || !extras.promo_remise || !extras.promo_code) return 0;
  if (c !== extras.promo_code.toUpperCase()) return 0;
  if (extras.promo_fin && parisDay() > extras.promo_fin) return 0;
  return extras.promo_remise;
}

/* ───────────── Normalisation des réglages d'intégration ───────────── */
function normalizeFormspree(v) {
  const m = String(v || "").trim().match(/([a-zA-Z0-9]{6,20})\/?$/);
  return m ? m[1] : "";
}
function normalizeCal(v) {
  let s = String(v || "").trim().replace(/^https?:\/\/(www\.)?cal\.com\//i, "").replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  if (!s) return "";
  if (!s.includes("/")) s += "/sitetest"; // nom d'événement par défaut
  return /^[a-z0-9._-]+(\/[a-z0-9._-]+){1,2}$/i.test(s) ? s : "";
}
const httpsOrEmpty = (v) => { const s = clean(v, 500); return s === "" || /^https:\/\/[^\s]+$/i.test(s) ? s : null; };

/* ───────────── Emails (Resend) ───────────── */
async function sendResend(env, { to, subject, html, text, replyTo, attachments, headers }) {
  if (!env.RESEND_API_KEY) return { ok: false, detail: "Clé RESEND_API_KEY absente (wrangler secret put RESEND_API_KEY)." };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RESEND_FROM || "Devis <onboarding@resend.dev>", to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), ...(attachments ? { attachments } : {}), ...(headers ? { headers } : {}) }),
    });
    const raw = await r.text();
    let data = {}; try { data = JSON.parse(raw); } catch { /* ignore */ }
    if (r.ok) return { ok: true, detail: data.id || "" };
    return { ok: false, detail: `Resend ${r.status} : ${data.message || raw}`.slice(0, 300) };
  } catch (e) { return { ok: false, detail: "Réseau : " + e.message }; }
}

function devisEmail(d, cfg, est, sim) {
  const dateFr = new Date(d.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" });
  const accent = /^#[0-9a-f]{6}$/i.test(cfg.couleur_primaire) ? cfg.couleur_primaire : "#FF5A2B";
  const prix = sim.mode === "affiche" ? `${est.min} € – ${est.max} €` : "À chiffrer par vos soins";
  const opts = est.chosen.length ? est.chosen.map((o) => `${o.label} (${o.price >= 0 ? "+" : ""}${o.price} €)`) : ["Aucune"];
  const row = (k, v) => `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:130px;vertical-align:top">${k}</td><td style="padding:8px 0;font-size:14px;color:#181A1F;font-weight:600">${v}</td></tr>`;
  const html = `<div style="background:#F4F5F7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB">
<div style="background:${accent};padding:18px 24px;color:#fff;font-size:15px;font-weight:700">Nouvelle demande de devis</div>
<div style="padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#6B7280">${esc(dateFr)}</p>
<h2 style="margin:0 0 18px;font-size:20px;color:#181A1F">${esc(d.nom)} — ${esc(d.prestation)}</h2>
<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:18px">
<div style="font-size:12px;color:#6B7280">${sim.mode === "affiche" ? "Estimation affichée au client" : "Prix masqué au client"}</div>
<div style="font-size:24px;font-weight:700;color:#181A1F">${esc(prix)}</div></div>
<table style="width:100%;border-collapse:collapse">
${row("Client", esc(d.nom))}
${row("Email", `<a href="mailto:${esc(d.email)}" style="color:${accent}">${esc(d.email)}</a>`)}
${row("Téléphone", d.tel ? `<a href="tel:${esc(d.tel)}" style="color:${accent}">${esc(d.tel)}</a>` : "—")}
${row("Prestation", esc(d.prestation))}
${row("Quantité", `${est.qty} ${esc(sim.unit_label)}`)}
${row("Options", opts.map(esc).join("<br>"))}
${row("Message", d.message ? esc(d.message).replace(/\n/g, "<br>") : "—")}
</table>
<p style="margin:22px 0 0"><a href="mailto:${esc(d.email)}?subject=${encodeURIComponent("Votre demande de devis — " + cfg.nom_entreprise)}" style="background:${accent};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">Répondre à ${esc(d.nom)}</a></p>
<p style="margin:18px 0 0;font-size:12px;color:#9CA3AF">Ce devis est aussi enregistré dans votre espace pro, onglet « Devis ». Répondre à cet email écrit directement au client.</p>
</div></div></div>`;
  const text = `Nouvelle demande de devis — ${d.nom}\n${dateFr}\n\nPrestation : ${d.prestation}\nQuantité : ${est.qty} ${sim.unit_label}\nOptions : ${opts.join(", ")}\nEstimation : ${prix}\n\nEmail : ${d.email}\nTéléphone : ${d.tel || "—"}\nMessage : ${d.message || "—"}\n`;
  return { html, text, subject: `Nouveau devis — ${d.nom} — ${d.prestation}${sim.mode === "affiche" ? ` (${est.min}–${est.max} €)` : ""}` };
}

function waLink(cfg, extras) {
  let n = String(extras.wa_numero || cfg.telephone || "").replace(/[^\d+]/g, "");
  if (/^0\d{9}$/.test(n)) n = "33" + n.slice(1);
  n = n.replace(/^\+/, "").replace(/^00/, "");
  return n.length >= 9 ? `https://wa.me/${n}` : "";
}
const MAIL_I18N = {
  fr: { hi: (n) => `Merci ${n}, c'est bien reçu ✅`, msg: "Nous avons bien reçu votre demande et nous revenons vers vous très rapidement.", srv: "Prestation", qty: "Quantité", opt: "Options", est: "Estimation", ind: "(indicative)", rem: "Remise", q: "Une question ? Répondez simplement à cet email", or: "ou appelez-nous au", wa: "Nous écrire sur WhatsApp", subj: (n) => `Votre demande est bien reçue — ${n}`, pdf: "Votre estimation est jointe à cet email (PDF).", dir: "ltr" },
  en: { hi: (n) => `Thank you ${n}, we've got your request ✅`, msg: "We have received your request and will get back to you very shortly.", srv: "Service", qty: "Quantity", opt: "Options", est: "Estimate", ind: "(indicative)", rem: "Discount", q: "Any questions? Simply reply to this email", or: "or call us on", wa: "Message us on WhatsApp", subj: (n) => `Your request has been received — ${n}`, pdf: "Your estimate is attached to this email (PDF).", dir: "ltr" },
  es: { hi: (n) => `Gracias ${n}, hemos recibido tu solicitud ✅`, msg: "Hemos recibido tu solicitud y te responderemos muy pronto.", srv: "Servicio", qty: "Cantidad", opt: "Opciones", est: "Estimación", ind: "(orientativa)", rem: "Descuento", q: "¿Alguna pregunta? Responde simplemente a este correo", or: "o llámanos al", wa: "Escríbenos por WhatsApp", subj: (n) => `Hemos recibido tu solicitud — ${n}`, pdf: "Tu estimación va adjunta a este correo (PDF).", dir: "ltr" },
  ar: { hi: (n) => `شكرًا ${n}، تم استلام طلبك ✅`, msg: "لقد استلمنا طلبك وسنعاود الاتصال بك في أقرب وقت.", srv: "الخدمة", qty: "الكمية", opt: "الخيارات", est: "التقدير", ind: "(تقريبي)", rem: "الخصم", q: "هل لديك سؤال؟ ما عليك سوى الرد على هذه الرسالة", or: "أو اتصل بنا على", wa: "راسلنا عبر واتساب", subj: (n) => `تم استلام طلبك — ${n}`, pdf: "تقديرك مرفق بهذه الرسالة (PDF).", dir: "rtl" },
};
function confirmationEmail(d, cfg, est, sim, extras, feat, lang, withPdf) {
  const L = MAIL_I18N[lang] || MAIL_I18N.fr;
  const accent = /^#[0-9a-f]{6}$/i.test(cfg.couleur_primaire) ? cfg.couleur_primaire : "#FF5A2B";
  const prix = sim.mode === "affiche" ? `${est.min} € – ${est.max} €` : "";
  const opts = est.chosen.map((o) => o.label);
  const msg = (lang === "fr" || !MAIL_I18N[lang]) && extras.confirm_message ? extras.confirm_message : L.msg;
  const wa = feat.whatsapp ? waLink(cfg, extras) : "";
  const align = L.dir === "rtl" ? "right" : "left";
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top;text-align:${align}">${k}</td><td style="padding:6px 0;font-size:14px;color:#181A1F;font-weight:600;text-align:${align}">${v}</td></tr>`;
  const html = `<div dir="${L.dir}" style="background:#F4F5F7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB">
<div style="background:${accent};padding:18px 24px;color:#fff;font-size:15px;font-weight:700;text-align:${align}">${esc(cfg.nom_entreprise)}</div>
<div style="padding:24px;text-align:${align}">
<h2 style="margin:0 0 10px;font-size:20px;color:#181A1F">${esc(L.hi(d.nom))}</h2>
<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151">${esc(msg)}</p>
<table style="width:100%;border-collapse:collapse;border-top:1px solid #E5E7EB">
${row(L.srv, esc(d.prestation))}
${row(L.qty, `${est.qty} ${esc(sim.unit_label)}`)}
${opts.length ? row(L.opt, opts.map(esc).join("<br>")) : ""}
${est.pct ? row(L.rem, `-${est.pct} %`) : ""}
${prix ? row(L.est, esc(prix) + ` <span style="font-weight:400;color:#6B7280;font-size:12px">${esc(L.ind)}</span>`) : ""}
</table>
${withPdf ? `<p style="margin:16px 0 0;font-size:13px;color:#374151">📎 ${esc(L.pdf)}</p>` : ""}
<p style="margin:20px 0 0;font-size:13px;color:#6B7280">${esc(L.q)}${cfg.telephone ? ` ${esc(L.or)} <b>${esc(cfg.telephone)}</b>` : ""}.</p>
${wa ? `<p style="margin:14px 0 0"><a href="${esc(wa)}" style="background:#25D366;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">${esc(L.wa)}</a></p>` : ""}
</div></div></div>`;
  const text = `${L.hi(d.nom)}\n\n${msg}\n\n${L.srv}: ${d.prestation}\n${L.qty}: ${est.qty} ${sim.unit_label}${opts.length ? `\n${L.opt}: ${opts.join(", ")}` : ""}${est.pct ? `\n${L.rem}: -${est.pct} %` : ""}${prix ? `\n${L.est} ${L.ind}: ${prix}` : ""}\n\n${cfg.nom_entreprise}${cfg.telephone ? ` — ${cfg.telephone}` : ""}`;
  return { html, text, subject: L.subj(cfg.nom_entreprise) };
}


function contactEmails(c, cfg, extras, feat) {
  const accent = /^#[0-9a-f]{6}$/i.test(cfg.couleur_primaire) ? cfg.couleur_primaire : "#0E7C66";
  const dateFr = new Date(c.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" });
  const row = (k, v) => `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:120px;vertical-align:top">${k}</td><td style="padding:8px 0;font-size:14px;color:#181A1F;font-weight:600">${v}</td></tr>`;
  const msgHtml = esc(c.message).replace(/\n/g, "<br>");
  const pro = {
    subject: `${c.page && /partenaire/i.test(c.page) ? "Demande de partenariat" : "Nouveau message"} — ${c.nom}`,
    html: `<div style="background:#F4F5F7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:580px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB">
<div style="background:${accent};padding:18px 24px;color:#fff;font-size:15px;font-weight:700">${esc(cfg.nom_entreprise)} · nouveau message</div>
<div style="padding:22px 24px"><table style="width:100%;border-collapse:collapse">
${row("De", esc(c.nom))}${row("Email", `<a href="mailto:${esc(c.email)}" style="color:${accent}">${esc(c.email)}</a>`)}${c.tel ? row("Téléphone", esc(c.tel)) : ""}${c.sujet ? row("Sujet", esc(c.sujet)) : ""}${c.page ? row("Page", esc(c.page)) : ""}${row("Reçu le", esc(dateFr))}
</table><div style="margin-top:14px;padding:14px 16px;background:#F4F5F7;border-radius:10px;font-size:14px;line-height:1.65;color:#181A1F">${msgHtml}</div>
<p style="margin:16px 0 0;font-size:12px;color:#6B7280">Répondez directement à cet email : la réponse part au client.</p></div></div></div>`,
    text: `Nouveau message de ${c.nom} <${c.email}>${c.tel ? "\nTél : " + c.tel : ""}${c.sujet ? "\nSujet : " + c.sujet : ""}${c.page ? "\nPage : " + c.page : ""}\n\n${c.message}`,
  };
  const wa = feat.whatsapp ? waLink(cfg, extras) : "";
  const intro = extras.confirm_message || "Merci pour votre message : je l'ai bien reçu et je reviens vers vous très rapidement, en général sous 24 h ouvrées.";
  const client = {
    subject: `Votre message est bien reçu — ${cfg.nom_entreprise}`,
    html: `<div style="background:#F4F5F7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB">
<div style="background:${accent};padding:18px 24px;color:#fff;font-size:15px;font-weight:700">${esc(cfg.nom_entreprise)}</div>
<div style="padding:24px"><h2 style="margin:0 0 10px;font-size:20px;color:#181A1F">Merci ${esc(c.nom)}, c'est bien reçu ✅</h2>
<p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#374151">${esc(intro)}</p>
<div style="padding:12px 14px;background:#F4F5F7;border-radius:10px;font-size:13px;line-height:1.6;color:#4B5563"><b style="color:#181A1F">Votre message :</b><br>${msgHtml}</div>
<p style="margin:18px 0 0;font-size:13px;color:#6B7280">Une précision à ajouter ? Répondez simplement à cet email${cfg.telephone ? ` ou appelez-moi au <b>${esc(cfg.telephone)}</b>` : ""}.</p>
${wa ? `<p style="margin:14px 0 0"><a href="${esc(wa)}" style="background:#25D366;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">Me écrire sur WhatsApp</a></p>` : ""}
</div></div></div>`,
    text: `Merci ${c.nom}, votre message est bien reçu.\n\n${intro}\n\nVotre message :\n${c.message}\n\n${cfg.nom_entreprise}${cfg.telephone ? " — " + cfg.telephone : ""}`,
  };
  return { pro, client };
}
const pagePath = (request, b) => {
  const p = clean(b.page, 120);
  if (p.startsWith("/")) return p;
  try { return new URL(request.headers.get("Referer") || "").pathname.slice(0, 120); } catch { return ""; }
};

/* ───────────── PDF de l'estimation (sans dépendance : Helvetica intégrée) ───────────── */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const WIN = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c };
function pdfEnc(str) {
  let o = "";
  for (const ch of String(str == null ? "" : str).replace(/[\r\n\t]+/g, " ").normalize("NFC")) {
    const c = ch.codePointAt(0);
    if (WIN[ch]) o += String.fromCharCode(WIN[ch]);
    else if (c === 0x202f || c === 0xa0 || c === 0x2009) o += " ";
    else if (c >= 32 && c < 256) o += String.fromCharCode(c);
    else o += "?";
  }
  return o.replace(/[\\()]/g, (c) => "\\" + c);
}
function pdfWidth(str, size, bold) {
  let w = 0;
  for (const ch of String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "")) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; }
  return (w * size / 1000) * (bold ? 1.07 : 1);
}
function pdfWrap(str, size, bold, maxW) {
  const out = [];
  for (const para of String(str || "").split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + word : word;
      if (pdfWidth(t, size, bold) <= maxW) line = t; else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const fmtE = (n) => fmtN(n) + " €";
const frDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
const devisNumero = (d) => `DV-${new Date(d.created_at).getUTCFullYear()}-${String(d.id).padStart(4, "0")}`;

function buildDevisPdf(d, cfg, extras) {
  const hex = /^#[0-9a-f]{6}$/i.test(cfg.couleur_primaire) ? cfg.couleur_primaire : "#0F766E";
  const acc = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));
  const ink = "0.094 0.102 0.122", grey = "0.42 0.45 0.50", ops = [];
  const txt = (x, y, str, o = {}) => {
    const size = o.size || 10, bold = !!o.bold;
    const w = o.align === "r" ? pdfWidth(str, size, bold) : 0;
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${o.color || ink} rg ${(x - w).toFixed(2)} ${y.toFixed(2)} Td (${pdfEnc(str)}) Tj ET`);
  };
  const rect = (x, y, w, h, rgb) => ops.push(`${rgb} rg ${x} ${y} ${w} ${h} re f`);
  const hline = (y, x1 = 40, x2 = 555) => ops.push(`0.9 0.91 0.93 RG 0.7 w ${x1} ${y} m ${x2} ${y} l S`);
  const L = extras.legal || {}, num = devisNumero(d), mode = d.mode, show = mode === "affiche";
  const opts = (() => { try { return JSON.parse(d.options_json || "[]"); } catch { return []; } })();

  rect(0, 772, 595, 70, acc.join(" "));
  txt(40, 800, cfg.nom_entreprise, { size: 20, bold: true, color: "1 1 1" });
  txt(555, 806, "ESTIMATION DE DEVIS", { size: 11, bold: true, color: "1 1 1", align: "r" });
  txt(555, 790, num, { size: 10, color: "1 1 1", align: "r" });

  let y = 742;
  const ident = [L.raison && L.raison !== cfg.nom_entreprise ? L.raison : "", L.forme, L.siret ? "SIRET : " + L.siret : "", L.adresse || cfg.adresse, cfg.telephone, L.email || cfg.email_contact].filter(Boolean);
  ident.slice(0, 7).forEach((l, i) => txt(40, y - i * 13, l, { size: 9.5, bold: i === 0 && ident[0] !== cfg.adresse && !!(L.raison && L.raison !== cfg.nom_entreprise), color: i === 0 ? ink : grey }));
  const valid = new Date(new Date(d.created_at).getTime() + extras.devis_validite * 86400000).toISOString();
  txt(555, y, "Date : " + frDate(d.created_at), { size: 10, align: "r" });
  txt(555, y - 14, "Valable jusqu'au : " + frDate(valid), { size: 10, align: "r" });
  txt(555, y - 28, "N° " + num, { size: 10, bold: true, align: "r" });

  y = 640;
  rect(40, y - 52, 515, 62, "0.965 0.969 0.976");
  txt(54, y - 8, "POUR", { size: 8, bold: true, color: grey });
  txt(54, y - 24, d.nom, { size: 12, bold: true });
  txt(54, y - 39, [d.email, d.tel].filter(Boolean).join("  ·  "), { size: 9.5, color: grey });

  y = 560;
  rect(40, y - 6, 515, 22, acc.join(" "));
  txt(50, y, "Désignation", { size: 9.5, bold: true, color: "1 1 1" });
  txt(380, y, "Qté", { size: 9.5, bold: true, color: "1 1 1", align: "r" });
  txt(465, y, "Prix unitaire", { size: 9.5, bold: true, color: "1 1 1", align: "r" });
  txt(547, y, "Total", { size: 9.5, bold: true, color: "1 1 1", align: "r" });
  y -= 26;
  const lines = [{ t: d.prestation, q: `${d.quantite} ${d.unite}`, u: d.prix_unit > 0 ? fmtE(d.prix_unit) : "", tot: d.prix_unit > 0 ? fmtE(d.prix_unit * d.quantite) : "" }]
    .concat(opts.map((o) => ({ t: "Option : " + o.label, q: "1", u: fmtE(o.price), tot: fmtE(o.price) })));
  for (const ln of lines.slice(0, 8)) {
    const wl = pdfWrap(ln.t, 10, false, 300);
    txt(50, y, wl[0] || "", { size: 10 });
    txt(380, y, ln.q, { size: 10, align: "r" });
    if (show) { txt(465, y, ln.u, { size: 10, align: "r" }); txt(547, y, ln.tot, { size: 10, align: "r" }); }
    else txt(547, y, "—", { size: 10, align: "r", color: grey });
    hline(y - 8); y -= 24;
  }
  if (d.remise_pct > 0 && show) { txt(50, y, `Remise (code ${d.remise_code}) : -${d.remise_pct} %`, { size: 10, color: grey }); hline(y - 8); y -= 24; }

  y -= 6;
  rect(285, y - 40, 270, 52, acc.join(" "));
  if (show) {
    txt(299, y - 12, "ESTIMATION INDICATIVE", { size: 8.5, bold: true, color: "1 1 1" });
    txt(299, y - 32, `${fmtE(d.estimation_min)} – ${fmtE(d.estimation_max)}`, { size: 17, bold: true, color: "1 1 1" });
  } else {
    txt(299, y - 12, "MONTANT", { size: 8.5, bold: true, color: "1 1 1" });
    txt(299, y - 32, "À confirmer par nos soins", { size: 13, bold: true, color: "1 1 1" });
  }
  y -= 70;

  if (d.message) {
    txt(40, y, "VOTRE MESSAGE", { size: 8, bold: true, color: grey }); y -= 14;
    const ml = pdfWrap(d.message, 9.5, false, 515);
    ml.slice(0, 6).forEach((l, i) => { txt(40, y, i === 5 && ml.length > 6 ? l.slice(0, -1) + "…" : l, { size: 9.5 }); y -= 12.5; });
    y -= 8;
  }
  const notes = [extras.devis_conditions, extras.devis_mention, L.tva].filter(Boolean);
  if (notes.length) {
    txt(40, y, "CONDITIONS & MENTIONS", { size: 8, bold: true, color: grey }); y -= 14;
    for (const n of notes) for (const l of pdfWrap(n, 9, false, 515).slice(0, 4)) { if (y > 70) { txt(40, y, l, { size: 9, color: grey }); y -= 12; } }
  }
  hline(54);
  const fl = pdfWrap(`Document établi automatiquement depuis le site de ${cfg.nom_entreprise}. Il s'agit d'une estimation indicative : elle n'est contractuelle qu'après confirmation écrite de ${cfg.nom_entreprise}.`, 8, false, 515);
  fl.slice(0, 2).forEach((l, i) => txt(40, 42 - i * 10, l, { size: 8, color: grey }));

  const content = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title (${num}) /Producer (ByEmreh) >>`,
  ];
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const offs = [];
  objs.forEach((b, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out; // chaîne binaire (1 caractère = 1 octet)
}
const binToBytes = (bin) => { const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function pdfSig(env, id) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.ADMIN_TOKEN_SECRET + ":pdf", "sign"), new TextEncoder().encode("pdf:" + id));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
const pdfResponse = (bin, name, env) => new Response(binToBytes(bin), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store", ...corsHeaders(env) } });

/* ───────────── Newsletter : email + page de désinscription ───────────── */
function newsletterEmail(cfg, extras, { sujet, corps, bouton_label, bouton_url }, unsubUrl) {
  const accent = /^#[0-9a-f]{6}$/i.test(cfg.couleur_primaire) ? cfg.couleur_primaire : "#FF5A2B";
  const paras = String(corps || "").split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
  const btn = bouton_label && /^https:\/\/\S+$/i.test(bouton_url || "") ? `<p style="margin:20px 0 6px"><a href="${esc(bouton_url)}" style="background:${accent};color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700;font-size:14px;display:inline-block">${esc(bouton_label)}</a></p>` : "";
  const L = extras.legal || {};
  const ident = [L.raison || cfg.nom_entreprise, L.adresse || cfg.adresse].filter(Boolean).join(" — ");
  const html = `<div style="background:#F4F5F7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB">
<div style="background:${accent};padding:18px 24px;color:#fff;font-size:15px;font-weight:700">${esc(cfg.nom_entreprise)}</div>
<div style="padding:26px 24px 18px"><h2 style="margin:0 0 16px;font-size:21px;color:#181A1F">${esc(sujet)}</h2>${paras}${btn}</div>
<div style="padding:14px 24px 20px;border-top:1px solid #E5E7EB;font-size:11.5px;color:#6B7280;line-height:1.6">Vous recevez cet email car vous êtes inscrit(e) à la lettre d'information de ${esc(cfg.nom_entreprise)}.<br>${esc(ident)}<br><a href="${esc(unsubUrl)}" style="color:#6B7280">Se désinscrire</a></div></div></div>`;
  const text = `${sujet}\n\n${corps}${bouton_label && bouton_url ? `\n\n${bouton_label} : ${bouton_url}` : ""}\n\n—\n${ident}\nSe désinscrire : ${unsubUrl}`;
  return { html, text };
}
function htmlPage(title, body, status) {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body style="font-family:system-ui,Arial,sans-serif;background:#f4f5f7;margin:0;display:grid;place-items:center;min-height:100vh"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:2rem 1.6rem;max-width:420px;text-align:center"><h1 style="font-size:1.25rem;margin:0 0 .6rem">${esc(title)}</h1><p style="color:#4b5563;line-height:1.6;margin:0">${body}</p></div></body></html>`, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ───────────── Données publiques ───────────── */
function publicConfig(cfg) {
  const { pro_email, sim_config, features, extras, ...pub } = cfg;
  return { ...pub, cal_link: normalizeCal(cfg.cal_link), sim: parseSim(sim_config), features: parseFeatures(features), extras: parseExtras(extras) };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const segs = pathname.split("/").filter(Boolean);
    const m = request.method;

    if (m === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });

    try {
      /* ── Images (R2) ── */
      if (pathname.startsWith("/images/") && m === "GET") {
        if (!env.IMAGES) return json({ ok: false, error: "Stockage d'images non configuré" }, 404, env);
        const obj = await env.IMAGES.get(segs.slice(1).join("/"));
        if (!obj) return json({ ok: false, error: "Image introuvable" }, 404, env);
        return new Response(obj.body, {
          headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", ...corsHeaders(env) },
        });
      }

      /* ── Site public en UNE requête ── */
      if (pathname === "/api/bootstrap" && m === "GET") {
        const [c, p, a, av, ga, fa] = await env.DB.batch([
          env.DB.prepare("SELECT * FROM config WHERE id = 1"),
          env.DB.prepare("SELECT id, titre, description, prix_affiche, image_url, stripe_url, bouton_label, badge, prix_base FROM prestations WHERE actif = 1 ORDER BY ordre ASC, id ASC"),
          env.DB.prepare("SELECT id, titre, slug, extrait, image_url, date_publication FROM articles WHERE publie = 1 ORDER BY date_publication DESC LIMIT 30"),
          env.DB.prepare("SELECT id, auteur, texte, note, source FROM avis WHERE actif = 1 ORDER BY ordre ASC, id DESC LIMIT 40"),
          env.DB.prepare("SELECT id, titre, legende, image_url, image_apres_url FROM galerie WHERE actif = 1 ORDER BY ordre ASC, id DESC LIMIT 60"),
          env.DB.prepare("SELECT id, question, reponse FROM faq WHERE actif = 1 ORDER BY ordre ASC, id ASC LIMIT 40"),
        ]);
        const pub = publicConfig(c.results[0]), F = pub.features;
        return json({ config: pub, prestations: F.produits || F.simulateur ? p.results : [], articles: F.blog ? a.results : [], avis: F.avis ? av.results : [], galerie: F.galerie ? ga.results : [], faq: F.faq ? fa.results : [] }, 200, env, { "Cache-Control": "public, max-age=20, stale-while-revalidate=120" });
      }

      if (segs[0] === "api" && segs[1] === "articles" && segs[2] && m === "GET") {
        const article = await env.DB.prepare("SELECT * FROM articles WHERE slug = ? AND publie = 1").bind(segs[2]).first();
        if (!article) return json({ ok: false, error: "Article introuvable" }, 404, env);
        return json({ article }, 200, env, { "Cache-Control": "public, max-age=60" });
      }

      /* ── Statistiques anonymes ── */
      if (pathname === "/api/track" && m === "POST") {
        const b = await readBody(request);
        const type = clean(b.type, 20);
        if (!TRACK_TYPES.includes(type)) return json({ ok: true }, 200, env);
        if ((type === "view" || type === "page") && /bot|crawl|spider|preview|monitor|lighthouse|headless/i.test(request.headers.get("User-Agent") || "")) return json({ ok: true }, 200, env);
        if (!(await rateLimit(env, "tr:" + ipOf(request), 120, 60))) return json({ ok: true }, 200, env);
        const now = Date.now();
        await env.DB.prepare("INSERT INTO events (created_at, jour, type, label) VALUES (?,?,?,?)").bind(new Date(now).toISOString(), isoDay(now), type, clean(b.label, 80)).run();
        if (Math.random() < 0.02) { // ménage occasionnel
          ctx.waitUntil(env.DB.batch([
            env.DB.prepare("DELETE FROM events WHERE jour < ?").bind(isoDay(now - 400 * 86400000)),
            env.DB.prepare("DELETE FROM rate_limits WHERE ts < ?").bind(now - 86400000),
          ]));
        }
        return json({ ok: true }, 200, env);
      }

      /* ── Message de contact (journal ; l'email part via Formspree depuis le site) ── */
      /* ── PDF de l'estimation (lien signé, valable pour ce devis uniquement) ── */
      if (pathname === "/api/devis-pdf" && m === "GET") {
        const did = parseInt(url.searchParams.get("id") || "", 10);
        if (!Number.isInteger(did) || !(await safeEqual(url.searchParams.get("sig") || "", await pdfSig(env, did)))) return htmlPage("Lien invalide", "Ce lien n'est plus valable.", 403);
        const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
        if (!parseFeatures(cfg.features).pdf) return htmlPage("Indisponible", "Le téléchargement n'est pas activé.", 403);
        const row = await env.DB.prepare("SELECT * FROM devis WHERE id = ?").bind(did).first();
        if (!row) return htmlPage("Introuvable", "Ce devis n'existe plus.", 404);
        return pdfResponse(buildDevisPdf(row, cfg, parseExtras(cfg.extras)), devisNumero(row), env);
      }

      /* ── Newsletter : inscription / désinscription ── */
      if (pathname === "/api/subscribe" && m === "POST") {
        const b = await readBody(request);
        if (b.website) return json({ ok: true }, 200, env); // honeypot
        const email = clean(b.email, 150).toLowerCase();
        if (!emailOk(email)) return json({ ok: false, error: "Adresse email invalide" }, 400, env);
        if (b.consent !== true) return json({ ok: false, error: "Merci de cocher la case de consentement" }, 400, env);
        if (!(await rateLimit(env, "sb:" + ipOf(request), 6, 600))) return json({ ok: false, error: "Trop de tentatives, réessayez plus tard." }, 429, env);
        const cf = await env.DB.prepare("SELECT features FROM config WHERE id = 1").first();
        if (!parseFeatures(cf.features).newsletter) return json({ ok: false, error: "Inscription indisponible" }, 403, env);
        const token = crypto.randomUUID().replace(/-/g, "");
        const lang = ["fr", "en", "es", "ar"].includes(b.lang) ? b.lang : "fr";
        await env.DB.prepare("INSERT INTO abonnes (email, created_at, consent_at, source, lang, token, actif) VALUES (?,?,?,?,?,?,1) ON CONFLICT(email) DO UPDATE SET actif = 1, consent_at = excluded.consent_at")
          .bind(email, new Date().toISOString(), new Date().toISOString(), clean(b.source, 40) || "site", lang, token).run();
        return json({ ok: true }, 200, env);
      }
      if (pathname === "/api/unsubscribe" && (m === "GET" || m === "POST")) {
        const t = clean(url.searchParams.get("t"), 64);
        if (t) await env.DB.prepare("UPDATE abonnes SET actif = 0 WHERE token = ?").bind(t).run();
        if (m === "POST") return new Response("ok", { headers: corsHeaders(env) });
        return htmlPage("Désinscription confirmée", "Vous ne recevrez plus nos emails. Vous pouvez fermer cette page.");
      }

      /* ── Message de contact (journal) ── */
      if (pathname === "/api/contact" && m === "POST") {
        const b = await readBody(request);
        if (b.website || b._gotcha) return json({ ok: true }, 200, env); // honeypot
        const nom = clean(b.nom || b.name, 100), email = clean(b.email, 150);
        const KNOWN = new Set(["nom", "name", "email", "tel", "telephone", "phone", "message", "prestation", "activite", "sujet", "website", "_gotcha", "_subject", "_replyto", "_next", "_cc", "page", "consent", "lang"]);
        const extra = Object.entries(b).filter(([k, v]) => !KNOWN.has(k) && typeof v === "string" && v.trim()).slice(0, 12).map(([k, v]) => `${clean(k, 40)} : ${clean(v, 300)}`);
        let message = clean(b.message, 3000);
        if (extra.length) message += (message ? "\n\n" : "") + extra.join("\n");
        if (!nom || !emailOk(email) || !message) return json({ ok: false, error: "Champs invalides" }, 400, env);
        if (!(await rateLimit(env, "ct:" + ipOf(request), 6, 600))) return json({ ok: false, error: "Trop de tentatives, réessayez dans quelques minutes." }, 429, env);
        const created = new Date().toISOString(), sujet = clean(b.prestation || b.activite || b.sujet, 150), tel = clean(b.tel || b.telephone || b.phone, 40), page = pagePath(request, b);
        const ins = await env.DB.prepare("INSERT INTO contacts (created_at, nom, email, tel, prestation_interessee, message) VALUES (?,?,?,?,?,?)")
          .bind(created, nom, email, tel, sujet, message).run();
        const cid = ins.meta.last_row_id;

        // Emails via Resend (fonction activable) — le message est déjà enregistré quoi qu'il arrive
        const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
        const feat = parseFeatures(cfg.features);
        if (feat.contact_email) {
          const mails = contactEmails({ created_at: created, nom, email, tel, sujet, message, page }, cfg, parseExtras(cfg.extras), feat);
          const r1 = await sendResend(env, { to: cfg.pro_email, subject: mails.pro.subject, html: mails.pro.html, text: mails.pro.text, replyTo: email });
          try { await env.DB.prepare("UPDATE contacts SET email_statut = ?, email_detail = ? WHERE id = ?").bind(r1.ok ? "envoye" : "echec", r1.detail, cid).run(); } catch { /* colonne absente : ignoré */ }
          if (feat.confirmation_client) {
            const r2 = await sendResend(env, { to: email, subject: mails.client.subject, html: mails.client.html, text: mails.client.text, replyTo: cfg.pro_email });
            try { await env.DB.prepare("UPDATE contacts SET client_email_statut = ?, client_email_detail = ? WHERE id = ?").bind(r2.ok ? "envoye" : "echec", r2.detail, cid).run(); } catch { /* ignoré */ }
          }
        }
        return json({ ok: true }, 200, env);
      }

      /* ── Réglages publics minimaux (pour le script du site : formulaires, newsletter) ── */
      if (pathname === "/api/site" && m === "GET") {
        const cfg = await env.DB.prepare("SELECT nom_entreprise, couleur_primaire, features, extras FROM config WHERE id = 1").first();
        const f = parseFeatures(cfg.features), x = parseExtras(cfg.extras);
        return json({ nom: cfg.nom_entreprise, couleur: cfg.couleur_primaire, features: { contact_email: f.contact_email, newsletter: f.newsletter }, newsletter: { titre: x.newsletter_titre, texte: x.newsletter_texte } }, 200, env, { "Cache-Control": "public, max-age=120" });
      }

      /* ── Devis du simulateur ── */
      if (pathname === "/api/devis" && m === "POST") {
        const b = await readBody(request);
        if (b.website) return json({ ok: true }, 200, env); // honeypot
        const nom = clean(b.nom, 100), email = clean(b.email, 150);
        if (!nom || !emailOk(email)) return json({ ok: false, error: "Nom et email valides requis" }, 400, env);
        if (!(await rateLimit(env, "dv:" + ipOf(request), 5, 600))) return json({ ok: false, error: "Trop de demandes, réessayez dans quelques minutes." }, 429, env);

        const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
        const feat = parseFeatures(cfg.features), extras = parseExtras(cfg.extras);
        if (!feat.simulateur) return json({ ok: false, error: "Le simulateur de devis est désactivé." }, 403, env);
        const sim = parseSim(cfg.sim_config);
        let prest = null;
        if (b.prestation_id) prest = await env.DB.prepare("SELECT * FROM prestations WHERE id = ? AND actif = 1").bind(Number(b.prestation_id) || 0).first();
        const prestTitre = prest ? prest.titre : clean(b.prestation, 150) || "Non précisé";
        const lang = ["fr", "en", "es", "ar"].includes(b.lang) ? b.lang : "fr";
        const pct = promoPct(feat, extras, b.code);
        const est = computeEstimate(sim, prest, b.quantite, Array.isArray(b.options) ? b.options.map(String) : [], pct);
        const d = {
          created_at: new Date().toISOString(), nom, email, tel: clean(b.tel, 40), prestation: prestTitre,
          message: clean(b.message, 2000),
        };
        const r = await env.DB.prepare(`INSERT INTO devis (created_at, nom, email, tel, prestation, quantite, unite, options_json, estimation_min, estimation_max, mode, message, prix_unit, remise_code, remise_pct, lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(d.created_at, d.nom, d.email, d.tel, d.prestation, est.qty, sim.unit_label, JSON.stringify(est.chosen.map((o) => ({ label: o.label, price: o.price }))), est.min, est.max, sim.mode, d.message, est.unit, pct ? clean(b.code, 30).toUpperCase() : "", pct, lang).run();
        const id = r.meta.last_row_id;

        // Email au professionnel
        const mail = devisEmail(d, cfg, est, sim);
        const res = await sendResend(env, { to: cfg.pro_email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: d.email });
        await env.DB.prepare("UPDATE devis SET email_statut = ?, email_detail = ? WHERE id = ?").bind(res.ok ? "envoye" : "echec", res.detail, id).run();

        // Email de confirmation au client (fonction activable)
        if (feat.confirmation_client) {
          const cm = confirmationEmail(d, cfg, est, sim, extras, feat, lang, feat.pdf);
          let attachments;
          if (feat.pdf) {
            const row = await env.DB.prepare("SELECT * FROM devis WHERE id = ?").bind(id).first();
            attachments = [{ filename: devisNumero(row) + ".pdf", content: btoa(buildDevisPdf(row, cfg, extras)) }];
          }
          const rc = await sendResend(env, { to: d.email, subject: cm.subject, html: cm.html, text: cm.text, replyTo: cfg.pro_email, attachments });
          await env.DB.prepare("UPDATE devis SET client_email_statut = ?, client_email_detail = ? WHERE id = ?").bind(rc.ok ? "envoye" : "echec", rc.detail, id).run();
        }

        return json({
          ok: true, id, mode: sim.mode, remise: pct,
          estimate: sim.mode === "affiche" ? { min: est.min, max: est.max } : null,
          pdf_url: feat.pdf ? `/api/devis-pdf?id=${id}&sig=${await pdfSig(env, id)}` : null,
        }, 200, env);
      }

      /* ── Webhook Cal.com (rendez-vous) ── */
      if (pathname === "/api/cal-webhook" && m === "POST") {
        if (!env.CAL_WEBHOOK_KEY || !(await safeEqual(url.searchParams.get("key") || "", env.CAL_WEBHOOK_KEY))) return json({ ok: false, error: "Non autorisé" }, 401, env);
        const body = await readBody(request);
        const trig = body.triggerEvent, p = body.payload || {};
        if (!["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"].includes(trig)) return json({ ok: true }, 200, env);
        const att = (p.attendees && p.attendees[0]) || {};
        const uid = clean(p.uid || p.bookingId || crypto.randomUUID(), 100);
        if (p.rescheduleUid) await env.DB.prepare("UPDATE rdv SET statut = 'annule' WHERE uid = ?").bind(clean(p.rescheduleUid, 100)).run();
        await env.DB.prepare(`INSERT INTO rdv (uid, created_at, debut, fin, titre, nom, email, statut) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(uid) DO UPDATE SET debut = excluded.debut, fin = excluded.fin, titre = excluded.titre, nom = excluded.nom, email = excluded.email, statut = excluded.statut`)
          .bind(uid, new Date().toISOString(), clean(p.startTime, 40), clean(p.endTime, 40), clean(p.title || p.eventTitle, 150), clean(att.name, 100), clean(att.email, 150), trig === "BOOKING_CANCELLED" ? "annule" : "confirme").run();
        return json({ ok: true }, 200, env);
      }

      /* ── Connexion admin ── */
      if (pathname === "/api/admin/login" && m === "POST") {
        if (!(await rateLimit(env, "lg:" + ipOf(request), 8, 900))) return json({ ok: false, error: "Trop d'essais. Patientez 15 minutes." }, 429, env);
        const { password } = await readBody(request);
        if (!env.ADMIN_PASSWORD || !(await safeEqual(String(password || ""), env.ADMIN_PASSWORD))) return json({ ok: false, error: "Code incorrect" }, 401, env);
        const token = await signToken(env.ADMIN_TOKEN_SECRET, { exp: Date.now() + 12 * 3600 * 1000 });
        return json({ ok: true, token }, 200, env);
      }

      /* ══════════════ Routes protégées ══════════════ */
      if (pathname.startsWith("/api/admin/")) {
        if (!(await requireAdmin(request, env))) return json({ ok: false, error: "Non autorisé" }, 401, env);
        const res = segs[2];
        const id = segs[3] ? parseInt(segs[3], 10) : null;
        if (segs[3] && !Number.isInteger(id)) return json({ ok: false, error: "Identifiant invalide" }, 400, env);

        /* Tableau de bord */
        if (res === "overview" && m === "GET") {
          const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
          const now = Date.now();
          const startCur = isoDay(now - (days - 1) * 86400000);
          const startPrev = isoDay(now - (2 * days - 1) * 86400000);
          const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
          const cf0 = await env.DB.prepare("SELECT features, extras FROM config WHERE id = 1").first();
          const feat = parseFeatures(cf0.features), ex = parseExtras(cf0.extras);
          const relBefore = new Date(now - ex.relance_jours * 86400000).toISOString();
          const [ev, dv, ct, rd, top, src, newD, newC, cnt, nextRdv, cfgR, stripeN, fails, relL, relN, cnt2, pages] = await env.DB.batch([
            q("SELECT jour, type, COUNT(*) c FROM events WHERE jour >= ? GROUP BY jour, type", startPrev),
            q("SELECT substr(created_at,1,10) j, COUNT(*) c FROM devis WHERE substr(created_at,1,10) >= ? GROUP BY j", startPrev),
            q("SELECT substr(created_at,1,10) j, COUNT(*) c FROM contacts WHERE substr(created_at,1,10) >= ? GROUP BY j", startPrev),
            q("SELECT substr(created_at,1,10) j, COUNT(*) c FROM rdv WHERE substr(created_at,1,10) >= ? AND statut = 'confirme' GROUP BY j", startPrev),
            q("SELECT label, COUNT(*) c FROM events WHERE type = 'buy_click' AND jour >= ? GROUP BY label ORDER BY c DESC LIMIT 5", startCur),
            q("SELECT label, COUNT(*) c FROM events WHERE type = 'view' AND jour >= ? GROUP BY label ORDER BY c DESC LIMIT 5", startCur),
            q("SELECT id, created_at, nom, prestation, estimation_min, estimation_max, mode FROM devis WHERE statut = 'nouveau' ORDER BY created_at DESC LIMIT 5"),
            q("SELECT id, created_at, nom, message FROM contacts WHERE statut = 'nouveau' ORDER BY created_at DESC LIMIT 5"),
            q("SELECT (SELECT COUNT(*) FROM devis WHERE statut='nouveau') d, (SELECT COUNT(*) FROM contacts WHERE statut='nouveau') c"),
            q("SELECT * FROM rdv WHERE statut = 'confirme' AND debut >= ? ORDER BY debut ASC LIMIT 5", new Date(now).toISOString()),
            q("SELECT pro_email, formspree_id, cal_link FROM config WHERE id = 1"),
            q("SELECT COUNT(*) n FROM prestations WHERE stripe_url != '' AND actif = 1"),
            q("SELECT COUNT(*) n FROM devis WHERE email_statut = 'echec' AND created_at >= ?", new Date(now - 30 * 86400000).toISOString()),
            q("SELECT id, created_at, nom, email, prestation FROM devis WHERE statut IN ('nouveau','en_cours') AND relance_le = '' AND created_at <= ? ORDER BY created_at ASC LIMIT 5", relBefore),
            q("SELECT COUNT(*) n FROM devis WHERE statut IN ('nouveau','en_cours') AND relance_le = '' AND created_at <= ?", relBefore),
            q("SELECT (SELECT COUNT(*) FROM avis WHERE actif = 1) a, (SELECT COUNT(*) FROM galerie WHERE actif = 1) g, (SELECT COUNT(*) FROM faq WHERE actif = 1) f"),
            q("SELECT label, COUNT(*) c FROM events WHERE type = 'page' AND jour >= ? GROUP BY label ORDER BY c DESC LIMIT 8", startCur),
          ]);
          let contactFails = 0; // colonnes ajoutées plus tard : on tolère leur absence
          try { contactFails = (await env.DB.prepare("SELECT COUNT(*) n FROM contacts WHERE (email_statut = 'echec' OR client_email_statut = 'echec') AND created_at >= ?").bind(new Date(now - 30 * 86400000).toISOString()).first()).n || 0; } catch { /* ignoré */ }

          const labels = [], idx = {};
          for (let i = days - 1; i >= 0; i--) { const j = isoDay(now - i * 86400000); idx[j] = labels.length; labels.push(j); }
          const mk = () => new Array(days).fill(0);
          const series = { visites: mk(), devis: mk(), messages: mk() };
          const cur = { visites: 0, sim_start: 0, achats: 0, devis: 0, messages: 0, rdv: 0, wa: 0 };
          const prev = { visites: 0, sim_start: 0, achats: 0, devis: 0, messages: 0, rdv: 0, wa: 0 };
          const put = (key, j, c, serie) => {
            if (j >= startCur) { cur[key] += c; if (serie && idx[j] !== undefined) series[serie][idx[j]] += c; } else prev[key] += c;
          };
          ev.results.forEach((r) => {
            if (r.type === "view") put("visites", r.jour, r.c, "visites");
            else if (r.type === "sim_start") put("sim_start", r.jour, r.c);
            else if (r.type === "buy_click") put("achats", r.jour, r.c);
            else if (r.type === "wa_click") put("wa", r.jour, r.c);
          });
          dv.results.forEach((r) => put("devis", r.j, r.c, "devis"));
          ct.results.forEach((r) => put("messages", r.j, r.c, "messages"));
          rd.results.forEach((r) => put("rdv", r.j, r.c));
          const c0 = cfgR.results[0];
          return json({
            ok: true, days, labels, series, cur, prev, features: feat,
            a_relancer: { n: relN.results[0].n, jours: ex.relance_jours, liste: relL.results }, contenu: cnt2.results[0],
            top_produits: top.results, sources: src.results, top_pages: pages.results,
            a_traiter: { devis: newD.results, contacts: newC.results, nb_devis: cnt.results[0].d, nb_contacts: cnt.results[0].c },
            rdv_a_venir: nextRdv.results,
            setup: {
              resend_key: !!env.RESEND_API_KEY, resend_from_test: /onboarding@resend\.dev/i.test(env.RESEND_FROM || "onboarding@resend.dev"),
              pro_email: !!c0.pro_email && !/votre-entreprise/.test(c0.pro_email), formspree: !!c0.formspree_id, cal: !!normalizeCal(c0.cal_link),
              cal_webhook: !!env.CAL_WEBHOOK_KEY, stripe_produits: stripeN.results[0].n, emails_en_echec: fails.results[0].n + contactFails,
            },
          }, 200, env);
        }

        /* Réglages */
        if (res === "config" && m === "GET") {
          const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
          const { sim_config, features, extras, ...rest } = cfg;
          return json({ ok: true, config: { ...rest, sim: parseSim(sim_config), features: parseFeatures(features), extras: parseExtras(extras) } }, 200, env);
        }
        if (res === "config" && m === "POST") {
          const c = await readBody(request);
          const pro = clean(c.pro_email || c.email_contact, 150);
          if (!emailOk(pro)) return json({ ok: false, error: "Email de réception invalide" }, 400, env);
          const color = /^#[0-9a-f]{6}$/i.test(c.couleur_primaire || "") ? c.couleur_primaire : "#FF5A2B";
          const sim = parseSim(c.sim);
          const old = await env.DB.prepare("SELECT features, extras FROM config WHERE id = 1").first();
          const feat = parseFeatures({ ...parseFeatures(old.features), ...(c.features && typeof c.features === "object" ? c.features : {}) });
          const ex = parseExtras({ ...parseExtras(old.extras), ...(c.extras && typeof c.extras === "object" ? c.extras : {}) });
          await env.DB.prepare(`UPDATE config SET nom_entreprise=?, tagline=?, description=?, couleur_primaire=?, logo_url=?, email_contact=?, telephone=?, adresse=?, pro_email=?, formspree_id=?, cal_link=?, sim_config=?, features=?, extras=? WHERE id=1`)
            .bind(clean(c.nom_entreprise, 80) || "Votre Entreprise", clean(c.tagline, 200), clean(c.description, 600), color, clean(c.logo_url, 300), clean(c.email_contact, 150), clean(c.telephone, 40), clean(c.adresse, 200), pro, normalizeFormspree(c.formspree_id), normalizeCal(c.cal_link), JSON.stringify(sim), JSON.stringify(feat), JSON.stringify(ex)).run();
          return json({ ok: true, cal_link: normalizeCal(c.cal_link), formspree_id: normalizeFormspree(c.formspree_id) }, 200, env);
        }

        /* Test d'envoi d'email */
        if (res === "test-email" && m === "POST") {
          const cfg = await env.DB.prepare("SELECT pro_email, nom_entreprise FROM config WHERE id = 1").first();
          const r = await sendResend(env, {
            to: cfg.pro_email, subject: `Test d'envoi — ${cfg.nom_entreprise}`,
            html: `<div style="font-family:Arial,sans-serif;padding:20px"><h2 style="margin:0 0 8px">✅ L'envoi d'emails fonctionne</h2><p style="color:#555">Vous recevrez vos demandes de devis à cette adresse.</p></div>`,
            text: "L'envoi d'emails fonctionne. Vous recevrez vos demandes de devis à cette adresse.",
          });
          let hint = "";
          if (!r.ok && /403|testing|own email|verify/i.test(r.detail)) hint = "Avec l'expéditeur de test onboarding@resend.dev, Resend n'envoie qu'à l'email de votre compte Resend. Utilisez cet email comme « email de réception », ou vérifiez un domaine dans Resend puis changez RESEND_FROM.";
          else if (!r.ok && /401|API key/i.test(r.detail)) hint = "La clé API Resend est refusée : recréez-en une et relancez « wrangler secret put RESEND_API_KEY ».";
          return json({ ok: r.ok, to: cfg.pro_email, detail: r.detail, hint }, 200, env);
        }

        /* Produits & prestations */
        if (res === "prestations") {
          if (m === "GET" && !id) {
            const { results } = await env.DB.prepare("SELECT * FROM prestations ORDER BY ordre ASC, id ASC").all();
            return json({ ok: true, prestations: results }, 200, env);
          }
          if ((m === "POST" && !id) || (m === "PUT" && id)) {
            const p = await readBody(request);
            const stripe = httpsOrEmpty(p.stripe_url);
            if (stripe === null) return json({ ok: false, error: "Le lien Stripe doit commencer par https://" }, 400, env);
            if (!clean(p.titre, 120)) return json({ ok: false, error: "Le titre est obligatoire" }, 400, env);
            const pb = p.prix_base === "" || p.prix_base == null ? null : Math.max(0, Number(p.prix_base)) || null;
            const vals = [clean(p.titre, 120), clean(p.description, 800), clean(p.prix_affiche, 60) || "Sur devis", clean(p.image_url, 300), Math.round(Number(p.ordre)) || 0, p.actif ? 1 : 0, stripe, clean(p.bouton_label, 30), clean(p.badge, 24), pb];
            if (m === "POST") {
              const r = await env.DB.prepare(`INSERT INTO prestations (titre, description, prix_affiche, image_url, ordre, actif, stripe_url, bouton_label, badge, prix_base) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run();
              return json({ ok: true, id: r.meta.last_row_id }, 200, env);
            }
            await env.DB.prepare(`UPDATE prestations SET titre=?, description=?, prix_affiche=?, image_url=?, ordre=?, actif=?, stripe_url=?, bouton_label=?, badge=?, prix_base=? WHERE id=?`).bind(...vals, id).run();
            return json({ ok: true }, 200, env);
          }
          if (m === "DELETE" && id) { await env.DB.prepare("DELETE FROM prestations WHERE id=?").bind(id).run(); return json({ ok: true }, 200, env); }
        }

        /* Blog */
        if (res === "articles") {
          if (m === "GET" && !id) {
            const { results } = await env.DB.prepare("SELECT * FROM articles ORDER BY date_publication DESC").all();
            return json({ ok: true, articles: results }, 200, env);
          }
          if ((m === "POST" && !id) || (m === "PUT" && id)) {
            const a = await readBody(request);
            if (!clean(a.titre, 160)) return json({ ok: false, error: "Le titre est obligatoire" }, 400, env);
            let slug = slugify(a.slug || a.titre);
            const vals = [clean(a.titre, 160), slug, clean(a.extrait, 400), clean(a.contenu, 20000), clean(a.image_url, 300), a.date_publication || new Date().toISOString(), a.publie ? 1 : 0];
            try {
              if (m === "POST") {
                const r = await env.DB.prepare(`INSERT INTO articles (titre, slug, extrait, contenu, image_url, date_publication, publie) VALUES (?,?,?,?,?,?,?)`).bind(...vals).run();
                return json({ ok: true, id: r.meta.last_row_id, slug }, 200, env);
              }
              await env.DB.prepare(`UPDATE articles SET titre=?, slug=?, extrait=?, contenu=?, image_url=?, date_publication=?, publie=? WHERE id=?`).bind(...vals, id).run();
              return json({ ok: true, slug }, 200, env);
            } catch (e) {
              if (/UNIQUE/i.test(e.message)) return json({ ok: false, error: "Un article porte déjà un titre très proche : modifiez légèrement le titre." }, 400, env);
              throw e;
            }
          }
          if (m === "DELETE" && id) { await env.DB.prepare("DELETE FROM articles WHERE id=?").bind(id).run(); return json({ ok: true }, 200, env); }
        }

        /* Devis */
        if (res === "devis") {
          if (m === "GET" && !id) {
            const { results } = await env.DB.prepare("SELECT * FROM devis ORDER BY created_at DESC LIMIT 500").all();
            return json({ ok: true, devis: results }, 200, env);
          }
          if (m === "PUT" && id) {
            const b = await readBody(request);
            if (b.relance) { await env.DB.prepare("UPDATE devis SET relance_le = ? WHERE id = ?").bind(new Date().toISOString(), id).run(); return json({ ok: true }, 200, env); }
            if (!STATUTS_DEVIS.includes(b.statut)) return json({ ok: false, error: "Statut invalide" }, 400, env);
            await env.DB.prepare("UPDATE devis SET statut = ?, note = ? WHERE id = ?").bind(b.statut, clean(b.note, 2000), id).run();
            return json({ ok: true }, 200, env);
          }
          if (m === "DELETE" && id) { await env.DB.prepare("DELETE FROM devis WHERE id=?").bind(id).run(); return json({ ok: true }, 200, env); }
        }

        /* Messages de contact */
        if (res === "contacts") {
          if (m === "GET" && !id) {
            const { results } = await env.DB.prepare("SELECT * FROM contacts ORDER BY created_at DESC LIMIT 500").all();
            return json({ ok: true, contacts: results }, 200, env);
          }
          if (m === "PUT" && id) {
            const b = await readBody(request);
            if (!STATUTS_CONTACT.includes(b.statut)) return json({ ok: false, error: "Statut invalide" }, 400, env);
            await env.DB.prepare("UPDATE contacts SET statut = ? WHERE id = ?").bind(b.statut, id).run();
            return json({ ok: true }, 200, env);
          }
          if (m === "DELETE" && id) { await env.DB.prepare("DELETE FROM contacts WHERE id=?").bind(id).run(); return json({ ok: true }, 200, env); }
        }

        /* Rendez-vous */
        if (res === "rdv" && m === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM rdv ORDER BY debut DESC LIMIT 200").all();
          return json({ ok: true, rdv: results }, 200, env);
        }

        /* PDF d'un devis (toujours disponible pour le pro) */
        if (res === "devis" && id && segs[4] === "pdf" && m === "GET") {
          const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
          const row = await env.DB.prepare("SELECT * FROM devis WHERE id = ?").bind(id).first();
          if (!row) return json({ ok: false, error: "Devis introuvable" }, 404, env);
          return pdfResponse(buildDevisPdf(row, cfg, parseExtras(cfg.extras)), devisNumero(row), env);
        }

        /* Newsletter : abonnés + envoi de campagnes */
        if (res === "abonnes") {
          if (m === "GET" && !id) {
            const { results } = await env.DB.prepare("SELECT id, email, created_at, consent_at, source, lang, actif FROM abonnes ORDER BY created_at DESC LIMIT 5000").all();
            return json({ ok: true, items: results }, 200, env);
          }
          if (m === "POST" && !id) {
            const b = await readBody(request); const email = clean(b.email, 150).toLowerCase();
            if (!emailOk(email)) return json({ ok: false, error: "Adresse email invalide" }, 400, env);
            if (b.consent !== true) return json({ ok: false, error: "Confirmez que cette personne a accepté de recevoir vos emails" }, 400, env);
            const now = new Date().toISOString();
            await env.DB.prepare("INSERT INTO abonnes (email, created_at, consent_at, source, lang, token, actif) VALUES (?,?,?,?,?,?,1) ON CONFLICT(email) DO UPDATE SET actif = 1")
              .bind(email, now, now, "ajout manuel", "fr", crypto.randomUUID().replace(/-/g, "")).run();
            return json({ ok: true }, 200, env);
          }
          if (m === "DELETE" && id) { await env.DB.prepare("DELETE FROM abonnes WHERE id = ?").bind(id).run(); return json({ ok: true }, 200, env); }
        }
        if (res === "campagnes") {
          if (m === "GET") {
            const { results } = await env.DB.prepare("SELECT id, created_at, sujet, nb_dest, nb_ok, statut, detail FROM campagnes ORDER BY id DESC LIMIT 30").all();
            return json({ ok: true, items: results }, 200, env);
          }
          if (m === "POST") {
            const b = await readBody(request);
            const sujet = clean(b.sujet, 150), corps = clean(b.corps, 5000);
            if (!sujet || !corps) return json({ ok: false, error: "Le sujet et le message sont obligatoires" }, 400, env);
            if (b.bouton_label && !/^https:\/\/\S+$/i.test(b.bouton_url || "")) return json({ ok: false, error: "Le lien du bouton doit commencer par https://" }, 400, env);
            const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first(), extras = parseExtras(cfg.extras);
            const base = new URL(request.url).origin;
            const camp = { sujet, corps, bouton_label: clean(b.bouton_label, 40), bouton_url: clean(b.bouton_url, 300) };
            const from = env.RESEND_FROM || "Devis <onboarding@resend.dev>";
            if (!env.RESEND_API_KEY) return json({ ok: false, error: "Clé RESEND_API_KEY absente." }, 400, env);

            if (b.test) { // aperçu : envoi au pro uniquement
              const e = newsletterEmail(cfg, extras, camp, base + "/api/unsubscribe?t=apercu");
              const r = await sendResend(env, { to: cfg.pro_email, subject: "[TEST] " + sujet, html: e.html, text: e.text });
              return json({ ok: r.ok, error: r.ok ? undefined : r.detail, sent: r.ok ? 1 : 0 }, r.ok ? 200 : 502, env);
            }
            const { results: subs } = await env.DB.prepare("SELECT email, token FROM abonnes WHERE actif = 1 ORDER BY id LIMIT 1000").all();
            if (!subs.length) return json({ ok: false, error: "Aucun abonné actif pour le moment." }, 400, env);
            let ok = 0, detail = "";
            for (let i = 0; i < subs.length; i += 100) {
              const chunk = subs.slice(i, i + 100).map((x) => {
                const u = `${base}/api/unsubscribe?t=${x.token}`, e = newsletterEmail(cfg, extras, camp, u);
                return { from, to: [x.email], subject: sujet, html: e.html, text: e.text, headers: { "List-Unsubscribe": `<${u}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
              });
              try {
                const r = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(chunk) });
                if (r.ok) ok += chunk.length; else { const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { /* ignore */ } detail = `Resend ${r.status} : ${j.message || t}`.slice(0, 300); break; }
              } catch (e) { detail = "Réseau : " + e.message; break; }
            }
            const statut = ok === subs.length ? "envoye" : ok > 0 ? "partiel" : "echec";
            await env.DB.prepare("INSERT INTO campagnes (created_at, sujet, corps, nb_dest, nb_ok, statut, detail) VALUES (?,?,?,?,?,?,?)").bind(new Date().toISOString(), sujet, corps, subs.length, ok, statut, detail).run();
            return json({ ok: ok > 0, sent: ok, total: subs.length, error: detail || undefined }, ok > 0 ? 200 : 502, env);
          }
        }

        /* Sauvegarde complète des données (JSON) */
        if (res === "export" && m === "GET") {
          const tables = ["prestations", "articles", "devis", "contacts", "rdv", "avis", "galerie", "faq", "abonnes", "campagnes"];
          const out = { exporte_le: new Date().toISOString() };
          const cfg = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
          out.config = { ...cfg, features: parseFeatures(cfg.features), extras: parseExtras(cfg.extras), sim_config: parseSim(cfg.sim_config) };
          for (const t of tables) out[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
          return json({ ok: true, data: out }, 200, env);
        }

        /* Avis clients, galerie, FAQ (même logique pour les trois) */
        const CRUD = {
          avis: { cols: ["auteur", "texte", "note", "source", "ordre", "actif"], order: "ordre ASC, id DESC", make: (p) => {
            const auteur = clean(p.auteur, 80), texte = clean(p.texte, 700);
            if (!auteur || !texte) return "Le prénom et l'avis sont obligatoires";
            return [auteur, texte, Math.min(5, Math.max(1, Math.round(Number(p.note)) || 5)), clean(p.source, 40), Math.round(Number(p.ordre)) || 0, p.actif ? 1 : 0];
          } },
          galerie: { cols: ["titre", "legende", "image_url", "image_apres_url", "ordre", "actif"], order: "ordre ASC, id DESC", make: (p) => {
            if (!clean(p.image_url, 300)) return "Ajoutez une photo";
            return [clean(p.titre, 80), clean(p.legende, 200), clean(p.image_url, 300), clean(p.image_apres_url, 300), Math.round(Number(p.ordre)) || 0, p.actif ? 1 : 0];
          } },
          faq: { cols: ["question", "reponse", "ordre", "actif"], order: "ordre ASC, id ASC", make: (p) => {
            const qn = clean(p.question, 200), rp = clean(p.reponse, 1500);
            if (!qn || !rp) return "La question et la réponse sont obligatoires";
            return [qn, rp, Math.round(Number(p.ordre)) || 0, p.actif ? 1 : 0];
          } },
        };
        if (CRUD[res]) {
          const T = CRUD[res];
          if (m === "GET" && !id) {
            const { results } = await env.DB.prepare(`SELECT * FROM ${res} ORDER BY ${T.order}`).all();
            return json({ ok: true, items: results }, 200, env);
          }
          if ((m === "POST" && !id) || (m === "PUT" && id)) {
            const vals = T.make(await readBody(request));
            if (typeof vals === "string") return json({ ok: false, error: vals }, 400, env);
            if (m === "POST") {
              const r = await env.DB.prepare(`INSERT INTO ${res} (${T.cols.join(", ")}) VALUES (${T.cols.map(() => "?").join(",")})`).bind(...vals).run();
              return json({ ok: true, id: r.meta.last_row_id }, 200, env);
            }
            await env.DB.prepare(`UPDATE ${res} SET ${T.cols.map((c) => c + "=?").join(", ")} WHERE id=?`).bind(...vals, id).run();
            return json({ ok: true }, 200, env);
          }
          if (m === "DELETE" && id) { await env.DB.prepare(`DELETE FROM ${res} WHERE id=?`).bind(id).run(); return json({ ok: true }, 200, env); }
        }

        /* Upload d'image vers R2 */
        if (res === "upload" && m === "POST") {
          if (!env.IMAGES) return json({ ok: false, error: "Le stockage d'images (R2) n'est pas activé sur ce site." }, 400, env);
          const form = await request.formData();
          const file = form.get("file");
          if (!file || typeof file === "string") return json({ ok: false, error: "Aucun fichier reçu" }, 400, env);
          const ext = IMG_TYPES[file.type];
          if (!ext) return json({ ok: false, error: "Format non accepté (JPG, PNG, WebP, GIF ou AVIF)" }, 400, env);
          if (file.size > 5 * 1024 * 1024) return json({ ok: false, error: "Image trop lourde (5 Mo maximum)" }, 400, env);
          const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
          return json({ ok: true, url: `/images/${key}` }, 200, env);
        }
      }

      return json({ ok: false, error: "Not found" }, 404, env);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500, env);
    }
  },
};
