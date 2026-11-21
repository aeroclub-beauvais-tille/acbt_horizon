// Garde de l'espace membre sur Cloudflare Pages : /membre/ et /uploads/membre/ ne s'ouvrent qu'avec le cookie de session.
// L'écran de connexion, l'icône et la fiche de l'appli restent accessibles à tous.
import { jeton, lireCookie, egal, jetonDash, lireCookieDash, motDePasseDash } from './_session.js';

const LIBRES = ['/membre/connexion', '/membre/manifest.webmanifest'];

export async function onRequest({ request, env, next }) {
  const { pathname, search } = new URL(request.url);
  // Tableau de bord TV : son propre mot de passe et son propre cookie
  if ((pathname === '/dashboard' || pathname.startsWith('/dashboard/')) && !pathname.startsWith('/dashboard/connexion')) {
    if (egal(lireCookieDash(request), await jetonDash(motDePasseDash(env)))) {
      const rep = await next();
      const r = new Response(rep.body, rep);
      if (!r.headers.has('Cache-Control') || !pathname.startsWith('/dashboard/api/')) r.headers.set('Cache-Control', 'private, no-cache');
      r.headers.set('X-Robots-Tag', 'noindex');
      return r;
    }
    if (pathname.startsWith('/dashboard/api/')) return new Response('{"ok":false}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    return Response.redirect(new URL(`/dashboard/connexion/?retour=${encodeURIComponent(pathname + search)}`, request.url).href, 302);
  }
  const protege = (pathname === '/membre' || pathname.startsWith('/membre/') || pathname.startsWith('/uploads/membre/'))
    && !LIBRES.some((p) => pathname.startsWith(p));
  if (!protege) return next();

  if (!env.MOT_DE_PASSE_MEMBRES) {
    return new Response("Espace membre fermé : le mot de passe du club n'est pas encore réglé dans Cloudflare (MOT_DE_PASSE_MEMBRES).", { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (egal(lireCookie(request), await jeton(env.MOT_DE_PASSE_MEMBRES))) {
    const rep = await next();
    const r = new Response(rep.body, rep);
    r.headers.set('Cache-Control', 'private, no-cache');
    r.headers.set('X-Robots-Tag', 'noindex');
    return r;
  }
  const retour = encodeURIComponent(pathname + search);
  return Response.redirect(new URL(`/membre/connexion/?retour=${retour}`, request.url).href, 302);
}
