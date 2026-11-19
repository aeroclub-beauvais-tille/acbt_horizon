// Liste des bulletins MAA en cours ou à venir, pour le bandeau de l'appli (protégée par le mot de passe du club,
// comme tout /membre/). Les MAA terminés depuis plus de 2 jours ne sont plus envoyés.
import { tableMaa, json } from '../../_maa.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, maa: [] }, 503);
  await tableMaa(env.DB);
  const depuis = new Date(Date.now() - 2 * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT id, numero, motif, debut, fin, recu FROM maa WHERE fin IS NULL OR fin >= ?1 ORDER BY debut LIMIT 20',
  ).bind(depuis).all();
  return json({ ok: true, maa: results });
}
