// État de la flotte pour l'onglet « Flotte » de l'appli membres (protégé par le mot de passe du club, comme tout /membre/).
// Source : le planning public Aerogest du club. Son lien (avec son jeton) est un secret Cloudflare : AEROGEST_PLANNING_URL.
// On lit, comme le fait la page publique d'Aerogest :
//   - le potentiel restant de chaque avion et son dernier vol (AircraftsTBOAPI) ;
//   - les réservations du jour et des 6 jours suivants (bookingapi/getplanning), pour trouver la prochaine.
// Le résultat est gardé 1 minute en cache : l'onglet Flotte se rafraîchit toutes les minutes.
// Les heures d'Aerogest sont en heure locale (Paris), au format AAAAMMJJHHmm.

const AEROGEST = 'https://online.aerogest.fr';
const CACHE_CLE = 'https://cache.acbt60.local/membre/api/flotte';
const DUREE_CACHE = 60; // secondes
const JOURS = 7;
// Ordre d'affichage (choix du club). Les avions masqués dans Aerogest n'apparaissent simplement pas.
const ORDRE = ['F-GCAL', 'F-BXEK', 'F-BTBS', 'F-BTXS', 'F-BTKG', 'F-BTBJ', 'F-BIXA'];

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

// options.jour : ajoute à chaque avion ses réservations d'aujourd'hui et de demain (tableau de bord TV) ;
// options.instructeurs : lit aussi le planning des instructeurs (getplanning2) pour aujourd'hui et demain.
export async function lireFlotte(lien, maintenant = new Date(), f = fetch, options = {}) {
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
  const plannings2 = options.instructeurs ? await Promise.all(jours.slice(0, 2).map((j) =>
    f(`${AEROGEST}/api/schedule/bookingapi/getplanning2/${j}/0?token=${jeton}`, { method: 'POST', body: '', headers: { ...entetes(cookie), 'Content-Length': '0' } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null))) : [];

  // 4. Vols réellement effectués (même source que l'option « départs/retours » du planning public) :
  //    pour la durée du dernier vol. Facultatif : si Aerogest ne répond pas, on garde la seule heure du dernier vol.
  //    Avec l'option « jour » : aussi les vols d'aujourd'hui, pour dessiner le temps réellement volé sur le planning.
  const datesVols = [...new Set([...(options.jour ? [jours[0]] : []), ...tbo.map((x) => (x.lastFlight || '').match(/^(\d\d)\/(\d\d)\/(\d{4})/)).filter(Boolean).map((m) => m[3] + m[2] + m[1])])].slice(0, 8);
  const tousVols = (await Promise.all(datesVols.map((j) =>
    f(`${AEROGEST}/api/FlightManagement/FlightAPI/GetSimple/${j}0000/`, { headers: entetes(cookie) })
      .then((r) => (r.ok ? r.json() : [])).catch(() => [])))).flat().filter((v) => v && v.idAircraft && v.from);
  const vols = tousVols.filter((v) => v.to);

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
    const indispos = dedoublonner(a.indispos).filter((r) => r.fin > auj);
    const dernier = vols.filter((v) => v.idAircraft === a.id && String(v.to) <= auj).sort((x, y) => String(y.to).localeCompare(String(x.to)))[0];
    // En vol (détecté par Aerogest) : un départ enregistré après le dernier atterrissage, il y a moins de 8 h
    const dep = (() => { const m = String(t?.lastFlight || '').match(/^(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/); return m ? m[3] + m[2] + m[1] + m[4] + m[5] : null; })();
    const ouvert = tousVols.find((v) => v.idAircraft === a.id && !v.to && String(v.from) <= auj);
    const depuis = ouvert ? String(ouvert.from) : dep && dep <= auj && (!dernier || dep > String(dernier.to)) ? dep : null;
    const enVol = depuis && minutesEntre(depuis, auj) < 480 ? { depuis } : null;
    return {
      immat: a.immat,
      // Créneaux occupés à venir (réservations + indisponibilités), pour calculer la prochaine disponibilité
      occupe: [...resas.filter((r) => r.fin > auj), ...indispos].map((r) => ({ debut: r.debut, fin: r.fin })),
      dernier: dernier ? { debut: String(dernier.from), fin: String(dernier.to), temps: dernier.tps || null, pilote: texte(dernier.pilotname) || null, instructeur: texte(dernier.instructorName) || null } : null, // Aerogest donne déjà « NOM Prénom »
      potentiel: typeof t?.pot === 'number' ? t.pot : null, // minutes avant la prochaine visite
      tolerance: t?.tol || 0,
      dernierVol: t?.lastFlight && t.lastFlight !== 'N/A' ? t.lastFlight : null, // « JJ/MM/AAAA HH:mm »
      enCours,
      enVol,
      prochaine,
      indispo,
      ...(options.jour ? {
        jour: resas.filter((r) => r.debut.slice(0, 8) === jours[0] || r.debut.slice(0, 8) === jours[1]),
        indispos: indispos.map((r) => ({ debut: r.debut, fin: r.fin, motif: r.motif })),
        // Vols réellement effectués aujourd'hui (départ → arrivée), comme l'option « départs/retours » d'Aerogest
        volsJour: tousVols.filter((v) => v.idAircraft === a.id && String(v.from).slice(0, 8) === jours[0]).map((v) => ({ debut: String(v.from), fin: v.to ? String(v.to) : null, temps: v.tps || null }))
          .sort((x, y) => x.debut.localeCompare(y.debut)),
      } : {}),
    };
  });
  // Ordre voulu par le club, puis les autres avions dans l'ordre de la page Aerogest
  const ordre = [...ORDRE, ...immats.values()];
  liste.sort((x, y) => rang(ordre, x.immat) - rang(ordre, y.immat));
  const corps = { ok: true, maj: maintenant.toISOString(), planning: plannings.some(Boolean), avions: liste };
  if (options.instructeurs) {
    corps.instructeurs = lireInstructeurs(plannings2);
    if (options.brut) corps.brut = plannings2.map((p) => apercu(p));
  }
  return corps;
}

