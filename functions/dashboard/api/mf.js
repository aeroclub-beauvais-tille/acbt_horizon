// Relais vers les API publiques de Météo-France (radar, AROME…) pour le tableau de bord TV.
// La clé (« Basic … » de l'application, onglet Générer token du portail) est un secret Cloudflare : METEOFRANCE_BASIC.
// Le serveur en tire un jeton OAuth2 valable 1 h, gardé 55 min en cache, et ne relaie que public-api.meteofrance.fr.
// Usage : /dashboard/api/mf?chemin=/public/DPRadar/v1/...   (chemin relatif à https://public-api.meteofrance.fr)

const HOTE = 'https://public-api.meteofrance.fr';
const CACHE_JETON = 'https://cache.acbt60.local/dashboard/api/mf-jeton';

export async function onRequestGet({ env, request, waitUntil }) {
  if (!env.METEOFRANCE_BASIC) return new Response('{"ok":false,"raison":"cle"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
  const chemin = new URL(request.url).searchParams.get('chemin') || '';
  if (!chemin.startsWith('/public/')) return new Response('chemin refusé', { status: 400 });
  const cible = new URL(chemin, HOTE);
  if (cible.origin !== HOTE) return new Response('chemin refusé', { status: 400 });

  const cache = globalThis.caches?.default;
  let r = await fetch(cible, { headers: { Authorization: `Bearer ${await jeton(env, cache, waitUntil)}` } });
  if (r.status === 401) r = await fetch(cible, { headers: { Authorization: `Bearer ${await jeton(env, cache, waitUntil, true)}` } });
  const rep = new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=120' } });
  return rep;
}

async function jeton(env, cache, waitUntil, neuf = false) {
  if (cache && !neuf) {
    const deja = await cache.match(new Request(CACHE_JETON));
    if (deja) return deja.text();
  }
  const basic = String(env.METEOFRANCE_BASIC).replace(/^Basic\s+/i, '').trim();
  const r = await fetch(`${HOTE.replace('public-api', 'portail-api')}/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('jeton Météo-France ' + r.status);
  const { access_token: t } = await r.json();
  if (cache) waitUntil?.(cache.put(new Request(CACHE_JETON), new Response(t, { headers: { 'Cache-Control': 'public, max-age=3300' } })));
  return t;
}
