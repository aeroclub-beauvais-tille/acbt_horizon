// Messages du club pour la TV (réservé aux membres connectés, comme tout /membre/).
//   GET                                   → messages en cours
//   POST   { titre, texte, auteur, important, jours, motDePasse } → publie (mot de passe admin)
//   DELETE { id, motDePasse }             → retire un message (mot de passe admin)
import { estAdmin, json } from '../../_alertes.js';
import { lireMessages, tableMessages } from '../../_messages.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, messages: [] }, 503);
  return json({ ok: true, messages: await lireMessages(env.DB, 50) });
}

async function lire(request) { try { return await request.json(); } catch { return null; } }

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  const d = await lire(request);
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  const titre = String(d.titre || '').trim().slice(0, 120);
  const texte = String(d.texte || '').trim().slice(0, 600);
  const auteur = String(d.auteur || '').trim().slice(0, 60);
  if (!titre) return json({ ok: false, erreur: 'Indiquez au moins un titre.' }, 400);
  const jours = Math.min(90, Math.max(0, Number(d.jours) || 0));
  const fin = jours ? new Date(Date.now() + jours * 86400000).toISOString() : null;
  await tableMessages(env.DB);
  const r = await env.DB.prepare('INSERT INTO messages_club (titre, texte, auteur, important, date, fin) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(titre, texte || null, auteur || null, d.important ? 1 : 0, new Date().toISOString(), fin).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok: false }, 503);
  const d = await lire(request);
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  await tableMessages(env.DB);
  await env.DB.prepare('DELETE FROM messages_club WHERE id = ?1').bind(Number(d.id) || 0).run();
  return json({ ok: true });
}