// Planning des instructeurs (même format que celui des avions) : une ligne par instructeur,
// avec ses créneaux (réservations où il vole, et créneaux posés à part : présences ou absences).
const VERT = '#c1ffc1', GRIS = '#dddddd';
// Retire d'un intervalle [début, fin] (dates « AAAAMMJJhhmm ») les intervalles à exclure
function soustraire(iv, moins) {
  let reste = [iv];
  for (const [a, b] of moins) reste = reste.flatMap(([d, f]) => (b <= d || a >= f ? [[d, f]] : [...(a > d ? [[d, a]] : []), ...(b < f ? [[b, f]] : [])]));
  return reste;
}
function lireInstructeurs(plannings) {
  const parNom = new Map();
  for (const p of plannings) {
    for (const l of p?.lignes || []) {
      const nom = nomPrenom(texte(l.content).split('\n')[0]);
      if (!nom) continue;
      if (!parNom.has(nom)) parNom.set(nom, { nom, creneaux: [] });
      const i = parNom.get(nom);
      const ajouter = (r, flottant) => {
        const info = infobulle(r.tooltip);
        i.creneaux.push({ id: r.id ?? null, debut: r.debut, fin: r.fin, texte: texte(r.content) || null, type: info.Type || null, pilote: info.Pilote ? nomPrenom(info.Pilote) : null, avion: info['Appareil'] || info['Avion'] || null, flottant });
      };
      for (const s of l.sublignes || []) for (const r of s.reservations || []) ajouter(r, false);
      for (const r of l.reservationsFlottantes || []) ajouter(r, true);
      // Disponibilités posées par l'instructeur : Aerogest les dessine en fond de ligne (couleursFond).
      // Vert clair = disponible, gris = indisponible (prioritaire). Les fonds bleus (lever/coucher, nuit) sont ignorés.
      const fonds = (l.couleursFond || []).filter((c) => c?.debut && c?.fin);
      const gris = fonds.filter((c) => String(c.color).toLowerCase() === GRIS);
      for (const c of fonds.filter((x) => String(x.color).toLowerCase() === VERT)) {
        for (const [debut, fin] of soustraire([String(c.debut), String(c.fin)], gris.map((g) => [String(g.debut), String(g.fin)]))) {
          i.creneaux.push({ id: null, debut, fin, texte: texte(c.content) || null, type: null, pilote: null, avion: null, flottant: true });
        }
      }
    }
  }
  return [...parNom.values()].map((i) => ({ ...i, creneaux: dedoublonner(i.creneaux).sort((a, b) => String(a.debut).localeCompare(String(b.debut))) }));
}

// Aperçu de la structure brute (pour régler la lecture du planning instructeurs) : clés et premières valeurs seulement.
function apercu(v, n = 0) {
  if (n > 5) return '…';
  if (Array.isArray(v)) return v.slice(0, n < 3 ? 20 : 3).map((x) => apercu(x, n + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, apercu(x, n + 1)]));
  return typeof v === 'string' ? v.slice(0, 300) : v;
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
    duree: duree(info['Durée de vol prévue']), // minutes de vol prévues à la réservation
  };
}

// « 01h30 » → 90
function duree(s) {
  const m = String(s || '').match(/(\d+)\s*h\s*(\d+)?/i);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
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
// Minutes entre deux horodatages « AAAAMMJJHHmm » (heure de Paris)
const enDate = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
export const minutesEntre = (a, b) => (enDate(b) - enDate(a)) / 60000;
export const heureParis = (d) => { const p = parties(d); return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`; };

function json(corps, status = 200, cache = 0, portee = 'private') {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache ? `${portee}, max-age=${cache}` : 'no-store' },
  });
}
