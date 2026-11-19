/**
 * MAA automatiques : surveille la boîte Gmail du club et envoie chaque bulletin MAA (PDF de Météo-France)
 * à l'espace membres du site. Le site lit le PDF (numéro, motif, début et fin de validité) et affiche
 * le bandeau « Avertissement météo » dans l'appli, rouge pendant le MAA, orange avant, masqué après.
 *
 * Installation (une seule fois, connecté au compte Gmail qui reçoit les MAA) :
 *  1. Ouvrir https://script.google.com › Nouveau projet, nommer « MAA ACBT ».
 *  2. Remplacer tout le contenu par ce fichier, puis Enregistrer.
 *  3. Paramètres du projet (roue dentée) › Propriétés du script › Ajouter :
 *       SITE     = https://acbt60.pages.dev   (plus tard : https://acbt60.fr)
 *       MAA_CLE  = la même clé que la variable secrète MAA_CLE du projet Cloudflare
 *  4. Revenir dans l'éditeur, choisir la fonction « installer » en haut, cliquer sur Exécuter,
 *     puis accepter les autorisations demandées (lecture de Gmail, appel du site).
 * Ensuite tout est automatique : la boîte est relue toutes les 5 minutes.
 * Les mails traités reçoivent le libellé « MAA publié » (ou « MAA refusé » si le PDF n'est pas un MAA).
 */

// Mails à examiner. On peut ajouter l'expéditeur des MAA pour être plus précis, ex. : from:(adresse@exemple.fr)
const RECHERCHE = 'has:attachment filename:pdf newer_than:3d';
const LIBELLE_OK = 'MAA publié';
const LIBELLE_NON = 'MAA refusé';

function installer() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('relever').timeBased().everyMinutes(5).create();
  relever();
}

function relever() {
  const props = PropertiesService.getScriptProperties();
  const site = String(props.getProperty('SITE') || '').replace(/\/$/, '');
  const cle = props.getProperty('MAA_CLE');
  if (!site || !cle) throw new Error('Régler SITE et MAA_CLE dans Paramètres du projet › Propriétés du script.');
  const ok = GmailApp.getUserLabelByName(LIBELLE_OK) || GmailApp.createLabel(LIBELLE_OK);
  const non = GmailApp.getUserLabelByName(LIBELLE_NON) || GmailApp.createLabel(LIBELLE_NON);

  const fils = GmailApp.search(`${RECHERCHE} -label:"${LIBELLE_OK}" -label:"${LIBELLE_NON}"`, 0, 20);
  fils.forEach((fil) => {
    let publie = false, refuse = false, erreur = false;
    fil.getMessages().forEach((msg) => {
      msg.getAttachments({ includeInlineImages: false }).forEach((pj) => {
        const nom = pj.getName() || '';
        if (!/\.pdf$/i.test(nom) && pj.getContentType() !== 'application/pdf') return;
        const url = `${site}/api/maa?recu=${encodeURIComponent(msg.getDate().toISOString())}&nom=${encodeURIComponent(nom)}`;
        const rep = UrlFetchApp.fetch(url, {
          method: 'post', contentType: 'application/pdf', payload: pj.getBytes(),
          headers: { Authorization: `Bearer ${cle}` }, muteHttpExceptions: true,
        });
        const code = rep.getResponseCode();
        if (code === 200) publie = true;
        else if (code === 422) refuse = true; // PDF qui n'est pas un MAA
        else { erreur = true; console.warn(`${nom} : ${code} ${rep.getContentText()}`); }
      });
    });
    // En cas d'erreur du site (clé, réseau…), le mail n'est pas marqué : il sera repris au prochain passage.
    if (erreur) return;
    if (publie) fil.addLabel(ok); else if (refuse) fil.addLabel(non);
  });
}
