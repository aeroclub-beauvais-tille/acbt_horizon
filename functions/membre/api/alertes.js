// Abonnement d'un téléphone admin aux alertes (réservé aux membres connectés, comme tout /membre/).
//   GET     → clé publique VAPID, pour que le téléphone puisse s'abonner
//   POST    { abonnement, motDePasse, nom } → enregistre le téléphone (mot de passe admin exigé)
//   DELETE  { endpoint } → retire le téléphone
import { clesVapid, estAdmin, tablesAlertes, json } from '../../_alertes.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  const { publique } = await clesVapid(env.DB);
  return json({ ok: true, cle: publique });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, erreur: 'Demande illisible.' }, 400); }
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  const endpoint = d.abonnement && d.abonnement.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return json({ ok: false, erreur: 'Abonnement invalide.' }, 400);
  await tablesAlertes(env.DB);
  await env.DB.prepare(`INSERT INTO abonnements (endpoint, nom, cree, admin, messages) VALUES (?1, ?2, ?3, 1, 0)
    ON CONFLICT(endpoint) DO UPDATE SET admin = 1, nom = excluded.nom`)
    .bind(endpoint, String(d.nom || '').slice(0, 60), new Date().toISOString()).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok: false }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false }, 400); }
  await tablesAlertes(env.DB);
  // Le téléphone ne reçoit plus les alertes admin ; il garde les messages du club s'il les a demandés
  await env.DB.prepare('UPDATE abonnements SET admin = 0 WHERE endpoint = ?1').bind(String(d.endpoint || '')).run();
  await env.DB.prepare('DELETE FROM abonnements WHERE endpoint = ?1 AND admin = 0 AND messages = 0').bind(String(d.endpoint || '')).run();
  return json({ ok: true });
}
