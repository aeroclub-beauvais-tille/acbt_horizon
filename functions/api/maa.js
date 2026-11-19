// Dépôt d'un bulletin MAA (PDF), envoyé automatiquement par le script qui surveille la boîte mail du club
// (scripts/maa-gmail.gs) ou, plus tard, par un Email Worker Cloudflare.
//   POST /api/maa   Authorization: Bearer <MAA_CLE>   corps = le PDF (application/pdf)
// La clé est la variable secrète MAA_CLE du projet Cloudflare (Réglages > Variables et secrets).
import { tableMaa, lireMaa, empreinte, json } from '../_maa.js';
import { egal } from '../_session.js';

const MAX = 5 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base D1 non reliée (liaison DB manquante).' }, 503);
  if (!env.MAA_CLE) return json({ ok: false, erreur: 'Clé MAA_CLE non réglée dans Cloudflare.' }, 503);
  const auth = request.headers.get('Authorization') || '';
  const cle = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!egal(cle, String(env.MAA_CLE).trim())) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ ok: false, erreur: 'Clé refusée.' }, 401);
  }
  const octets = new Uint8Array(await request.arrayBuffer());
  if (!octets.length || octets.length > MAX) return json({ ok: false, erreur: 'PDF vide ou trop gros.' }, 413);
  if (String.fromCharCode(...octets.subarray(0, 5)) !== '%PDF-') return json({ ok: false, erreur: "Ce n'est pas un PDF." }, 400);

  const url = new URL(request.url);
  const recu = new Date(url.searchParams.get('recu') || Date.now());
  const lu = await lireMaa(octets, isNaN(recu) ? new Date() : recu);
  if (!lu) return json({ ok: false, erreur: "PDF reçu, mais ce n'est pas un MAA (ligne « VALID » introuvable)." }, 422);

  const id = await empreinte(octets);
  await tableMaa(env.DB);
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO maa (id, numero, motif, debut, fin, recu, nom, pdf)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, lu.numero, lu.motif, lu.debut, lu.fin, new Date().toISOString(), url.searchParams.get('nom') || null, octets)
    .run();
  return json({ ok: true, nouveau: r.meta.changes > 0, id, ...lu });
}
