import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Le back-office peut enregistrer un champ facultatif vide sous la forme '' ou null : on le traite comme absent.
const vide = (v: unknown) => (v === '' || v === null ? undefined : v);
const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(vide, schema.optional());

const actualites = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/actualites' }),
  schema: z.object({
    titre: z.string(),
    date: z.coerce.date(),
    image: opt(z.string()),
    galerie: z.array(z.string()).default([]),
    publie: z.boolean().default(true),
  }),
});

const avions = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/avions' }),
  schema: z.object({
    nom: z.string(),
    immatriculation: opt(z.string()),
    type: z.string(),
    puissance: opt(z.number()),
    places: opt(z.number()),
    usage: opt(z.string()),
    description: opt(z.string()),
    photos: z.array(z.string()).default([]),
    // Chaque ligne s'applique à partir de sa date : on peut saisir un futur tarif à l'avance.
    tarifs: z
      .array(
        z.object({
          a_partir_du: z.coerce.date(),
          prix_heure: z.number(),
          prix_instruction: opt(z.number()),
          note: opt(z.string()),
        }),
      )
      .default([]),
    ordre: z.number().default(10),
    actif: z.boolean().default(true),
  }),
});

export const CATEGORIES_DOCS = ['Vie du club', 'Documentation pilote', 'Documentation avion', 'Pour les élèves', 'Examens', 'Examen pratique', 'Sécurité', 'Préparation des vols', 'Météo', 'Formulaires'] as const;
export const RUBRIQUES_AVION = ['Manuel de vol', 'Paramètres', 'Check-list', 'Centrage', 'Guide radio rapide', 'Radio VFR', 'Transpondeur', 'DME', 'Balise de détresse', 'Autre'] as const;

// Documents officiels à durée de validité. Le titre se construit tout seul : « <immatriculation> - <type> » pour un avion, « <type> » sinon.
export const TYPES_AVION = ["Certificat d'immatriculation", 'Certificat de navigabilité (CDN)', "Certificat d'examen de navigabilité (CEN)", 'Certificat acoustique', 'Assurance', 'Fiche de pesée et centrage', 'Licence station radio', 'Autorisation radio'] as const;
export const TYPES_GENERAL = ['Bulletin météo', 'Règlement intérieur', 'Statuts', 'Compte-rendu', 'Note de sécurité', 'Divers'] as const;
// Préavis d'expiration : un document est « bientôt expiré » dans les 30 jours avant l'échéance.
export const PREAVIS_JOURS = 30;

const documents = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/documents' }),
  schema: z.object({
    // Facultatif : si absent, le titre est construit depuis l'immatriculation et le type.
    titre: opt(z.string()),
    categorie: z.enum(CATEGORIES_DOCS),
    avions: z.array(z.string()).default([]),
    rubrique: opt(z.enum(RUBRIQUES_AVION)),
    // Type de document officiel (sert au nom automatique et au classement).
    type: opt(z.string()),
    // Validité : « debut » et « fin » (date, ou date-heure ISO pour un bulletin météo MAA). Sans « fin », le document n'expire pas.
    debut: opt(z.coerce.date()),
    fin: opt(z.coerce.date()),
    // Bulletin météo (MAA) : motif en clair et numéro, lus dans le PDF.
    motif: opt(z.string()),
    numero: opt(z.string()),
    // Identifiant (nom de fichier sans extension) du document que celui-ci remplace : l'ancien passe en historique.
    remplace: opt(z.string()),
    fichier: opt(z.string()),
    lien: opt(z.string()),
    description: opt(z.string()),
    mis_a_jour: opt(z.coerce.date()),
    ordre: z.number().default(10),
  }),
});

export const collections = { actualites, avions, documents };
