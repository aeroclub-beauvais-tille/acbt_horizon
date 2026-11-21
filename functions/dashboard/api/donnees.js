// Données du tableau de bord TV (/dashboard, protégé par son mot de passe dans le middleware).
// Un seul appel par minute depuis la télé : flotte et réservations (Aerogest), instructeurs, MAA, METAR, TAF, NOTAM.
// Chaque source est facultative : si l'une ne répond pas, les autres s'affichent quand même.
import { lireFlotte } from '../../membre/api/flotte.js';
import { tableMaa } from '../../_maa.js';

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
  const [flotte, maa, metar, taf, notam, historique] = await Promise.all([
    env.AEROGEST_PLANNING_URL
      ? lireFlotte(env.AEROGEST_PLANNING_URL, new Date(), fetch, { jour: true, instructeurs: true, brut: debug === 'instructeurs' }).catch(() => null)
      : null,
    lireMaa(env).catch(() => null),
    avwx(env, 'metar').catch(() => null),
    avwx(env, 'taf').catch(() => null),
    lireNotam(env, cache, waitUntil).catch((e) => ({ ok: false, raison: String(e.message || e) })),
    lireHistorique().catch(() => null),
  ]);
  const corps = { ok: true, maj: new Date().toISOString(), flotte, maa, metar, taf, notam, historique, meteofrance: Boolean(env.METEOFRANCE_BASIC) };
  const rep = (portee) => new Response(JSON.stringify(corps), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `${portee}, max-age=50` },
  });
  if (cache && !debug) waitUntil?.(cache.put(new Request(CACHE), rep('public')));
  return rep('private');
}

async function lireMaa(env) {
  if (!env.DB) return null;
  await tableMaa(env.DB);
  const depuis = new Date().toISOString();
  const { results } = await env.DB.prepare(
    'SELECT id, numero, motif, debut, fin, recu FROM maa WHERE fin IS NULL OR fin >= ?1 ORDER BY debut, numero LIMIT 20',
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

// NOTAM de LFOB par l'API NOTAM de la FAA (relais officiel de l'échange international OACI).
// Secrets Cloudflare : FAA_CLIENT_ID et FAA_CLIENT_SECRET. Gardé 10 min en cache (quotas de la FAA).
// Les NOTAM d'obstacles (codes Q OB / OL, grues) ne sont pas affichés, à la demande du club.
async function lireNotam(env, cache, waitUntil) {
  if (!env.FAA_CLIENT_ID || !env.FAA_CLIENT_SECRET) return { ok: false, raison: 'cle' };
  if (cache) {
    const deja = await cache.match(new Request(CACHE_NOTAM));
    if (deja) return deja.json();
  }
  const u = new URL(env.FAA_NOTAM_URL || 'https://external-api.faa.gov/notamapi/v1/notams');
  u.searchParams.set('icaoLocation', 'LFOB');
  u.searchParams.set('pageSize', '200');
  const r = await fetch(u, { headers: { client_id: env.FAA_CLIENT_ID, client_secret: env.FAA_CLIENT_SECRET, Accept: 'application/json' } });
  if (!r.ok) return { ok: false, raison: `FAA ${r.status}` };
  const j = await r.json();
  const maintenant = Date.now();
  const liste = (j.items || []).map((it) => {
    const core = it.properties?.coreNOTAMData || {};
    const n = core.notam || {};
    const icao = (core.notamTranslation || []).find((t) => t.type === 'ICAO')?.formattedText || '';
    const q = (icao.match(/Q\)\s*[A-Z]{4}\/Q([A-Z]{2})([A-Z]{2})/) || []);
    const e = (icao.match(/E\)\s*([\s\S]*?)(?:\n[FG]\)|$)/) || [])[1] || n.text || '';
    const texteNet = e.replace(/\s+/g, ' ').trim();
    return {
      numero: n.number || n.id || '',
      sujet: q[1] || null,
      etat: q[2] || null,
      debut: n.effectiveStart || null,
      fin: n.effectiveEnd || null,
      texte: texteNet,
      sup: /\bSUP\s*(?:AIP\s*)?\d+\/\d+/i.test(texteNet),
      obstacle: q[1] === 'OB' || q[1] === 'OL' || /\b(OBST|CRANE|GRUE)/i.test(texteNet),
    };
  }).filter((n) => !n.obstacle && !(n.fin && /^\d{4}-/.test(n.fin) && Date.parse(n.fin) < maintenant));
  const corps = { ok: true, notam: liste.filter((n) => !n.sup), sup: liste.filter((n) => n.sup) };
  if (cache) waitUntil?.(cache.put(new Request(CACHE_NOTAM), new Response(JSON.stringify(corps), { headers: { 'Cache-Control': 'public, max-age=600' } })));
  return corps;
}
