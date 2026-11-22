// Abonnement d'un téléphone de membre aux messages du club (réservé aux membres connectés, comme tout /membre/).
//   GET     → clé publique VAPID
//   POST    { abonnement } → le téléphone reçoit les messages du club envoyés en notification
//   DELETE  { endpoint }   → ne les reçoit plus
import { clesVapid, tablesAlertes, json } from '../../../_alertes.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  const { publique } = await clesVapid(env.DB);
  return json({ ok: true, cle: publique });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, erreur: 'Demande illisible.' }, 400); }
  const endpoint = d.abonnement && d.abonnement.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return json({ ok: false, erreur: 'Abonnement invalide.' }, 400);
  await tablesAlertes(env.DB);
  await env.DB.prepare(`INSERT INTO abonnements (endpoint, nom, cree, admin, messages) VALUES (?1, '', ?2, 0, 1)
    ON CONFLICT(endpoint) DO UPDATE SET messages = 1`).bind(endpoint, new Date().toISOString()).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok: false }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false }, 400); }
  await tablesAlertes(env.DB);
  const e = String(d.endpoint || '');
  await env.DB.prepare('UPDATE abonnements SET messages = 0 WHERE endpoint = ?1').bind(e).run();
  await env.DB.prepare('DELETE FROM abonnements WHERE endpoint = ?1 AND admin = 0 AND messages = 0').bind(e).run();
  return json({ ok: true });
}
