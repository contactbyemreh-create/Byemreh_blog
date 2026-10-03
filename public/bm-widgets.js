/* ByEmreh — fonctions du site (chargé seulement si au moins une fonction est activée dans /pro).
   Chaque fonction s'affiche UNIQUEMENT si son interrupteur est allumé dans « Fonctions du site ».
   Sur l'accueil, les sections s'insèrent automatiquement avant le formulaire de contact.
   Pour en placer une ailleurs : <div data-bm="faq"></div> (avis, galerie, faq, horaires, apropos, produits, simulateur, rdv). */
(function () {
  'use strict';
  var BM = window.BM || {};
  var track = BM.track || function () {};
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f'); };
  var isHome = /^\/(index\.html)?$/.test(location.pathname);
  var D = null, F = {}, X = {}, C = {};

  /* ───────── Styles (reprennent les couleurs et polices du site) ───────── */
  var CSS = ''
    + '.bm-sec{padding:5.5rem 1.4rem;position:relative}.bm-sec.alt{background:var(--paper-dim,#EDEAE0)}.bm-in{max-width:1080px;margin:0 auto}'
    + '.bm-head{text-align:center;margin-bottom:2.4rem}.bm-lab{font-family:var(--ff-mono,monospace);font-size:.72rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--signal,#0E7C66);margin-bottom:.9rem}'
    + '.bm-h{font-family:var(--ff-disp,Georgia,serif);font-size:clamp(1.8rem,4vw,2.6rem);font-weight:600;letter-spacing:-.02em;line-height:1.15;color:var(--ink,#0B0C10);margin:0}.bm-sub{color:var(--muted,#6B6A74);margin:.8rem auto 0;max-width:560px;line-height:1.6}'
    + '.bm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,340px));justify-content:center;gap:1.2rem}'
    + '.bm-card{background:#fff;border:1.5px solid var(--border,#E3DFD3);border-radius:20px;padding:1.4rem;display:flex;flex-direction:column;gap:.7rem;color:var(--ink,#0B0C10)}'
    + '.bm-card h3{font-family:var(--ff-disp,Georgia,serif);font-size:1.15rem;margin:0}.bm-card p{color:var(--muted,#6B6A74);font-size:.92rem;line-height:1.6;margin:0;flex:1;white-space:pre-line}'
    + '.bm-card img.bm-th{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px;background:var(--paper-dim,#EDEAE0)}.bm-price{font-weight:800;font-size:1.05rem}.bm-badge{align-self:flex-start;background:var(--signal-lt,#E1F3EE);color:var(--signal,#0E7C66);font-size:.72rem;font-weight:700;padding:.2rem .65rem;border-radius:99px}'
    + '.bm-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.8rem 1.6rem;border-radius:99px;border:1.5px solid transparent;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;text-decoration:none;background:var(--signal,#0E7C66);color:#fff;transition:filter .2s}.bm-btn:hover{filter:brightness(1.08)}.bm-btn:disabled{opacity:.6;cursor:default}'
    + '.bm-btn.sec{background:transparent;color:var(--ink,#0B0C10);border-color:var(--border,#E3DFD3)}.bm-btn.dark{background:var(--ink,#0B0C10)}'
    + '.bm-stars{color:var(--gold,#C9A227);letter-spacing:.08em;white-space:nowrap}.bm-avgl{text-align:center;color:var(--muted,#6B6A74);font-weight:600;margin:-1rem 0 2rem}.bm-avgl .bm-stars{font-size:1.25rem;margin-right:.4rem}'
    + '.bm-card footer{display:flex;justify-content:space-between;gap:.6rem;font-size:.82rem;color:var(--muted,#6B6A74)}.bm-card footer b{color:var(--ink,#0B0C10)}'
    + '.bm-gal{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,330px));justify-content:center;gap:1rem}.bm-gi{position:relative;border:0;padding:0;background:var(--paper-dim,#EDEAE0);border-radius:16px;overflow:hidden;cursor:zoom-in;aspect-ratio:4/3;text-align:left}'
    + '.bm-gi img{width:100%;height:100%;object-fit:cover;transition:transform .4s}.bm-gi:hover img{transform:scale(1.05)}.bm-gi .ba{display:grid;grid-template-columns:1fr 1fr;height:100%;gap:2px}.bm-gi .ba div{position:relative;overflow:hidden}'
    + '.bm-gi .tg{position:absolute;left:.5rem;top:.5rem;background:rgba(0,0,0,.62);color:#fff;font-size:.68rem;font-weight:700;padding:.15rem .5rem;border-radius:99px}.bm-gi .cp{position:absolute;left:0;right:0;bottom:0;padding:1.6rem .9rem .7rem;background:linear-gradient(transparent,rgba(0,0,0,.62));color:#fff;font-size:.82rem;font-weight:600}'
    + '.bm-lb{position:fixed;inset:0;z-index:10000;background:rgba(10,12,16,.9);display:none;align-items:center;justify-content:center;flex-direction:column;gap:.8rem;padding:1rem;overflow:auto}.bm-lb.on{display:flex}.bm-lb img{max-width:min(92vw,980px);max-height:72vh;border-radius:12px;object-fit:contain}'
    + '.bm-lb .pr{display:flex;gap:.8rem;flex-wrap:wrap;justify-content:center}.bm-lb figure{margin:0;text-align:center;color:#fff;font-size:.8rem}.bm-lb .pr img{max-width:min(44vw,480px)}.bm-lb p{color:#fff;font-weight:600;text-align:center;max-width:600px;margin:0}.bm-lb .x{position:absolute;top:.9rem;right:.9rem;width:42px;height:42px;border-radius:50%;border:0;background:#fff;font-size:1.1rem;cursor:pointer}'
    + '.bm-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:.6rem}.bm-faq details{background:#fff;border:1.5px solid var(--border,#E3DFD3);border-radius:14px;padding:0 1.1rem}.bm-faq summary{list-style:none;cursor:pointer;padding:1rem 0;font-weight:700;display:flex;justify-content:space-between;gap:1rem;align-items:center}'
    + '.bm-faq summary::-webkit-details-marker{display:none}.bm-faq summary::after{content:"+";font-size:1.4rem;color:var(--signal,#0E7C66);line-height:1;transition:transform .2s}.bm-faq details[open] summary::after{transform:rotate(45deg)}.bm-faq details p{padding:0 0 1.1rem;color:var(--muted,#6B6A74);margin:0;line-height:1.7;white-space:pre-line}'
    + '.bm-about{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:2.4rem;align-items:center;max-width:1000px;margin:0 auto}.bm-about.solo{grid-template-columns:minmax(0,680px);justify-content:center;text-align:center}'
    + '.bm-about img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:22px}.bm-about p{color:var(--muted,#6B6A74);line-height:1.75;white-space:pre-line;margin:1rem 0 0}.bm-stats{display:flex;gap:1.6rem;flex-wrap:wrap;margin-top:1.5rem}.bm-about.solo .bm-stats{justify-content:center}'
    + '.bm-stat b{display:block;font-family:var(--ff-disp,Georgia,serif);font-size:2rem;color:var(--signal,#0E7C66);line-height:1.1}.bm-stat span{font-size:.82rem;color:var(--muted,#6B6A74);font-weight:600}@media(max-width:760px){.bm-about{grid-template-columns:1fr}}'
    + '.bm-info{display:grid;grid-template-columns:1fr 1.2fr;gap:1.6rem;max-width:980px;margin:0 auto}.bm-info.solo{grid-template-columns:minmax(0,520px);justify-content:center}@media(max-width:760px){.bm-info{grid-template-columns:1fr}}'
    + '.bm-hours{background:#fff;border:1.5px solid var(--border,#E3DFD3);border-radius:18px;padding:1.3rem 1.4rem}.bm-open{display:inline-flex;align-items:center;gap:.45rem;font-weight:700;font-size:.85rem;padding:.3rem .8rem;border-radius:99px;margin-bottom:.9rem}.bm-open i{width:9px;height:9px;border-radius:50%;background:currentColor}'
    + '.bm-open.on{background:#E6F6EC;color:#1a7a3c}.bm-open.off{background:#FDECEA;color:#C0392B}.bm-hr{display:flex;justify-content:space-between;gap:1rem;padding:.42rem 0;border-top:1px solid var(--border,#E3DFD3);font-size:.9rem;color:var(--muted,#6B6A74)}.bm-hr.td{color:var(--ink,#0B0C10);font-weight:700}.bm-hr.f{border-top:0}'
    + '.bm-map{border:1.5px solid var(--border,#E3DFD3);border-radius:18px;overflow:hidden;min-height:300px;background:var(--paper-dim,#EDEAE0);display:grid;place-items:center;text-align:center;padding:1.2rem;color:var(--muted,#6B6A74);font-size:.88rem;gap:.7rem;align-content:center}.bm-map iframe{width:100%;height:100%;min-height:300px;border:0;display:block}'
    + '.bm-sim{max-width:620px;margin:0 auto;background:#fff;border:1.5px solid var(--border,#E3DFD3);border-radius:24px;padding:1.6rem;color:var(--ink,#0B0C10)}.bm-top{display:flex;align-items:center;gap:1rem;font-size:.8rem;font-weight:700;color:var(--muted,#6B6A74);margin-bottom:1.3rem}'
    + '.bm-bar{flex:1;height:6px;border-radius:99px;background:var(--paper-dim,#EDEAE0);overflow:hidden}.bm-bar i{display:block;height:100%;width:25%;background:var(--signal,#0E7C66);transition:width .3s}.bm-step{display:none}.bm-step.on{display:block}.bm-step h3{font-family:var(--ff-disp,Georgia,serif);font-size:1.3rem;margin:0 0 1rem;outline:0}'
    + '.bm-ch{display:flex;align-items:center;gap:.8rem;width:100%;text-align:left;border:1.5px solid var(--border,#E3DFD3);background:#fff;border-radius:14px;padding:.85rem 1rem;margin-bottom:.6rem;font:inherit;color:inherit;cursor:pointer}.bm-ch[aria-checked=true],.bm-op[aria-checked=true]{border-color:var(--signal,#0E7C66);background:var(--signal-lt,#E1F3EE)}'
    + '.bm-ch .r,.bm-op .k{width:18px;height:18px;border:2px solid var(--border,#E3DFD3);flex-shrink:0}.bm-ch .r{border-radius:50%}.bm-op .k{border-radius:5px}.bm-ch[aria-checked=true] .r,.bm-op[aria-checked=true] .k{border-color:var(--signal,#0E7C66);background:var(--signal,#0E7C66);box-shadow:inset 0 0 0 3px #fff}'
    + '.bm-ch small,.bm-op .pp{margin-left:auto;color:var(--muted,#6B6A74);font-weight:600;white-space:nowrap}.bm-op{display:flex;align-items:center;gap:.8rem;width:100%;text-align:left;border:1.5px solid var(--border,#E3DFD3);background:#fff;border-radius:14px;padding:.8rem 1rem;margin-bottom:.6rem;font:inherit;color:inherit;cursor:pointer}'
    + '.bm-op .tx strong{display:block;font-size:.92rem}.bm-op .tx span{font-size:.8rem;color:var(--muted,#6B6A74)}.bm-qty{font-size:2.4rem;font-weight:800;text-align:center;margin:.4rem 0}.bm-qty small{font-size:1rem;color:var(--muted,#6B6A74);font-weight:600}'
    + '.bm-sim input[type=range]{width:100%;accent-color:var(--signal,#0E7C66)}.bm-mm{display:flex;justify-content:space-between;font-size:.78rem;color:var(--muted,#6B6A74)}.bm-hint{color:var(--muted,#6B6A74);font-size:.88rem;margin:.4rem 0 1rem}'
    + '.bm-res{background:var(--signal-lt,#E1F3EE);border-radius:16px;padding:1.2rem;text-align:center;margin-bottom:1.1rem}.bm-res small{display:block;color:var(--muted,#6B6A74);font-weight:600}.bm-rp{font-family:var(--ff-disp,Georgia,serif);font-size:2.1rem;font-weight:700;color:var(--signal,#0E7C66)}.bm-rc{font-size:.85rem;color:var(--muted,#6B6A74)}'
    + '.bm-fl{display:block;font-size:.8rem;font-weight:700;margin:.7rem 0 .25rem}.bm-in2{width:100%;padding:.75rem .9rem;border:1.5px solid var(--border,#E3DFD3);border-radius:12px;font:inherit;background:#fff;color:inherit}.bm-2c{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}@media(max-width:520px){.bm-2c{grid-template-columns:1fr}}'
    + '.bm-acts{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem}.bm-msg{min-height:1.2rem;margin-top:.7rem;font-size:.88rem;font-weight:600;color:#B42318}.bm-ok{color:#1a7a3c;font-weight:700;font-size:.82rem}.bm-ko{color:#B42318;font-weight:600;font-size:.82rem}.bm-hp{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0,0,0,0);pointer-events:none}'
    + '.bm-cal{border:1.5px solid var(--border,#E3DFD3);border-radius:20px;overflow:hidden;background:#fff;max-width:900px;margin:0 auto;min-height:620px}.bm-cal iframe{width:100%;height:640px;border:0;display:block}.bm-fb{text-align:center;font-size:.85rem;color:var(--muted,#6B6A74);margin-top:.8rem}.bm-fb a{color:var(--signal,#0E7C66);font-weight:700}'
    + '#bm-bars{position:fixed;top:0;left:0;right:0;z-index:101;display:flex;flex-direction:column}.bm-bar1{display:flex;gap:.7rem;align-items:center;justify-content:center;flex-wrap:wrap;padding:.5rem 2.6rem .5rem 1rem;font-size:.84rem;font-weight:600;text-align:center;background:var(--signal,#0E7C66);color:#fff;position:relative}'
    + '.bm-bar1.red{background:#B42318}.bm-bar1 code{background:rgba(255,255,255,.22);padding:.12rem .55rem;border-radius:8px;font-weight:700;letter-spacing:.04em;font-family:inherit}.bm-bar1 button{background:#fff;color:var(--ink,#0B0C10);border:0;border-radius:99px;padding:.22rem .8rem;font-weight:700;font-size:.76rem;cursor:pointer}'
    + '.bm-bar1 .cl{position:absolute;right:.6rem;top:50%;transform:translateY(-50%);background:none;color:#fff;font-size:1.1rem;padding:.2rem .5rem}body.bm-hasbar{padding-top:var(--bm-bar,0)}body.bm-hasbar nav{top:calc(14px + var(--bm-bar,0px)) !important}'
    + '.bm-wa{position:fixed;right:1.1rem;bottom:1.1rem;z-index:130;width:58px;height:58px;border-radius:50%;background:#25D366;display:grid;place-items:center;box-shadow:0 12px 28px -8px rgba(37,211,102,.7)}.bm-wa svg{width:30px;height:30px;fill:#fff}@media(max-width:820px){.bm-wa{bottom:5.4rem}}'
    + '.bm-soc{margin-top:.8rem;display:flex;flex-wrap:wrap;gap:.45rem;justify-content:center}.bm-soc a{display:inline-flex;padding:.3rem .8rem;border:1px solid currentColor;border-radius:99px;font-size:.8rem;font-weight:700;text-decoration:none;opacity:.85}.bm-soc a:hover{opacity:1}.bm-soc a.g{background:#FFF7E0;color:#8A5A00;border-color:#F3D9A4;opacity:1}';

  /* ───────── Outils d'affichage ───────── */
  function head(label, title, sub) { return '<div class="bm-head"><div class="bm-lab">' + esc(label) + '</div><h2 class="bm-h">' + title + '</h2>' + (sub ? '<p class="bm-sub">' + esc(sub) + '</p>' : '') + '</div>'; }
  var ORDER = ['produits', 'simulateur', 'galerie', 'avis', 'rdv', 'apropos', 'faq', 'horaires'];
  var ALT = { avis: 1, horaires: 1, faq: 0 };
  function mount(key, html) {
    var host = document.querySelector('[data-bm="' + key + '"]');
    if (host) { host.innerHTML = html; return host; }
    if (!isHome) return null;
    var s = document.createElement('section'); s.id = 'bm-' + key; s.className = 'bm-sec' + (ALT[key] ? ' alt' : ''); s.innerHTML = '<div class="bm-in">' + html + '</div>';
    var contact = $('contact');
    if (contact && contact.parentNode) contact.parentNode.insertBefore(s, contact); else { var f = document.querySelector('footer'); if (f && f.parentNode) f.parentNode.insertBefore(s, f); else return null; }
    return s;
  }
  function stars(n) { return '★'.repeat(n) + '<span style="opacity:.3">' + '★'.repeat(5 - n) + '</span>'; }
  function imgUrl(u) { return /^https:\/\//.test(u) || u.charAt(0) === '/' ? u : ''; }
  function toast(m) { var t = document.createElement('div'); t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;left:50%;bottom:6rem;transform:translateX(-50%);background:#0B0C10;color:#fff;padding:.7rem 1.2rem;border-radius:12px;font-size:.88rem;z-index:10001'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }

  /* ───────── Produits ───────── */
  function wProduits() {
    var list = D.prestations || []; if (!list.length) return;
    mount('produits', head('Nos offres', 'Commandez en un clic ou demandez un devis') + '<div class="bm-grid">' + list.map(function (p) {
      var btn = p.stripe_url ? '<a class="bm-btn" href="' + esc(p.stripe_url) + '" target="_blank" rel="noopener noreferrer">' + esc(p.bouton_label || 'Commander') + '</a>'
        : F.simulateur ? '<button class="bm-btn sec" type="button" data-bm-quote="' + p.id + '">Demander un devis</button>' : '<a class="bm-btn sec" href="/#contact">Nous contacter</a>';
      return '<article class="bm-card" id="bm-prod-' + p.id + '">' + (p.image_url && imgUrl(p.image_url) ? '<img class="bm-th" loading="lazy" decoding="async" alt="" src="' + esc(imgUrl(p.image_url)) + '">' : '')
        + (p.badge ? '<span class="bm-badge">' + esc(p.badge) + '</span>' : '') + '<h3>' + esc(p.titre) + '</h3><p>' + esc(p.description) + '</p><div class="bm-price">' + esc(p.prix_affiche) + '</div>' + btn + '</article>';
    }).join('') + '</div>');
  }

  /* ───────── Simulateur de devis ───────── */
  var S = { prest: null, qty: 1, opts: {}, step: 1, started: false };
  function promoInfo() {
    var code = (($('bmCode') || {}).value || '').trim().toUpperCase();
    if (!F.promo || !X.promo_remise || !X.promo_code || !code) return { pct: 0, st: 'none' };
    var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    if (code === X.promo_code.toUpperCase() && (!X.promo_fin || today <= X.promo_fin)) return { pct: X.promo_remise, st: 'ok' };
    return { pct: 0, st: 'ko' };
  }
  function estimate() {
    var sim = C.sim, p = S.prest, unit = p && p.prix_base > 0 ? Number(p.prix_base) : sim.unit_price;
    var chosen = sim.options.filter(function (o) { return S.opts[o.key]; });
    var total = unit * S.qty + chosen.reduce(function (a, o) { return a + o.price; }, 0), r5 = function (x) { return Math.round(x / 5) * 5; };
    var pr = promoInfo(), k = 1 - pr.pct / 100, min = r5(Math.max(0, total * (1 + sim.range_low / 100) * k));
    return { chosen: chosen, min: min, max: Math.max(min, r5(total * (1 + sim.range_high / 100) * k)) };
  }
  function wSim() {
    var sim = C.sim, list = D.prestations || [], masque = sim.mode === 'masque';
    S.prest = list[0] || null; S.qty = sim.qty_default;
    var showPromo = F.promo && X.promo_remise > 0 && X.promo_code && !masque;
    var host = mount('simulateur', head('Devis en ligne', 'Estimez votre projet en 1 minute', masque ? 'Décrivez votre besoin en quelques clics : je vous réponds avec un prix sur mesure.' : 'Choisissez votre besoin, ajustez les options : estimation immédiate, sans engagement.')
      + '<div class="bm-sim" id="bmSim"><div class="bm-top"><span id="bmStep">Étape 1 sur 4</span><div class="bm-bar"><i id="bmFill"></i></div></div>'
      + '<div class="bm-step on" data-s="1"><h3 tabindex="-1">Quelle prestation vous intéresse ?</h3><div id="bmCh">' + (list.length ? list.map(function (p, i) { return '<button type="button" class="bm-ch" role="radio" aria-checked="' + (i === 0) + '" data-id="' + p.id + '"><span class="r"></span><span>' + esc(p.titre) + '</span><small>' + esc(p.prix_affiche) + '</small></button>'; }).join('') : '<p class="bm-hint">Aucune prestation disponible pour le moment.</p>') + '</div><div class="bm-acts"><button type="button" class="bm-btn" data-go="2">Continuer</button></div></div>'
      + '<div class="bm-step" data-s="2"><h3 tabindex="-1">Quelle quantité ?</h3><div class="bm-qty"><span id="bmQv">' + sim.qty_default + '</span> <small>' + esc(sim.unit_label) + '</small></div><input type="range" id="bmQty" min="' + sim.qty_min + '" max="' + sim.qty_max + '" value="' + sim.qty_default + '" aria-label="Quantité"><div class="bm-mm"><span>' + sim.qty_min + '</span><span>' + sim.qty_max + '</span></div><div class="bm-acts"><button type="button" class="bm-btn sec" data-go="1">Retour</button><button type="button" class="bm-btn" data-go="3">Continuer</button></div></div>'
      + '<div class="bm-step" data-s="3"><h3 tabindex="-1">Des options en plus ?</h3><p class="bm-hint">Facultatif — cochez ce qui vous intéresse.</p><div id="bmOp">' + (sim.options.length ? sim.options.map(function (o) { return '<button type="button" class="bm-op" role="checkbox" aria-checked="false" data-k="' + esc(o.key) + '"><span class="k"></span><span class="tx"><strong>' + esc(o.label) + '</strong>' + (o.desc ? '<span>' + esc(o.desc) + '</span>' : '') + '</span>' + (masque ? '' : '<span class="pp">' + (o.price >= 0 ? '+' : '') + fmt(o.price) + '€</span>') + '</button>'; }).join('') : '<p class="bm-hint">Aucune option pour cette prestation.</p>') + '</div><div class="bm-acts"><button type="button" class="bm-btn sec" data-go="2">Retour</button><button type="button" class="bm-btn" data-go="4">' + (masque ? 'Continuer' : 'Voir mon estimation') + '</button></div></div>'
      + '<div class="bm-step" data-s="4"><h3 tabindex="-1">Votre estimation</h3><div class="bm-res" id="bmRes"></div>'
      + (showPromo ? '<label class="bm-fl" for="bmCode">Code promo</label><div style="display:flex;gap:.6rem;align-items:center"><input class="bm-in2" id="bmCode" autocomplete="off" style="max-width:220px"><span id="bmPm"></span></div>' : '')
      + '<div class="bm-2c"><div><label class="bm-fl" for="bmNom">Nom</label><input class="bm-in2" id="bmNom" autocomplete="name"></div><div><label class="bm-fl" for="bmTel">Téléphone</label><input class="bm-in2" id="bmTel" type="tel" autocomplete="tel"></div></div>'
      + '<label class="bm-fl" for="bmEm">Email</label><input class="bm-in2" id="bmEm" type="email" autocomplete="email"><label class="bm-fl" for="bmMsg">Précisions (facultatif)</label><textarea class="bm-in2" id="bmMsg" rows="3"></textarea><input class="bm-hp" id="bmHp" tabindex="-1" autocomplete="off" aria-hidden="true">'
      + '<p class="bm-hint" style="margin:.6rem 0 0">Vos coordonnées servent uniquement à vous répondre au sujet de cette demande.</p><div class="bm-msg" id="bmFm" role="alert"></div><div class="bm-acts"><button type="button" class="bm-btn sec" data-go="3">Retour</button><button type="button" class="bm-btn" id="bmSend">Envoyer ma demande</button></div></div>'
      + '<div class="bm-step" data-s="5"><h3 tabindex="-1">Demande envoyée ✅</h3><div class="bm-res" id="bmDone"></div><p id="bmDt" style="color:var(--muted,#6B6A74);text-align:center"></p><div class="bm-acts" style="justify-content:center"><a class="bm-btn dark" id="bmPdf" href="#" target="_blank" rel="noopener" style="display:none">Télécharger mon estimation (PDF)</a><button type="button" class="bm-btn sec" id="bmReset">Faire une nouvelle simulation</button></div></div></div>');
    if (!host) return;
    var root = $('bmSim');
    function go(n, silent) {
      S.step = n; if (n === 4) { pf(); res(); }
      root.querySelectorAll('.bm-step').forEach(function (s) { s.classList.toggle('on', +s.dataset.s === n); });
      var sh = Math.min(n, 4); $('bmStep').textContent = n === 5 ? 'Terminé' : 'Étape ' + sh + ' sur 4'; $('bmFill').style.width = (n === 5 ? 100 : sh / 4 * 100) + '%';
      if (!silent) { var t = root.getBoundingClientRect().top; if (t < 90 || t > innerHeight * 0.55) window.scrollTo({ top: scrollY + t - 100, behavior: 'smooth' }); var h = root.querySelector('.bm-step.on h3'); if (h) h.focus({ preventScroll: true }); }
    }
    function res() {
      var e = estimate(), rc = esc(S.prest ? S.prest.titre : '—') + ' · ' + S.qty + ' ' + esc(sim.unit_label) + (e.chosen.length ? ' · ' + e.chosen.length + ' option' + (e.chosen.length > 1 ? 's' : '') : '');
      $('bmRes').innerHTML = masque ? '<small>Votre demande</small><div class="bm-rc" style="color:var(--ink,#0B0C10);font-weight:600">' + rc + '</div><div class="bm-rc">Je vous réponds avec un prix adapté.</div>' : '<small>Estimation indicative</small><div class="bm-rp">' + fmt(e.min) + '€ – ' + fmt(e.max) + '€</div><div class="bm-rc">' + rc + '</div>';
    }
    function pf() { var m = $('bmPm'); if (!m) return; var p = promoInfo(); m.className = p.st === 'ok' ? 'bm-ok' : p.st === 'ko' ? 'bm-ko' : ''; m.textContent = p.st === 'ok' ? 'Code appliqué : -' + p.pct + ' %' : p.st === 'ko' ? 'Code non valide' : ''; }
    function start() { if (!S.started) { S.started = true; track('sim_start', S.prest ? S.prest.titre : ''); } }
    root.addEventListener('click', function (e) {
      var g = e.target.closest('[data-go]'); if (g) { start(); go(+g.dataset.go); return; }
      var c = e.target.closest('.bm-ch'); if (c) { start(); S.prest = list.filter(function (p) { return p.id === +c.dataset.id; })[0] || S.prest; root.querySelectorAll('.bm-ch').forEach(function (b) { b.setAttribute('aria-checked', b === c); }); return; }
      var o = e.target.closest('.bm-op'); if (o) { start(); var k = o.dataset.k; S.opts[k] = !S.opts[k]; o.setAttribute('aria-checked', !!S.opts[k]); }
    });
    $('bmQty').addEventListener('input', function (e) { start(); S.qty = +e.target.value; $('bmQv').textContent = S.qty; });
    if ($('bmCode')) $('bmCode').addEventListener('input', function () { pf(); if (S.step === 4) res(); });
    $('bmSend').addEventListener('click', function () {
      var msg = $('bmFm'), btn = $('bmSend'), nom = $('bmNom').value.trim(), email = $('bmEm').value.trim();
      if (!nom) { msg.textContent = 'Indiquez votre nom.'; $('bmNom').focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Indiquez un email valide pour recevoir la réponse.'; $('bmEm').focus(); return; }
      btn.disabled = true; btn.textContent = 'Envoi en cours…'; msg.textContent = '';
      var opts = Object.keys(S.opts).filter(function (k) { return S.opts[k]; });
      BM.post('/api/devis', { nom: nom, email: email, tel: $('bmTel').value.trim(), message: $('bmMsg').value.trim(), website: $('bmHp').value, prestation_id: S.prest ? S.prest.id : null, prestation: S.prest ? S.prest.titre : '', quantite: S.qty, options: opts, code: $('bmCode') ? $('bmCode').value.trim() : '', lang: 'fr' })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d.ok, d: d }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.d.error || 'Erreur');
          $('bmDone').innerHTML = x.d.estimate ? '<small>Estimation indicative</small><div class="bm-rp">' + fmt(x.d.estimate.min) + '€ – ' + fmt(x.d.estimate.max) + '€</div>' : '<small>Demande enregistrée</small><div class="bm-rc" style="color:var(--ink,#0B0C10);font-weight:600">' + esc(S.prest ? S.prest.titre : '') + '</div>';
          $('bmDt').textContent = C.nom_entreprise + ' a bien reçu votre demande et vous répond à ' + email + '.';
          var pdf = $('bmPdf'); pdf.style.display = x.d.pdf_url ? '' : 'none'; if (x.d.pdf_url) pdf.href = x.d.pdf_url; go(5);
        })
        .catch(function (err) { msg.textContent = /Failed to fetch|NetworkError/.test(err.message) ? 'Connexion impossible. Vérifiez votre réseau et réessayez.' : (err.message || "L'envoi a échoué, réessayez."); })
        .then(function () { btn.disabled = false; btn.textContent = 'Envoyer ma demande'; });
    });
    $('bmReset').addEventListener('click', function () {
      ['bmNom', 'bmTel', 'bmEm', 'bmMsg', 'bmCode'].forEach(function (i) { if ($(i)) $(i).value = ''; });
      S.opts = {}; S.started = false; S.qty = sim.qty_default; $('bmQty').value = sim.qty_default; $('bmQv').textContent = sim.qty_default;
      root.querySelectorAll('.bm-op').forEach(function (b) { b.setAttribute('aria-checked', 'false'); }); pf(); go(1);
    });
    document.addEventListener('click', function (e) {
      var q = e.target.closest('[data-bm-quote]'); if (!q) return;
      var p = list.filter(function (x) { return x.id === +q.dataset.bmQuote; })[0]; if (!p) return;
      S.prest = p; root.querySelectorAll('.bm-ch').forEach(function (b) { b.setAttribute('aria-checked', +b.dataset.id === p.id); }); track('cta_click', 'produit-devis'); go(1, true);
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /* ───────── Rendez-vous (Cal.com) ───────── */
  function wRdv() {
    var l = C.cal_link; if (!l) return;
    var url = /^https?:\/\//.test(l) ? l : 'https://cal.com/' + String(l).replace(/^\/+/, '');
    var host = mount('rdv', head('Rendez-vous', 'Réservez un créneau', 'Choisissez directement le créneau qui vous arrange : la confirmation arrive par email.') + '<div class="bm-cal" id="bmCal"></div><p class="bm-fb">Le calendrier ne s\'affiche pas ? <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Ouvrir la page de réservation</a></p>');
    if (!host || !('IntersectionObserver' in window)) return;
    var box = $('bmCal'), io = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting) return; io.disconnect();
      var f = document.createElement('iframe'); f.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'embed=true&theme=light&layout=month_view'; f.title = 'Prendre rendez-vous avec ' + C.nom_entreprise; f.loading = 'lazy'; box.appendChild(f); track('cal_view', 'embed');
    }, { rootMargin: '300px' });
    io.observe(box);
  }

  /* ───────── Avis, galerie, FAQ, à propos ───────── */
  function wAvis() {
    var l = D.avis || []; if (!l.length) return;
    var avg = l.reduce(function (a, x) { return a + x.note; }, 0) / l.length;
    mount('avis', head('Avis clients', 'Ils nous font confiance') + '<div class="bm-avgl"><span class="bm-stars">' + stars(Math.round(avg)) + '</span>' + String(avg.toFixed(1)).replace('.', ',') + ' / 5 · ' + l.length + ' avis</div><div class="bm-grid">'
      + l.map(function (a) { return '<article class="bm-card"><span class="bm-stars">' + stars(a.note) + '</span><p>« ' + esc(a.texte) + ' »</p><footer><b>' + esc(a.auteur) + '</b><span>' + esc(a.source) + '</span></footer></article>'; }).join('') + '</div>');
  }
  var GAL = [], lb = null;
  function wGalerie() {
    GAL = D.galerie || []; if (!GAL.length) return;
    var h = mount('galerie', head('Réalisations', 'Nos réalisations') + '<div class="bm-gal">' + GAL.map(function (g, i) {
      var a = imgUrl(g.image_url), b = imgUrl(g.image_apres_url || '');
      return '<button class="bm-gi" type="button" data-i="' + i + '" aria-label="Agrandir ' + esc(g.titre || 'la photo') + '">' + (b ? '<div class="ba"><div><img loading="lazy" decoding="async" alt="Avant" src="' + esc(a) + '"><span class="tg">Avant</span></div><div><img loading="lazy" decoding="async" alt="Après" src="' + esc(b) + '"><span class="tg">Après</span></div></div>' : '<img loading="lazy" decoding="async" alt="' + esc(g.titre) + '" src="' + esc(a) + '">') + (g.titre ? '<span class="cp">' + esc(g.titre) + '</span>' : '') + '</button>';
    }).join('') + '</div>');
    if (!h) return;
    lb = document.createElement('div'); lb.className = 'bm-lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.innerHTML = '<button class="x" aria-label="Fermer">✕</button><div id="bmLb"></div>'; document.body.appendChild(lb);
    var close = function () { lb.classList.remove('on'); document.body.style.overflow = ''; };
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.classList.contains('x')) close(); }); document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    h.addEventListener('click', function (e) {
      var b = e.target.closest('.bm-gi'); if (!b) return; var g = GAL[+b.dataset.i]; if (!g) return; var a = imgUrl(g.image_url), c = imgUrl(g.image_apres_url || '');
      $('bmLb').innerHTML = (c ? '<div class="pr"><figure><img alt="Avant" src="' + esc(a) + '"><figcaption>Avant</figcaption></figure><figure><img alt="Après" src="' + esc(c) + '"><figcaption>Après</figcaption></figure></div>' : '<img alt="' + esc(g.titre) + '" src="' + esc(a) + '">') + (g.legende || g.titre ? '<p>' + esc(g.legende || g.titre) + '</p>' : '');
      lb.classList.add('on'); document.body.style.overflow = 'hidden';
    });
  }
  function wFaq() {
    var l = D.faq || []; if (!l.length) return;
    mount('faq', head('FAQ', 'Questions fréquentes') + '<div class="bm-faq">' + l.map(function (f) { return '<details><summary>' + esc(f.question) + '</summary><p>' + esc(f.reponse) + '</p></details>'; }).join('') + '</div>');
  }
  function wApropos() {
    if (!X.apropos_texte && !X.apropos_image) return;
    var im = X.apropos_image && imgUrl(X.apropos_image);
    mount('apropos', '<div class="bm-about' + (im ? '' : ' solo') + '">' + (im ? '<img loading="lazy" decoding="async" alt="' + esc(X.apropos_titre) + '" src="' + esc(im) + '">' : '') + '<div><div class="bm-lab">À propos</div><h2 class="bm-h">' + esc(X.apropos_titre || 'À propos') + '</h2><p>' + esc(X.apropos_texte) + '</p>'
      + ((X.chiffres || []).length ? '<div class="bm-stats">' + X.chiffres.map(function (c) { return '<div class="bm-stat"><b>' + esc(c.n) + '</b><span>' + esc(c.l) + '</span></div>'; }).join('') + '</div>' : '') + '</div></div>');
  }

  /* ───────── Horaires + carte ───────── */
  var JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  var toMin = function (t) { var a = t.split(':'); return +a[0] * 60 + +a[1]; };
  var plages = function (h) { return [[h.d, h.f], [h.d2, h.f2]].filter(function (p) { return p[0] && p[1] && toMin(p[1]) > toMin(p[0]); }); };
  function nowParis() {
    var wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date());
    var t = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    return { day: { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd], min: (+t.filter(function (x) { return x.type === 'hour'; })[0].value % 24) * 60 + +t.filter(function (x) { return x.type === 'minute'; })[0].value };
  }
  function closedNow() {
    if (!X.fermeture_texte) return false; var t = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    return !((X.fermeture_du && t < X.fermeture_du) || (X.fermeture_au && t > X.fermeture_au));
  }
  function openStatus(hs, closed) {
    if (closed) return { on: false, t: 'Fermé exceptionnellement' }; var n = nowParis(), td = hs[n.day];
    if (td.o) { var p = plages(td); for (var i = 0; i < p.length; i++) if (n.min >= toMin(p[i][0]) && n.min < toMin(p[i][1])) return { on: true, t: 'Ouvert maintenant · ferme à ' + p[i][1] }; }
    for (var k = 0; k < 7; k++) { var d = (n.day + k) % 7, h = hs[d]; if (!h.o) continue; var q = plages(h).filter(function (x) { return k > 0 || toMin(x[0]) > n.min; })[0]; if (q) return { on: false, t: 'Fermé · ouvre ' + (k === 0 ? "aujourd'hui" : k === 1 ? 'demain' : JOURS[d].toLowerCase()) + ' à ' + q[0] }; }
    return { on: false, t: 'Fermé actuellement' };
  }
  function wHoraires() {
    var hs = X.horaires || []; if (hs.length !== 7) return;
    var st = openStatus(hs, closedNow()), today = nowParis().day, map = X.carte && C.adresse;
    var h = mount('horaires', head('Horaires & accès', 'Nous trouver', C.adresse || '') + '<div class="bm-info' + (map ? '' : ' solo') + '"><div class="bm-hours"><div class="bm-open ' + (st.on ? 'on' : 'off') + '"><i></i>' + esc(st.t) + '</div>'
      + hs.map(function (x, i) { return '<div class="bm-hr' + (i === today ? ' td' : '') + (i === 0 ? ' f' : '') + '"><span>' + JOURS[i] + '</span><span>' + (x.o && plages(x).length ? plages(x).map(function (p) { return p[0] + ' – ' + p[1]; }).join(' · ') : 'Fermé') + '</span></div>'; }).join('')
      + (X.horaires_note ? '<p class="bm-hint" style="margin:.8rem 0 0">' + esc(X.horaires_note) + '</p>' : '') + '</div>'
      + (map ? '<div class="bm-map" id="bmMap"><strong>' + esc(C.adresse) + '</strong><button type="button" class="bm-btn sec" id="bmMapB">Afficher la carte</button><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(C.adresse) + '" target="_blank" rel="noopener noreferrer">Itinéraire (Google Maps)</a><small>La carte est fournie par Google : elle ne se charge qu\'après votre clic.</small></div>' : '') + '</div>');
    if (h && map) $('bmMapB').onclick = function () { var b = $('bmMap'); b.style.display = 'block'; b.style.padding = '0'; b.innerHTML = '<iframe title="Carte" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=' + encodeURIComponent(C.adresse) + '&output=embed"></iframe>'; };
  }

  /* ───────── Bandeaux (promo, fermeture), WhatsApp, réseaux ───────── */
  function bars() {
    var items = [];
    if (closedNow() && F.horaires) items.push('<div class="bm-bar1 red" role="status"><span>' + esc(X.fermeture_texte) + '</span><button class="cl" type="button" aria-label="Fermer">✕</button></div>');
    var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    if (F.promo && X.promo_texte && (!X.promo_fin || today <= X.promo_fin)) items.push('<div class="bm-bar1" role="status"><span>' + esc(X.promo_texte) + '</span>' + (X.promo_code ? '<code>' + esc(X.promo_code) + '</code><button type="button" data-copy="' + esc(X.promo_code) + '">Copier le code</button>' : '') + '<button class="cl" type="button" aria-label="Fermer">✕</button></div>');
    var dis = false; try { dis = sessionStorage.getItem('bm_bars') === '1'; } catch (e) { /* ignoré */ }
    if (!items.length || dis) return;
    var w = document.createElement('div'); w.id = 'bm-bars'; w.innerHTML = items.join(''); document.body.insertBefore(w, document.body.firstChild);
    var size = function () { document.documentElement.style.setProperty('--bm-bar', w.offsetHeight + 'px'); }; document.body.classList.add('bm-hasbar'); size(); window.addEventListener('resize', size);
    if (window.ResizeObserver) new ResizeObserver(size).observe(w);
    w.addEventListener('click', function (e) {
      if (e.target.closest('.cl')) { try { sessionStorage.setItem('bm_bars', '1'); } catch (x) { /* ignoré */ } w.remove(); document.body.classList.remove('bm-hasbar'); return; }
      var c = e.target.closest('[data-copy]'); if (c) (navigator.clipboard ? navigator.clipboard.writeText(c.dataset.copy) : Promise.reject()).then(function () { toast('Code « ' + c.dataset.copy + ' » copié'); }, function () { toast('Code : ' + c.dataset.copy); });
    });
  }
  function waFab() {
    if (!F.whatsapp || document.querySelector('.wa-float,.bm-wa')) return; // le site a déjà son bouton WhatsApp
    var n = String(X.wa_numero || C.telephone || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(n)) n = '33' + n.slice(1); n = n.replace(/^\+/, '').replace(/^00/, ''); if (n.length < 9) return;
    var a = document.createElement('a'); a.className = 'bm-wa'; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', 'Nous écrire sur WhatsApp');
    a.href = 'https://wa.me/' + n + '?text=' + encodeURIComponent(X.wa_message || 'Bonjour, je vous contacte depuis votre site.');
    a.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 3C8.86 3 3.03 8.82 3.03 16c0 2.29.6 4.52 1.73 6.49L3 29l6.69-1.75A12.96 12.96 0 0 0 16.04 29C23.22 29 29.05 23.18 29.05 16S23.22 3 16.04 3Zm0 23.8c-1.96 0-3.88-.53-5.55-1.52l-.4-.24-3.97 1.04 1.06-3.87-.26-.4A10.76 10.76 0 0 1 5.24 16c0-5.96 4.85-10.8 10.8-10.8S26.84 10.04 26.84 16 22 26.8 16.04 26.8Zm5.92-8.08c-.32-.16-1.92-.95-2.22-1.06-.3-.11-.51-.16-.73.16-.22.32-.84 1.06-1.03 1.27-.19.22-.38.24-.7.08-.32-.16-1.37-.5-2.6-1.6-.96-.86-1.6-1.91-1.79-2.23-.19-.32-.02-.5.14-.66.15-.14.32-.38.48-.57.16-.19.22-.32.32-.54.11-.22.05-.4-.03-.56-.08-.16-.73-1.76-1-2.41-.26-.63-.53-.54-.73-.55h-.62c-.22 0-.57.08-.87.4-.3.32-1.14 1.11-1.14 2.72s1.17 3.15 1.33 3.37c.16.22 2.3 3.51 5.57 4.92.78.34 1.39.54 1.86.69.78.25 1.49.21 2.05.13.63-.09 1.92-.78 2.19-1.54.27-.76.27-1.4.19-1.54-.08-.14-.3-.22-.62-.38Z"/></svg>';
    document.body.appendChild(a);
  }
  function socials() {
    var r = X.reseaux || {}, N = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn' };
    var ks = Object.keys(N).filter(function (k) { return r[k]; }); if (!F.reseaux || (!ks.length && !r.google_avis)) return;
    var f = document.querySelector('footer'); if (!f) return;
    var p = document.createElement('div'); p.className = 'bm-soc';
    p.innerHTML = ks.map(function (k) { return '<a href="' + esc(r[k]) + '" target="_blank" rel="noopener noreferrer" data-cta="social-' + k + '">' + N[k] + '</a>'; }).join('') + (r.google_avis ? '<a class="g" href="' + esc(r.google_avis) + '" target="_blank" rel="noopener noreferrer" data-cta="google-avis">★ Laisser un avis Google</a>' : '');
    f.insertBefore(p, f.lastElementChild);
  }

  /* ───────── Démarrage ───────── */
  function run(data) {
    D = data; C = D.config; F = C.features || {}; X = C.extras || {};
    var st = document.createElement('style'); st.id = 'bm-css'; st.textContent = CSS; document.head.appendChild(st);
    var W = { produits: wProduits, simulateur: wSim, rdv: wRdv, avis: wAvis, galerie: wGalerie, faq: wFaq, apropos: wApropos, horaires: wHoraires };
    ORDER.forEach(function (k) { if (F[k] || (k === 'produits' && false)) { try { W[k](); } catch (e) { if (window.console) console.warn('ByEmreh widget', k, e); } } });
    try { bars(); waFab(); socials(); } catch (e) { if (window.console) console.warn('ByEmreh widgets', e); }
  }
  var cached = null; try { cached = JSON.parse(sessionStorage.getItem('bm_boot') || 'null'); } catch (e) { cached = null; }
  if (cached && Date.now() - cached.t < 300000) run(cached.d);
  else fetch('/api/bootstrap').then(function (r) { return r.json(); }).then(function (d) { try { sessionStorage.setItem('bm_boot', JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* ignoré */ } run(d); }).catch(function () {});
})();
