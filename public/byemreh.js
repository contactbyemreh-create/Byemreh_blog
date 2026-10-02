/* ByEmreh — script du site (un seul fichier, même domaine).
   1) Mesure d'audience anonyme, SANS cookie : visites, pages vues, clics Stripe / WhatsApp / téléphone / Cal.com.
   2) Formulaires : si « Messages de contact par email » est activé dans l'espace pro, les messages passent par
      le serveur (email via Resend + archivage). Sinon, ou en cas de panne, Formspree continue comme avant.
   3) Newsletter : le formulaire d'inscription apparaît au-dessus du pied de page si la fonction est activée. */
(function () {
  'use strict';
  var ss, ls;
  try { ss = window.sessionStorage; ls = window.localStorage; } catch (e) { ss = ls = null; }
  var get = function (st, k) { try { return st && st.getItem(k); } catch (e) { return null; } };
  var set = function (st, k, v) { try { if (st) st.setItem(k, v); } catch (e) { /* navigation privée */ } };

  function post(path, body, keepalive) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: !!keepalive });
  }
  function track(type, label) { try { post('/api/track', { type: type, label: label || '' }, true).catch(function () {}); } catch (e) { /* ignoré */ } }

  /* ── 1. Mesure d'audience ── */
  (function pageviews() {
    if (/^\/(pro|admin)(\/|$)/.test(location.pathname)) return;
    var path = location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '') || '/';
    if (get(ss, 'bm_s') !== '1') {
      set(ss, 'bm_s', '1');
      var ref = 'direct';
      try { var h = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; if (h && h !== location.hostname.replace(/^www\./, '')) ref = h; } catch (e) { /* direct */ }
      track('view', ref);
    }
    var seen = []; try { seen = JSON.parse(get(ss, 'bm_p') || '[]'); } catch (e) { seen = []; }
    if (seen.indexOf(path) < 0) { seen.push(path); set(ss, 'bm_p', JSON.stringify(seen.slice(-40))); track('page', path); }
  })();

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/buy\.stripe\.com|checkout\.stripe\.com/.test(h)) {
      var box = a.closest('[id]');
      track('buy_click', ((box && box.id) || h.split('/').pop() || 'stripe').slice(0, 40));
    } else if (/wa\.me|whatsapp\.com/.test(h)) track('wa_click', 'whatsapp');
    else if (/^tel:/.test(h)) track('call_click', 'tel');
    else if (/cal\.com/.test(h)) track('cal_view', 'cal');
    else if (/malt\.fr/.test(h)) track('cta_click', 'malt');
    else if (a.getAttribute('data-cta')) track('cta_click', a.getAttribute('data-cta'));
  }, true);

  /* ── Réglages publics (mis en cache 10 min pour être prêts dès la page suivante) ── */
  var CFG = null;
  try { var c = JSON.parse(get(ls, 'bm_cfg') || 'null'); if (c && c.d) CFG = c.d; } catch (e) { CFG = null; }
  function loadCfg() {
    var c = null; try { c = JSON.parse(get(ls, 'bm_cfg') || 'null'); } catch (e) { c = null; }
    if (c && c.d && Date.now() - c.t < 600000) { CFG = c.d; return Promise.resolve(); }
    return fetch('/api/site').then(function (r) { return r.json(); }).then(function (d) { CFG = d; set(ls, 'bm_cfg', JSON.stringify({ t: Date.now(), d: d })); }).catch(function () {});
  }

  /* ── 2. Formulaires de contact et de partenariat ── */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.tagName || f.tagName !== 'FORM' || String(f.getAttribute('action') || '').indexOf('formspree.io') < 0) return;
    if (!CFG || !CFG.features || !CFG.features.contact_email) return; // Formspree continue comme avant
    e.preventDefault(); e.stopImmediatePropagation();
    var btn = f.querySelector('[type=submit]'), label = btn ? btn.innerText : '';
    if (btn) { btn.innerText = 'Envoi en cours...'; btn.disabled = true; }
    var reset = function () { if (btn) { btn.innerText = label; btn.disabled = false; } };
    var data = {}; new FormData(f).forEach(function (v, k) { if (typeof v === 'string') data[k] = v; });
    data.page = location.pathname;
    var viaFormspree = function () {
      return fetch(f.getAttribute('action'), { method: 'POST', body: new FormData(f), headers: { Accept: 'application/json' } }).then(function (r) { return r.ok; }).catch(function () { return false; });
    };
    var done = function () { window.location.href = 'confirmation.html'; };
    post('/api/contact', data).then(function (r) {
      if (r.ok) return done();
      if (r.status === 400 || r.status === 429) { alert("Une erreur est survenue lors de l'envoi. Veuillez vérifier les champs et réessayer."); return reset(); }
      return viaFormspree().then(function (ok) { if (ok) done(); else { alert("Une erreur est survenue lors de l'envoi. Veuillez réessayer."); reset(); } });
    }).catch(function () {
      viaFormspree().then(function (ok) { if (ok) done(); else { alert("Erreur de connexion. Veuillez réessayer."); reset(); } });
    });
  }, true);

  /* ── 3. Newsletter ── */
  function newsletter() {
    if (!CFG || !CFG.features || !CFG.features.newsletter || document.getElementById('bm-nl')) return;
    if (/confirmation|politique-confidentialite|^\/(pro|admin)/.test(location.pathname)) return;
    var footer = document.querySelector('footer'); if (!footer || !footer.parentNode) return;
    var nom = CFG.nom || 'ByEmreh', esc = function (t) { return String(t || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var st = document.createElement('style');
    st.textContent = '#bm-nl{background:var(--ink,#0B0C10);color:#fff;padding:3.2rem 1.4rem;font-family:var(--ff-body,system-ui,sans-serif)}'
      + '#bm-nl .in{max-width:620px;margin:0 auto;text-align:center}#bm-nl h2{font-family:var(--ff-disp,Georgia,serif);font-size:clamp(1.5rem,3.6vw,2rem);font-weight:600;margin:0 0 .5rem;color:#fff}'
      + '#bm-nl p.s{color:rgba(255,255,255,.72);margin:0 0 1.3rem;line-height:1.6}#bm-nl .r{display:flex;gap:.6rem}'
      + '#bm-nl input[type=email]{flex:1;min-width:0;padding:.85rem 1.1rem;border-radius:99px;border:0;font:inherit;font-size:.95rem}'
      + '#bm-nl button{border:0;border-radius:99px;padding:.85rem 1.5rem;font:inherit;font-weight:700;font-size:.95rem;cursor:pointer;background:var(--signal-brt,#3ECFAE);color:var(--ink,#0B0C10);white-space:nowrap}#bm-nl button:disabled{opacity:.6}'
      + '#bm-nl label{display:flex;gap:.55rem;align-items:flex-start;justify-content:center;text-align:left;margin-top:.9rem;font-size:.78rem;color:rgba(255,255,255,.72);line-height:1.5}#bm-nl label input{margin-top:.2rem}'
      + '#bm-nl label a{color:#fff;text-decoration:underline}#bm-nl .m{min-height:1.3rem;margin-top:.7rem;font-size:.88rem;font-weight:600}#bm-nl .m.err{color:#FFB4A8}#bm-nl .m.ok{color:#A8F0C6}'
      + '#bm-nl .hp{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:520px){#bm-nl .r{flex-direction:column}}';
    var sec = document.createElement('section'); sec.id = 'bm-nl'; sec.setAttribute('aria-labelledby', 'bm-nl-t');
    sec.innerHTML = '<div class="in"><h2 id="bm-nl-t">' + esc((CFG.newsletter && CFG.newsletter.titre) || 'Restez informé') + '</h2>'
      + '<p class="s">' + esc((CFG.newsletter && CFG.newsletter.texte) || 'Conseils concrets pour être visible sur Google et attirer des clients. Pas de spam, désinscription en un clic.') + '</p>'
      + '<form novalidate><div class="r"><input type="email" placeholder="Votre email" aria-label="Votre email" autocomplete="email" required><button type="submit">S\'inscrire</button></div>'
      + '<input type="text" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">'
      + '<label><input type="checkbox"><span>J\'accepte de recevoir les emails de ' + esc(nom) + '. Je peux me désinscrire à tout moment. <a href="/politique-confidentialite.html">Politique de confidentialité</a></span></label>'
      + '<div class="m" role="alert"></div></form></div>';
    footer.parentNode.insertBefore(st, footer); footer.parentNode.insertBefore(sec, footer);
    var form = sec.querySelector('form'), msg = sec.querySelector('.m'), btn = sec.querySelector('button');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); msg.className = 'm err';
      var email = form.querySelector('input[type=email]').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Indiquez un email valide.'; return; }
      if (!form.querySelector('input[type=checkbox]').checked) { msg.textContent = 'Cochez la case pour accepter de recevoir nos emails.'; return; }
      btn.disabled = true; msg.textContent = '';
      post('/api/subscribe', { email: email, consent: true, website: form.querySelector('.hp').value, lang: 'fr', source: location.pathname.slice(0, 40) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d.ok, d: d }; }); })
        .then(function (x) { if (!x.ok) throw new Error(x.d.error || 'Erreur'); msg.className = 'm ok'; msg.textContent = 'Merci ! Vous êtes bien inscrit(e).'; form.reset(); })
        .catch(function (err) { msg.textContent = /Failed to fetch|NetworkError/.test(err.message) ? 'Connexion impossible. Réessayez.' : (err.message || "L'inscription a échoué, réessayez."); })
        .then(function () { btn.disabled = false; });
    });
  }

  function start() { loadCfg().then(newsletter); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
