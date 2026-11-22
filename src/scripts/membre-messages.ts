// Messages du club côté membre :
//  - cloche dans la barre du haut : recevoir (ou non) les messages du club en notification sur ce téléphone ;
//  - à l'ouverture de l'appli, les messages « à valider » non encore lus s'affichent l'un après l'autre,
//    et il faut cliquer « J'ai lu » pour continuer. Tout le club partage un seul mot de passe :
//    la lecture est donc retenue sur ce téléphone (et personne ne peut voir qui a lu quoi).
import { url } from '../lib/utils';

interface Msg { id: number; titre: string; texte: string | null; auteur: string | null; date: string; valider: boolean }
const LUS = 'acbt-messages-lus';
const lus = (): number[] => { try { return JSON.parse(localStorage.getItem(LUS) || '[]'); } catch { return []; } };
const marquer = (id: number) => { try { localStorage.setItem(LUS, JSON.stringify([...new Set([...lus(), id])].slice(-200))); } catch { /* privé */ } };
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
const ABO = url('/membre/api/messages/abonnement');

function quand(iso: string) {
  const d = new Date(iso), n = new Date();
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const j = Math.round((new Date(n.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  return j === 0 ? `aujourd'hui ${h}` : j === 1 ? `hier ${h}` : `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${h}`;
}

async function abonnement() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration(url('/'));
  return reg ? { reg, sub: await reg.pushManager.getSubscription() } : null;
}

// Cloche : état et bascule de l'abonnement aux messages du club
async function cloche(bouton: HTMLButtonElement) {
  const a = await abonnement().catch(() => null);
  if (!a) return; // navigateur sans notifications (iPhone : seulement dans l'appli installée)
  let actif = false;
  try { actif = !!a.sub && localStorage.getItem('acbt-notif-club') === a.sub.endpoint; } catch { /* privé */ }
  const maj = () => {
    bouton.classList.toggle('on', actif);
    bouton.setAttribute('aria-label', actif ? 'Notifications du club activées (toucher pour couper)' : 'Recevoir les messages du club en notification');
    bouton.title = bouton.getAttribute('aria-label')!;
  };
  maj();
  bouton.hidden = false;
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    try {
      const reg = (await navigator.serviceWorker.getRegistration(url('/'))) || (await navigator.serviceWorker.ready);
      if (actif) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await fetch(ABO, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        try { localStorage.removeItem('acbt-notif-club'); } catch { /* privé */ }
        actif = false;
        bulle(bouton, 'Vous ne recevrez plus les messages du club en notification.');
      } else {
        if ((await Notification.requestPermission()) !== 'granted') { bulle(bouton, 'Notifications refusées : autorisez-les dans les réglages du téléphone.'); return; }
        const { cle } = await (await fetch(ABO, { credentials: 'same-origin', cache: 'no-store' })).json();
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cle) });
        const r = await fetch(ABO, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ abonnement: sub.toJSON() }) });
        if (!r.ok) throw new Error('serveur');
        try { localStorage.setItem('acbt-notif-club', sub.endpoint); } catch { /* privé */ }
        actif = true;
        bulle(bouton, 'Ce téléphone recevra les messages du club.');
      }
    } catch { bulle(bouton, 'Impossible pour le moment (pas de réseau ?).'); }
    finally { bouton.disabled = false; maj(); }
  });
}

// Petite bulle d'information sous la barre du haut
function bulle(pres: HTMLElement, texte: string) {
  document.querySelector('.bulle-notif')?.remove();
  const b = document.createElement('div');
  b.className = 'bulle-notif';
  b.setAttribute('role', 'status');
  b.textContent = texte;
  document.body.append(b);
  const r = pres.getBoundingClientRect();
  b.style.top = `${r.bottom + 8}px`;
  setTimeout(() => b.remove(), 3500);
}

// Messages à valider : une feuille en bas de l'écran, à fermer seulement par « J'ai lu »
async function aValider(dlg: HTMLDialogElement) {
  let l: Msg[] = [];
  try {
    const d = await (await fetch(url('/membre/api/messages'), { credentials: 'same-origin', cache: 'no-store' })).json();
    const deja = new Set(lus());
    l = (d.messages || []).filter((m: Msg) => m.valider && !deja.has(m.id)).sort((a: Msg, b: Msg) => a.id - b.id);
  } catch { return; }
  if (!l.length) return;
  let i = 0;
  const corps = dlg.querySelector<HTMLElement>('.mc-corps')!;
  const montrer = () => {
    const m = l[i];
    corps.innerHTML = `<span class="mc-tag">Message du club</span><h3>${esc(majuscule(m.titre))}</h3>${m.texte ? `<p>${esc(majuscule(m.texte)).replace(/\n/g, '<br>')}</p>` : ''}`
      + `<small>${m.auteur ? esc(m.auteur) + ' · ' : ''}${quand(m.date)}</small>${l.length > 1 ? `<small class="mc-n">${i + 1} message${''} sur ${l.length}</small>` : ''}`;
  };
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // pas de fermeture par la touche Échap / retour
  dlg.querySelector('#mc-lu')!.addEventListener('click', () => {
    marquer(l[i].id);
    if (++i < l.length) montrer(); else dlg.close();
  });
  montrer();
  dlg.showModal();
}

export function messagesClub() {
  const b = document.getElementById('btn-notif') as HTMLButtonElement | null;
  if (b) cloche(b);
  const dlg = document.getElementById('msg-club') as HTMLDialogElement | null;
  if (dlg) aValider(dlg);
}

// Première lettre en majuscule (titre et texte)
function majuscule(t: string) { return t.replace(/^\s*\p{L}/u, (c) => c.toUpperCase()); }
