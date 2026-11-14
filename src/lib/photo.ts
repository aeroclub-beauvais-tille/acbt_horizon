// Photos allégées : scripts/optimiser-images.mjs prépare des versions WebP en plusieurs largeurs,
// et ces fonctions donnent au navigateur la bonne taille selon l'écran.
// Si une photo n'a pas (encore) de version allégée, on sert simplement l'originale.
import { readFileSync } from 'node:fs';
import { asset } from './utils';
import cadrage from '../data/cadrage.json';

// Cadrage choisi dans le back-office (rubrique « Cadrage des photos ») : partie de la photo à garder
// visible quand elle est rognée, et zoom éventuel.
const POSITIONS: Record<string, string> = {
  'Centre': '50% 50%', 'Haut': '50% 12%', 'Bas': '50% 88%', 'Gauche': '12% 50%', 'Droite': '88% 50%',
  'Haut gauche': '12% 12%', 'Haut droite': '88% 12%', 'Bas gauche': '12% 88%', 'Bas droite': '88% 88%',
};
type Cadre = { image: string; position?: string; zoom?: number };
const cadres = new Map<string, Cadre>(((cadrage as { photos: Cadre[] }).photos ?? []).filter((c) => c?.image).map((c) => [c.image, c]));

/** Style de cadrage d'une photo affichée en balise img (vide si la photo n'a pas de réglage). */
function styleCadre(src: string | undefined) {
  const c = src ? cadres.get(src) : undefined;
  if (!c) return undefined;
  const pos = POSITIONS[c.position ?? ''] ?? '50% 50%';
  const z = Number(c.zoom) > 100 ? Math.min(Number(c.zoom), 300) / 100 : 1;
  return `object-position: ${pos};` + (z > 1 ? ` scale: ${z}; transform-origin: ${pos};` : '');
}

/** Position d'une photo utilisée en fond (en-têtes de page). */
export function positionFond(src: string | undefined) {
  const c = src ? cadres.get(src) : undefined;
  return c ? POSITIONS[c.position ?? ''] ?? 'center' : 'center';
}

type Entree = { w: number; h: number; l: number[] };
let manifeste: Record<string, Entree> = {};
try { manifeste = JSON.parse(readFileSync('public/opt/manifeste.json', 'utf8')); } catch { /* pas de versions allégées : originales */ }

const variante = (src: string, l: number) => encodeURI(asset(`/opt${src.replace(/^\/uploads/, '').replace(/\.[^.]+$/, '')}-${l}.webp`));

/** Attributs à poser sur une balise img : <img {...photo(chemin, '(min-width: 900px) 33vw, 100vw')} alt="" />. */
export function photo(src: string | undefined, sizes = '100vw') {
  const e = src ? manifeste[src] : undefined;
  const style = styleCadre(src);
  if (!src || !e) return { src: src ? asset(src) : undefined, style };
  const defaut = e.l.find((l) => l >= 960) ?? e.l[e.l.length - 1];
  return { src: variante(src, defaut), srcset: e.l.map((l) => `${variante(src, l)} ${l}w`).join(', '), sizes, style };
}

/** Adresse d'une seule version allégée (fonds en CSS, préchargement). */
export function photoUrl(src: string | undefined, largeur = 1600) {
  const e = src ? manifeste[src] : undefined;
  if (!src || !e) return src ? asset(src) : '';
  return variante(src, e.l.find((l) => l >= largeur) ?? e.l[e.l.length - 1]);
}
