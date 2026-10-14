// =====================================================================
// Mk4 PWA — MODULE 6 : demarrage.js (écran d'ouverture)
// Rôle : à la première ouverture, demander la clé API Google et proposer
//        le bouton « GPS pour Mk4 ». Ensuite l'écran ne revient plus
//        (sauf demarrer({ forcer: true }) depuis de futurs réglages).
// Dépend de : gemini.js (clé, test de la clé). Tout reste sur l'appareil.
//   import { demarrer, lirePosition } from "./demarrage.js";
//   await demarrer({ racine: document.getElementById("racine") });
// =====================================================================
import { lireCle, enregistrerCle, effacerCle, testerCle } from "./gemini.js";

const CLE_POS = "mk4_position";
const CLE_GPS = "mk4_gps_etat";     // "ok" | "refuse" | "ignore" (vide = jamais demandé)

function lire(k) { try { return localStorage.getItem(k); } catch { return null; } }
function ecrire(k, v) { try { localStorage.setItem(k, v); } catch { /* rien */ } }

// ---------- Position GPS (gardée seulement sur le téléphone) ----------
// Retourne { lat, lon, precision (m), date } ou null.
export function lirePosition() {
  try {
    const p = JSON.parse(lire(CLE_POS) || "null");
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
  } catch { return null; }
}

export function etatGps() { return lire(CLE_GPS) || ""; }

export function oublierPosition() {
  try { localStorage.removeItem(CLE_POS); localStorage.removeItem(CLE_GPS); } catch { /* rien */ }
}

// Demande la position au navigateur. Ne lève jamais d'erreur.
// Retourne { ok: true, position } ou { ok: false, raison: "refuse" | "delai" | "indisponible" }.
export function demanderPosition({ delai = 15000 } = {}) {
  return new Promise((fini) => {
    if (!navigator.geolocation) { fini({ ok: false, raison: "indisponible" }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const arrondi = (x) => Math.round(x * 1e4) / 1e4;       // ≈ 10 m : suffisant, plus discret
        const position = {
          lat: arrondi(p.coords.latitude), lon: arrondi(p.coords.longitude),
          precision: Math.round(p.coords.accuracy || 0), date: Date.now(),
        };
        ecrire(CLE_POS, JSON.stringify(position));
        ecrire(CLE_GPS, "ok");
        fini({ ok: true, position });
      },
      (e) => {
        if (e.code === 1) ecrire(CLE_GPS, "refuse");
        fini({ ok: false, raison: e.code === 1 ? "refuse" : e.code === 3 ? "delai" : "indisponible" });
      },
      { enableHighAccuracy: false, timeout: delai, maximumAge: 600000 },
    );
  });
}

// ---------- Petit outil pour créer des éléments ----------
function el(balise, props = {}, ...enfants) {
  const n = document.createElement(balise);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "texte") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const e of enfants.flat()) if (e != null) n.append(e);
  return n;
}

// ---------- Écran de démarrage ----------
// Retourne une promesse résolue quand l'utilisateur peut entrer dans l'app.
export function demarrer({ racine, forcer = false, nom = "Mk4" } = {}) {
  const gpsDecide = ["ok", "refuse", "ignore"].includes(etatGps());
  if (!forcer && lireCle() && gpsDecide) {
    if (etatGps() === "ok") demanderPosition();        // rafraîchit en silence, sans attendre
    return Promise.resolve();
  }

  return new Promise((fini) => {
    const champ = el("input", {
      type: "password", id: "cle", placeholder: lireCle() ? "Clé déjà enregistrée (colle-en une autre pour la changer)" : "Colle ta clé API ici",
      autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    });
    const msgCle = el("div", { class: "etat" });
    const msgGps = el("div", { class: "etat" });
    const btnCle = el("button", { class: "btn", type: "button", texte: "🔑 Tester et enregistrer" });
    const btnGps = el("button", { class: "btn", type: "button", texte: "📍 GPS pour " + nom });
    const btnOk = el("button", { class: "btn principal", type: "button", texte: "Entrer dans " + nom });

    const majEntrer = () => { btnOk.disabled = !lireCle(); };
    const texteGps = () => {
      const e = etatGps();
      msgGps.textContent = e === "ok" ? "✓ Position enregistrée sur ce téléphone"
        : e === "refuse" ? "⚠️ GPS refusé : tu pourras l'autoriser dans les réglages du navigateur" : "";
    };

    btnCle.addEventListener("click", async () => {
      const saisie = champ.value.trim();
      if (!saisie) { msgCle.textContent = lireCle() ? "✓ Clé déjà enregistrée" : "Colle d'abord ta clé."; return; }
      const ancienne = lireCle();
      btnCle.disabled = true;
      msgCle.textContent = "Test de la clé…";
      enregistrerCle(saisie);
      const r = await testerCle();
      if (r.ok) {
        champ.value = "";
        msgCle.textContent = "✓ Clé valide, enregistrée sur ce téléphone";
      } else {
        if (ancienne) enregistrerCle(ancienne); else effacerCle();
        msgCle.textContent = "⚠️ " + r.erreur;
      }
      btnCle.disabled = false;
      majEntrer();
    });

    btnGps.addEventListener("click", async () => {
      btnGps.disabled = true;
      msgGps.textContent = "Recherche de ta position…";
      const r = await demanderPosition();
      if (!r.ok && r.raison !== "refuse") msgGps.textContent = r.raison === "delai" ? "⚠️ Position trop longue à obtenir, réessaie dehors ou plus tard" : "⚠️ GPS indisponible sur cet appareil";
      else texteGps();
      btnGps.disabled = false;
    });

    btnOk.addEventListener("click", () => {
      if (!lireCle()) return;
      if (!etatGps()) ecrire(CLE_GPS, "ignore");       // GPS passé : on ne redemande pas à chaque ouverture
      racine.textContent = "";
      fini();
    });

    texteGps();
    majEntrer();
    racine.textContent = "";
    racine.append(el("div", { class: "demarrage" },
      el("div", { class: "logo grand", texte: "M" }),
      el("h1", { texte: "Bienvenue sur " + nom }),
      el("p", { class: "doux", texte: "Ta mémoire et ta clé restent uniquement sur ce téléphone." }),
      el("section", { class: "carte" },
        el("h2", { texte: "1. Clé API Google" }),
        el("p", { class: "doux" }, "Gratuite : crée-la sur ", el("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener noreferrer", texte: "aistudio.google.com/apikey" }), ", puis colle-la ici."),
        champ, btnCle, msgCle),
      el("section", { class: "carte" },
        el("h2", { texte: "2. Position (facultatif)" }),
        el("p", { class: "doux", texte: "Aide " + nom + " à te situer. Elle est gardée sur ce téléphone, jamais envoyée à un serveur à nous." }),
        btnGps, msgGps),
      btnOk));
  });
}
