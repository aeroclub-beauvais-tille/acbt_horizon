// Aides pour les documents de l'espace membre : nom automatique, validité, historique.
import { PREAVIS_JOURS } from '../content.config';

export interface DonneesDoc {
  titre?: string;
  categorie: string;
  avions: string[];
  rubrique?: string;
  type?: string;
  debut?: Date;
  fin?: Date;
  remplace?: string;
  fichier?: string;
  lien?: string;
  description?: string;
  mis_a_jour?: Date;
  ordre: number;
}
export interface Doc extends DonneesDoc {
  id: string;
  // Rempli après coup : vrai si un autre document remplace celui-ci (il passe en historique).
  archive?: boolean;
}

/** Titre affiché : saisi à la main, sinon construit « <immatriculation> - <type> », sinon le type seul. */
export function titreDoc(d: { titre?: string; type?: string; avions?: string[] }): string {
  if (d.titre && d.titre.trim()) return d.titre.trim();
  if (d.type && d.avions?.length) return `${d.avions[0]} - ${d.type}`;
  return d.type ?? 'Document';
}

export type EtatCode = 'sans-fin' | 'valide' | 'bientot' | 'expire' | 'a-venir';

/**
 * État de validité calculé pour une date donnée. Sert au tri et à un repli sans JavaScript ;
 * le badge affiché est recalculé dans le navigateur pour rester juste même hors ligne.
 */
export function etatValidite(d: { debut?: Date; fin?: Date }, maintenant: Date = new Date()): { code: EtatCode; jours?: number } {
  const t = maintenant.getTime();
  if (d.debut && d.debut.getTime() > t) return { code: 'a-venir' };
  if (!d.fin) return { code: 'sans-fin' };
  const jours = Math.ceil((d.fin.getTime() - t) / 86_400_000);
  if (jours < 0) return { code: 'expire', jours };
  if (jours <= PREAVIS_JOURS) return { code: 'bientot', jours };
  return { code: 'valide', jours };
}

/** Marque comme « archive » tout document cité dans le champ « remplace » d'un autre. */
export function marquerHistorique<T extends Doc>(docs: T[]): T[] {
  const remplaces = new Set(docs.map((d) => d.remplace).filter(Boolean) as string[]);
  for (const d of docs) d.archive = remplaces.has(d.id);
  return docs;
}

/** Un document « officiel » à suivre : il a un type et/ou une date de fin de validité. */
export function estOfficiel(d: { type?: string; debut?: Date; fin?: Date }): boolean {
  return !!(d.type || d.fin || d.debut);
}
