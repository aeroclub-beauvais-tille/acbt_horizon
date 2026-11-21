// État de la flotte pour l'onglet « Flotte » de l'appli membres (protégé par le mot de passe du club, comme tout /membre/).
// Source : le planning public Aerogest du club. Son lien (avec son jeton) est un secret Cloudflare : AEROGEST_PLANNING_URL.
// On lit, comme le fait la page publique d'Aerogest :
//   - le potentiel restant de chaque avion et son dernier vol (AircraftsTBOAPI) ;
//   - les réservations du jour et des 6 jours suivants (bookingapi/getplanning), pour trouver la prochaine.
// Le résultat est gardé 5 minutes en cache (la page Aerogest se rafraîchit elle-même toutes les 5 minutes).
// Les heures d'Aerogest sont en heure locale (Paris), au format AAAAMMJJHHmm.

const AEROGEST = 'https://online.aerogest.fr';
const CACHE_CLE = 'https://cache.acbt60.local/membre/api/flotte';
const DUREE_CACHE = 300; // secondes
const JOURS = 7;

export async function onRequestGet({ env, waitUntil }) {
  if (!env.AEROGEST_PLANNING_URL) {
    return json({ ok: false, erreur: "Lien du planning Aerogest non réglé dans Cloudflare (AEROGEST_PLANNING_URL)." }, 503);
  }
  const cache = globalThis.caches?.default;
  const cle = new Request(CACHE_CLE);
  if (cache) {
    const deja = await cache.match(cle);
    if (deja) return deja;
  }
  let corps;
  try {
    corps = await lireFlotte(env.AEROGEST_PLANNING_URL);
  } catch (e) {
    return json({ ok: false, erreur: 'Aerogest ne répond pas pour le moment.' }, 502);
  }
  // Copie « public » pour le cache de Cloudflare (il refuse les réponses « private ») ; jamais servie telle quelle,
  // car la réponse finale repasse par le middleware membres qui la marque « private ».
  if (cache) waitUntil?.(cache.put(cle, json(corps, 200, DUREE_CACHE, 'public')));
  return json(corps, 200, DUREE_CACHE);
}

export async function lireFlotte(lien, maintenant = new Date(), f = fetch) {
  // 1. Page publique : jeton des API, cookie de session et correspondance id → immatriculation
  const page = await f(lien, { headers: { 'User-Agent': 'ACBT espace membres' }, redirect: 'follow' });
  if (!page.ok) throw new Error('page ' + page.status);
  const html = await page.text();
  const jeton = (html.match(/publicPlanningToken\s*=\s*'([A-Za-z0-9]+)'/) || [])[1]
    || (html.match(/AircraftsTBOAPI\/get\/\?token=([A-Za-z0-9]+)/) || [])[1];
  if (!jeton) throw new Error('jeton introuvable');
  const cookie = lireCookies(page.headers);
  const immats = new Map();
  for (const m of html.matchAll(/class="tabpot(\d+)"\s*>\s*([A-Z0-9-]+)\s*</g)) immats.set(Number(m[1]), m[2]);

  // 2. Potentiels
  const tbo = await f(`${AEROGEST}/api/AircraftManagement/AircraftsTBOAPI/get/?token=${jeton}`, { headers: entetes(cookie) })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);

  // 3. Réservations du jour et des jours suivants
  const auj = heureParis(maintenant);
  const jours = Array.from({ length: JOURS }, (_, i) => jourParis(new Date(maintenant.getTime() + i * 86400000)));
  const plannings = await Promise.all(jours.map((j) =>
    f(`${AEROGEST}/api/schedule/bookingapi/getplanning/${j}/0?token=${jeton}`, { method: 'POST', body: '', headers: { ...entetes(cookie), 'Content-Length': '0' } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)));

  const avions = new Map(); // id → { immat, resas: [], indispos: [] }
  const avion = (id, immat) => {
    if (!avions.has(id)) avions.set(id, { id, immat: immat || immats.get(id) || '', resas: [], indispos: [] });
    return avions.get(id);
  };
  for (const id of immats.keys()) avion(id);
  for (const p of plannings) {
    for (const l of p?.lignes || []) {
      if (l.idType !== 'acft') continue;
      const a = avion(l.id, l.content);
      if (!a.immat) a.immat = l.content;
      for (const s of l.sublignes || []) for (const r of s.reservations || []) a.resas.push(resa(r));
      for (const r of l.reservationsFlottantes || []) a.indispos.push({ debut: r.debut, fin: r.fin, motif: texte(r.content) || 'Indisponible' });
    }
  }

  const liste = [...avions.values()].filter((a) => a.immat).map((a) => {
    const t = tbo.find((x) => x.id === a.id);
    const resas = dedoublonner(a.resas).sort((x, y) => x.debut.localeCompare(y.debut));
    const enCours = resas.find((r) => r.debut <= auj && r.fin > auj) || null;
    const prochaine = resas.find((r) => r.debut > auj) || null;
    const indispo = dedoublonner(a.indispos).find((r) => r.debut <= auj && r.fin > auj) || null;
    return {
      immat: a.immat,
      potentiel: typeof t?.pot === 'number' ? t.pot : null, // minutes avant la prochaine visite
      tolerance: t?.tol || 0,
      dernierVol: t?.lastFlight && t.lastFlight !== 'N/A' ? t.lastFlight : null, // « JJ/MM/AAAA HH:mm »
      enCours,
      prochaine,
      indispo,
    };
  });
  // Ordre de la page Aerogest
  const ordre = [...immats.values()];
  liste.sort((x, y) => rang(ordre, x.immat) - rang(ordre, y.immat));
  return { ok: true, maj: maintenant.toISOString(), planning: plannings.some(Boolean), avions: liste };
}

