// =====================================================================
// Mk4 PWA — app.js : la « colle » (aucune logique, juste l'assemblage)
// Modules 6 (démarrage), 7 (appel vocal), 8 (service worker),
// 9 (réglages ⚙️) et 10 (humeur + petit robot) branchés.
// =====================================================================
import { creerChat } from "./chat.js";
import { demanderStockagePersistant } from "./memoire.js";
import { demarrer } from "./demarrage.js";
import { demarrerUI } from "./ui.js";
import { brancherHumeur } from "./humeur.js";
import { brancherVoix } from "./voix.js";
import { brancherReglages } from "./reglages.js";

const racine = document.getElementById("racine");

async function main() {
  await demarrer({ racine });          // écran clés API + GPS (ne s'affiche qu'une fois)
  demanderStockagePersistant();
  const chat = creerChat();
  demarrerUI({ racine, chat });
  brancherHumeur({ racine, chat });    // robot + humeur (avant la voix : l'appel en profite aussi)
  brancherVoix({ racine, chat });      // bouton 📞 dans l'en-tête
  brancherReglages({ racine, chat });  // bouton ⚙️ : GPS, clés, déconnexion
}
main();

// Module 8 : app installable et utilisable hors ligne
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
