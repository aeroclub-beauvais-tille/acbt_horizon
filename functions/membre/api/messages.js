// Messages du club pour la TV (réservé aux membres connectés, comme tout /membre/).
//   GET                                   → messages en cours (TV, notification ou à valider)
//   POST   { titre, texte, auteur, important, jours, tv, push, valider, motDePasse } → publie (mot de passe admin)
//   DELETE { id, motDePasse }             → retire un message (mot de passe admin)
import { estAdmin, json, noterEnvoi, pousser, tablesAlertes } from '../../_alertes.js';
import { lireMessages, tableMessages } from '../../_messages.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, messages: [] }, 503);
  return json({ ok: true, messages: await lireMessages(env.DB, 50, { tv: false }) });
}

async function lire(request) { try { return await request.json(); } catch { return null; } }

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  const d = await lire(request);
  if (!d) return json({ ok: false, erreur: 'Demande illisible.' }, 400);
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  // Première lettre en majuscule pour le titre et le texte
  const maj = (t) => t.replace(/^\p{L}/u, (c) => c.toUpperCase());
  const titre = maj(String(d.titre || '').trim().slice(0, 120));
  const texte = maj(String(d.texte || '').trim().slice(0, 600));
  const auteur = String(d.auteur || '').trim().slice(0, 60);
  if (!titre) return json({ ok: false, erreur: 'Indiquez au moins un titre.' }, 400);
  const jours = Math.min(90, Math.max(0, Number(d.jours) || 0));
  const fin = jours ? new Date(Date.now() + jours * 86400000).toISOString() : null;
  const tv = d.tv !== false, push = !!d.push, valider = !!d.valider;
  if (!tv && !push && !valider) return json({ ok: false, erreur: 'Choisissez au moins une diffusion.' }, 400);
  await tableMessages(env.DB);
  const r = await env.DB.prepare('INSERT INTO messages_club (titre, texte, auteur, important, date, fin, tv, push, valider) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
    .bind(titre, texte || null, auteur || null, d.important ? 1 : 0, new Date().toISOString(), fin, tv ? 1 : 0, push ? 1 : 0, valider ? 1 : 0).run();
  const id = r.meta.last_row_id;
  let envoyes = null;
  if (push) {
    await tablesAlertes(env.DB);
    await noterEnvoi(env.DB, { type: 'message', id });
    const details = await pousser(env, new URL(request.url).origin, 'messages');
    envoyes = details.filter((x) => x.ok).length;
  }
  return json({ ok: true, id, envoyes });
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