// Une réservation : horaires + pilote « NOM Prénom » (lu dans l'info-bulle, sinon le libellé court « NOM P. »)
function resa(r) {
  const info = infobulle(r.tooltip);
  return {
    id: r.id,
    debut: r.debut,
    fin: r.fin,
    pilote: nomPrenom(info.Pilote) || texte(r.content).split('\n')[0] || null,
    instructeur: info.Instructeur ? nomPrenom(info.Instructeur) : null,
    type: info.Type || null,
  };
}

function infobulle(t) {
  const html = decoder(String(t || ''));
  const champs = {};
  for (const m of html.matchAll(/<th>\s*([^<]+?)\s*<\/th>\s*<td>\s*([^<]*?)\s*<\/td>/g)) champs[m[1]] = m[2];
  return champs;
}

// « Baptiste DALBART » → « DALBART Baptiste » (les mots en capitales forment le nom)
export function nomPrenom(s) {
  const mots = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return null;
  const maj = (w) => w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w);
  const nom = mots.filter(maj);
  const prenom = mots.filter((w) => !maj(w));
  if (!nom.length || !prenom.length) return mots.join(' ');
  return [...nom, ...prenom].join(' ');
}

function decoder(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}
const texte = (s) => decoder(String(s || '')).replace(/<[^>]*>/g, '').trim();
const rang = (ordre, im) => { const i = ordre.indexOf(im); return i < 0 ? 99 : i; };
const dedoublonner = (l) => [...new Map(l.map((r) => [r.id ?? r.debut + r.fin, r])).values()];

function lireCookies(h) {
  const brut = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (h.get('set-cookie') ? [h.get('set-cookie')] : []);
  return brut.map((c) => c.split(';')[0]).join('; ');
}
const entetes = (cookie) => ({ 'User-Agent': 'ACBT espace membres', 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) });

// Date et heure à Paris au format d'Aerogest
function parties(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return p;
}
export const jourParis = (d) => { const p = parties(d); return `${p.year}${p.month}${p.day}`; };
export const heureParis = (d) => { const p = parties(d); return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`; };

function json(corps, status = 200, cache = 0, portee = 'private') {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache ? `${portee}, max-age=${cache}` : 'no-store' },
  });
}
