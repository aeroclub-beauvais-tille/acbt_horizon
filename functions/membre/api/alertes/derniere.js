// Dernière alerte, lue par le téléphone quand une notification le réveille.
import { tablesAlertes, json } from '../../../_alertes.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false }, 503);
  await tablesAlertes(env.DB);
  const a = await env.DB.prepare('SELECT titre, texte, lien, date FROM alertes ORDER BY id DESC LIMIT 1').first();
  return json({ ok: true, alerte: a || null });
}
