// Lever et coucher du soleil (algorithme de la NOAA, précision ~1 min) pour LFOB, et horaires aéronautiques.
// En France (SERA / arrêté du 3 mars 2006), la nuit aéronautique commence 30 min après le coucher du soleil
// et se termine 30 min avant son lever : le jour aéronautique va donc du lever − 30 min au coucher + 30 min.

export const LFOB = { lat: 49.4544, lon: 2.1128 };

const rad = Math.PI / 180;

/** Heure (Date) du lever ou du coucher du soleil le jour civil `jour` (UTC) au lieu donné. */
function evenement(jour: Date, lat: number, lon: number, lever: boolean): Date | null {
  const j0 = Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate());
  const n = Math.floor((j0 - Date.UTC(jour.getUTCFullYear(), 0, 0)) / 86400000); // jour de l'année
  // Itération : on recalcule avec l'heure trouvée pour affiner
  let h = lever ? 6 : 18;
  for (let i = 0; i < 3; i++) {
    const g = (2 * Math.PI / 365) * (n - 1 + (h - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const cosH = (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    if (cosH > 1 || cosH < -1) return null;
    const ha = Math.acos(cosH) / rad;
    const minutes = 720 - 4 * (lon + (lever ? ha : -ha)) - eqt; // minutes UTC
    h = minutes / 60;
  }
  return new Date(j0 + h * 3600000);
}

export interface Ephemeride { jourAero: Date; lever: Date; coucher: Date; nuitAero: Date }

/** Horaires du jour (date locale de `quand`) à LFOB. */
export function ephemeride(quand = new Date(), lieu = LFOB): Ephemeride | null {
  // Jour civil à Paris
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(quand).map((x) => [x.type, x.value]));
  const jour = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const lever = evenement(jour, lieu.lat, lieu.lon, true);
  const coucher = evenement(jour, lieu.lat, lieu.lon, false);
  if (!lever || !coucher) return null;
  return {
    jourAero: new Date(lever.getTime() - 30 * 60000),
    lever,
    coucher,
    nuitAero: new Date(coucher.getTime() + 30 * 60000),
  };
}

export const heureLocale = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
