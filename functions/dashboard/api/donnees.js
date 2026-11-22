// Données du tableau de bord TV (/dashboard, protégé par son mot de passe dans le middleware).
// Un seul appel par minute depuis la télé : flotte et réservations (Aerogest), instructeurs, MAA, METAR, TAF, NOTAM.
// Chaque source est facultative : si l'une ne répond pas, les autres s'affichent quand même.
import { lireFlotte } from '../../membre/api/flotte.js';
import { tableMaa, MAA_VISIBLES } from '../../_maa.js';

const AVWX_CLE = 'v1k-d7EgXdAiRybNQZ6gij20qSs0n9DEPki8lQD0jjo'; // clé publique déjà utilisée par le site
const CACHE = 'https://cache.acbt60.local/dashboard/api/donnees';
const CACHE_NOTAM = 'https://cache.acbt60.local/dashboard/api/notam';

export async function onRequestGet({ env, request, waitUntil }) {
  const debug = new URL(request.url).searchParams.get('debug');
  const cache = globalThis.caches?.default;
  if (cache && !debug) {
    const deja = await cache.match(new Request(CACHE));
    if (deja) return deja;
  }
  const [flotte, maa, metar, taf, notam, historique, vigilance] = await Promise.all([
    env.AEROGEST_PLANNING_URL
      ? lireFlotte(env.AEROGEST_PLANNING_URL, new Date(), fetch, { jour: true, instructeurs: true, brut: debug === 'instructeurs' }).catch(() => null)
      : null,
    lireMaa(env).catch(() => null),
    avwx(env, 'metar').catch(() => null),
    avwx(env, 'taf').catch(() => null),
    lireNotam(env, cache, waitUntil, debug === 'notam', (new URL(request.url).searchParams.get('lieu') || 'LFOB').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)).catch((e) => ({ ok: false, raison: String(e.message || e) })),
    lireHistorique().catch(() => null),
    lireVigilance(env, cache, waitUntil).catch(() => null),
  ]);
  const corps = { ok: true, maj: new Date().toISOString(), flotte, maa, metar, taf, notam, historique, vigilance, meteofrance: Boolean(env.METEOFRANCE_BASIC || env.METEOFRANCE_APIKEY), meteofranceExpire: expiration(env.METEOFRANCE_APIKEY) };
  const rep = (portee) => new Response(JSON.stringify(corps), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `${portee}, max-age=50` },
  });
  if (cache && !debug) waitUntil?.(cache.put(new Request(CACHE), rep('public')));
  return rep('private');
}

// Date d'expiration d'une clé d'API Météo-France (jeton JWT : champ « exp » de la partie centrale)
function expiration(cle) {
  try {
    const p = String(cle || '').trim().split('.')[1];
    if (!p) return null;
    const { exp } = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')));
    return exp ? new Date(exp * 1000).toISOString() : null;
  } catch { return null; }
}

async function lireMaa(env) {
  if (!env.DB) return null;
  await tableMaa(env.DB);
  const depuis = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, numero, motif, debut, fin, recu FROM maa WHERE (fin IS NULL OR fin >= ?1) AND ${MAA_VISIBLES} ORDER BY debut, numero LIMIT 20`,
  ).bind(depuis).all();
  return results;
}

// METAR et TAF de LFOB (AVWX), réduits à ce que l'écran affiche
async function avwx(env, quoi) {
  const r = await fetch(`https://avwx.rest/api/${quoi}/LFOB?options=&format=json&onfail=cache`, {
    headers: { Authorization: `BEARER ${env.AVWX_TOKEN || AVWX_CLE}` },
  });
  if (!r.ok) return null;
  const m = await r.json();
  if (!m?.raw) return null;
  if (quoi === 'metar') return { raw: m.raw, heure: m.time?.dt ?? null, ...conditions(m), temperature: m.temperature?.value ?? null, rosee: m.dewpoint?.value ?? null, qnh: m.altimeter?.value ?? null };
  return {
    raw: m.raw,
    heure: m.time?.dt ?? null,
    periodes: (m.forecast || []).map((p) => ({
      type: p.type, // FROM, BECMG, TEMPO, PROB, INTER
      probabilite: p.probability?.value ?? null,
      debut: p.start_time?.dt ?? null,
      fin: p.end_time?.dt ?? null,
      raw: p.raw ?? '',
      ...conditions(p),
    })),
  };
}

function conditions(m) {
  return {
    regles: m.flight_rules || null,
    ventDir: m.wind_direction?.repr === 'VRB' ? 'VRB' : m.wind_direction?.value ?? null,
    ventForce: m.wind_speed?.value ?? null,
    rafales: m.wind_gust?.value ?? null,
    ventVar: (m.wind_variable_direction || []).length === 2 ? m.wind_variable_direction.map((x) => x.value) : null,
    visibilite: /CAVOK/.test(m.raw || '') ? 'CAVOK' : m.visibility?.value ?? null,
    nuages: (m.clouds || []).map((c) => ({ type: c.type, hauteur: c.altitude != null ? c.altitude * 100 : null, cb: c.modifier || null })),
    temps: (m.wx_codes || []).map((w) => ({ code: w.repr, texte: w.value })),
  };
}

