// Lever et coucher du soleil (algorithme de la NOAA, précision ~1 min) pour LFOB, et horaires aéronautiques.
// En France (SERA / arrêté du 3 mars 2006), la nuit aéronautique commence 30 min après le coucher du soleil
// et se termine 30 min avant son lever : le jour aéronautique va donc du lever − 30 min au coucher + 30 min.

export const LFOB = { lat: 49.4544, lon: 2.1128 };

const rad = Math.PI / 180;

/**
 * Heure (Date) du lever ou du coucher du soleil le jour civil `jour` (UTC) au lieu donné.
 * Calculateur solaire de la NOAA (algorithmes de Meeus) : donne les mêmes heures qu'Aerogest et Perfs
 * (ex. LFOB, 21/11/2026 : lever 08:11, coucher 17:02, heures locales tronquées à la minute).
 */
function evenement(jour: Date, lat: number, lon: number, lever: boolean, zenith = 90.833): Date | null {
  const j0 = Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate());
  let min = lever ? 360 : 1080; // minutes UTC, affinées par itération
  for (let i = 0; i < 3; i++) {
    const jd = j0 / 86400000 + 2440587.5 + min / 1440;
    const T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    const om = 125.04 - 1934.136 * T;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
    const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
    const y = Math.tan((eps * rad) / 2) ** 2;
    const eqt = (4 / rad) * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    const cosH = Math.cos(zenith * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
    if (cosH > 1 || cosH < -1) return null;
    const ha = Math.acos(cosH) / rad;
    min = 720 - 4 * (lon + (lever ? ha : -ha)) - eqt;
  }
  return new Date(j0 + min * 60000);
}

export interface Ephemeride { jourAero: Date; lever: Date; coucher: Date; nuitAero: Date; aubeCivile: Date | null; crepuscule: Date | null }

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
    // Crépuscule civil : soleil à 6° sous l'horizon
    aubeCivile: evenement(jour, lieu.lat, lieu.lon, true, 96),
    crepuscule: evenement(jour, lieu.lat, lieu.lon, false, 96),
  };
}

export const heureLocale = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
