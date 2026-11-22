// Dernière alerte (ou dernier message du club), lue par le téléphone quand une notification le réveille.
import { tablesAlertes, json } from '../../../_alertes.js';
import { tableMessages } from '../../../_messages.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false }, 503);
  await tablesAlertes(env.DB);
  const dernier = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'dernier_push'").first();
  const quoi = dernier ? JSON.parse(dernier.valeur) : null;
  if (quoi?.type === 'message') {
    await tableMessages(env.DB);
    const m = await env.DB.prepare('SELECT titre, texte, date FROM messages_club WHERE id = ?1').bind(Number(quoi.id) || 0).first();
    if (m) return json({ ok: true, alerte: { titre: m.titre, texte: m.texte || 'Message du club', lien: '/membre/', date: m.date } });
  }
  const a = await env.DB.prepare('SELECT titre, texte, lien, date FROM alertes ORDER BY id DESC LIMIT 1').first();
  return json({ ok: true, alerte: a || null });
}