// METAR des 12 dernières heures (aviationweather.gov, service public de la NOAA, sans clé) pour la courbe d'évolution
async function lireHistorique() {
  const r = await fetch('https://aviationweather.gov/api/data/metar?ids=LFOB&hours=12&format=json', { headers: { 'User-Agent': 'ACBT tableau de bord' } });
  if (!r.ok) return null;
  const l = await r.json();
  return (Array.isArray(l) ? l : []).map((m) => {
    const plafond = (m.clouds || []).filter((c) => /BKN|OVC|VV/.test(c.cover) && c.base != null).map((c) => c.base);
    return { t: new Date(m.obsTime * 1000).toISOString(), vent: m.wspd ?? null, rafales: m.wgst ?? null, dir: typeof m.wdir === 'number' ? m.wdir : null, plafond: plafond.length ? Math.min(...plafond) : null };
  }).sort((a, b) => a.t.localeCompare(b.t));
}

// NOTAM de LFOB par l'API NMS de la FAA (NOTAM Management System, relais de l'échange international OACI).
// Secrets Cloudflare : FAA_CLIENT_ID (« key ») et FAA_CLIENT_SECRET (« secret »), FAA_NMS_HOST facultatif
// (environnement de test par défaut, tant que la FAA n'a pas ouvert la production). Jeton OAuth valable 30 min.
// Gardé 10 min en cache. Les NOTAM d'obstacles (codes Q OB / OL, grues) ne sont pas affichés, à la demande du club.
const NMS_HOTE = 'https://api-staging.cgifederal-aim.com';
const CACHE_NMS_JETON = 'https://cache.acbt60.local/dashboard/api/nms-jeton';
async function jetonNms(env, cache, waitUntil, hote) {
  if (cache) {
    const deja = await cache.match(new Request(CACHE_NMS_JETON));
    if (deja) return deja.text();
  }
  const r = await fetch(`${hote}/v1/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${String(env.FAA_CLIENT_ID).trim()}:${String(env.FAA_CLIENT_SECRET).trim()}`)}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'ACBT-tableau-de-bord/1.0' },
    body: 'grant_type=client_credentials',
  });
  const brut = await r.text();
  let j = null;
  try { j = JSON.parse(brut); } catch { /* pas du JSON */ }
  if (!r.ok || !j?.access_token) throw new Error(`jeton FAA ${r.status} (${r.headers.get('server') || ''} ${r.headers.get('via') || ''}) ${brut.replace(/\s+/g, ' ').slice(0, 160)}`);
  const duree = Math.max(60, Number(j.expires_in || 1799) - 300);
  if (cache) waitUntil?.(cache.put(new Request(CACHE_NMS_JETON), new Response(j.access_token, { headers: { 'Cache-Control': `public, max-age=${duree}` } })));
  return j.access_token;
}

