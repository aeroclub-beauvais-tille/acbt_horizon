// Connexion au tableau de bord TV (/dashboard) : vérifie le mot de passe et pose le cookie (un an).
import { jetonDash, motDePasseDash, poserCookieDash, egal } from '../_session.js';

export async function onRequestPost({ request, env }) {
  const json = (corps, status, cookie) => new Response(JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });
  let motDePasse = '';
  try { ({ motDePasse = '' } = await request.json()); } catch { /* formulaire vide */ }
  const attendu = await jetonDash(motDePasseDash(env));
  if (!egal(await jetonDash(motDePasse), attendu)) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ ok: false }, 401);
  }
  return json({ ok: true }, 200, poserCookieDash(attendu));
}