async function lireNotam(env, cache, waitUntil, debug, lieu = 'LFOB') {
  if (!debug) lieu = 'LFOB';
  if (!env.FAA_CLIENT_ID || !env.FAA_CLIENT_SECRET) return { ok: false, raison: 'cle' };
  if (cache && !debug) {
    const deja = await cache.match(new Request(CACHE_NOTAM));
    if (deja) return deja.json();
  }
  const hote = String(env.FAA_NMS_HOST || NMS_HOTE).replace(/\/+$/, '');
  const u = `${hote}/nmsapi/v1/notams?location=${lieu}`;
  const appel = async (t) => fetch(u, { headers: { Authorization: `Bearer ${t}`, nmsResponseFormat: 'GEOJSON', Accept: 'application/json', 'User-Agent': 'ACBT-tableau-de-bord/1.0' } });
  let r = await appel(await jetonNms(env, cache, waitUntil, hote));
  if (r.status === 401 && cache) { await cache.delete(new Request(CACHE_NMS_JETON)); r = await appel(await jetonNms(env, cache, waitUntil, hote)); }
  if (!r.ok) return { ok: false, raison: `FAA ${r.status}`, detail: (await r.text()).replace(/\s+/g, ' ').slice(0, 200) };
  const j = await r.json();
  const items = j.data?.geojson || j.items || [];
  const maintenant = Date.now();
  const liste = items.map((it) => {
    const core = it.properties?.coreNOTAMData || {};
    const n = core.notam || {};
    const icao = (core.notamTranslation || []).find((t) => t.type === 'ICAO')?.formattedText || '';
    const q = (icao.match(/Q\)\s*[A-Z]{4}\/Q([A-Z]{2})([A-Z]{2})/) || String(n.selectionCode || '').match(/^Q([A-Z]{2})([A-Z]{2})/) || []);
    const e = (icao.match(/E\)\s*([\s\S]*?)(?:\n[FG]\)|$)/) || [])[1] || n.text || '';
    const texteNet = e.replace(/\s+/g, ' ').trim();
    // SNOWTAM (état de surface des pistes, format OACI propre) : affiché en tête, avec un badge dédié
    const snow = /^SW/i.test(n.series || '') || /SNOWTAM/i.test(`${n.text || ''} ${icao} ${n.type || ''} ${n.number || ''}`);
    return {
      numero: n.number ? `${n.series || ''}${n.number}` : n.id || '',
      sujet: q[1] || null,
      etat: q[2] || null,
      debut: n.effectiveStart || null,
      fin: n.effectiveEnd || null,
      texte: texteNet,
      snow,
      sup: /\bSUP\s*(?:AIP\s*)?\d+\/\d+/i.test(texteNet),
      obstacle: !snow && q[1] === 'OB' || q[1] === 'OL' || /\b(OBST|CRANE|GRUE)/i.test(texteNet),
    };
  }).filter((n, i, l) => !n.obstacle && !(n.fin && /^\d{4}-/.test(n.fin) && Date.parse(n.fin) < maintenant) && l.findIndex((x) => x.numero === n.numero) === i)
    .sort((a, b) => Number(b.snow) - Number(a.snow) || String(b.debut).localeCompare(String(a.debut)));
  if (debug && lieu !== 'LFOB') return { ok: true, lieu, total: items.length, snowtam: liste.filter((n) => n.snow), exemples: items.filter((it) => /SNOW/i.test(JSON.stringify(it))).slice(0, 2) };
  const corps = { ok: true, source: hote.includes('staging') ? 'test' : 'prod', total: items.length, notam: liste.filter((n) => !n.sup), sup: liste.filter((n) => n.sup) };
  if (cache) waitUntil?.(cache.put(new Request(CACHE_NOTAM), new Response(JSON.stringify(corps), { headers: { 'Cache-Control': 'public, max-age=600' } })));
  return corps;
}

// Vigilance météo de Météo-France (API DPVigilance, abonnement « Vigilance ») : l'Oise et ses 6 départements voisins.
// Gardée 10 min en cache. Pour chaque département : les phénomènes jaune, orange ou rouge d'aujourd'hui et de demain,
// avec le début et la fin de la vigilance (les zones littorales « 7610 » sont rattachées à la Seine-Maritime).
const DEPARTEMENTS = [['60', 'Oise'], ['80', 'Somme'], ['02', 'Aisne'], ['95', 'Val-d’Oise'], ['77', 'Seine-et-Marne'], ['27', 'Eure'], ['76', 'Seine-Maritime']];
const PHENOMENES = { 1: 'vent violent', 2: 'pluie-inondation', 3: 'orages', 4: 'crues', 5: 'neige-verglas', 6: 'canicule', 7: 'grand froid', 8: 'avalanches', 9: 'vagues-submersion' };
const CACHE_VIGILANCE = 'https://cache.acbt60.local/dashboard/api/vigilance';
async function lireVigilance(env, cache, waitUntil) {
  if (!env.METEOFRANCE_APIKEY) return null;
  if (cache) {
    const deja = await cache.match(new Request(CACHE_VIGILANCE));
    if (deja) return deja.json();
  }
  const r = await fetch('https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours', { headers: { apikey: String(env.METEOFRANCE_APIKEY).trim(), Accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const periodes = j?.product?.periods || [];
  const departements = DEPARTEMENTS.map(([id, nom]) => {
    const ph = {};
    for (const p of periodes) {
      for (const d of p.timelaps?.domain_ids || []) {
        if (d.domain_id !== id && d.domain_id !== `${id}10`) continue;
        for (const it of d.phenomenon_items || []) {
          for (const t of it.timelaps_items || []) {
            if (Number(t.color_id) < 2) continue;
            const x = (ph[it.phenomenon_id] ||= { phenomene: PHENOMENES[it.phenomenon_id] || 'phénomène', couleur: 0, debut: t.begin_time, fin: t.end_time });
            x.couleur = Math.max(x.couleur, Number(t.color_id));
            if (t.begin_time < x.debut) x.debut = t.begin_time;
            if (t.end_time > x.fin) x.fin = t.end_time;
          }
        }
      }
    }
    const liste = Object.values(ph).sort((a, b) => b.couleur - a.couleur || a.debut.localeCompare(b.debut));
    return { id, nom, couleur: liste.length ? liste[0].couleur : 1, phenomenes: liste };
  });
  const corps = { maj: j?.product?.update_time || null, departements };
  if (cache) waitUntil?.(cache.put(new Request(CACHE_VIGILANCE), new Response(JSON.stringify(corps), { headers: { 'Cache-Control': 'public, max-age=600' } })));
  return corps;
}
