// =====================================================================
// Mk4 PWA — MODULE 2 : memoire.js (mémoire longue durée sur l'appareil)
// Rôle : stocker les souvenirs dans IndexedDB (aucun serveur), les retrouver
//        par similarité de sens, supprimer / modifier, exporter / importer.
// Dépend de : gemini.js (embed). Remplace Qdrant de la version Python.
//   import { ajouter, chercher, lister } from "./memoire.js";
//
// « espace » = une mémoire séparée (par personnage ou profil, plus tard).
// Par défaut tout va dans l'espace "defaut".
// =====================================================================
import { embed, DIMS_EMBED } from "./gemini.js";

const NOM_BASE = "mk4_memoire";
const VERSION_BASE = 1;
const STORE = "souvenirs";

export const ESPACE_DEFAUT = "defaut";
export const SEUIL_DOUBLON = 0.92;     // au-dessus : même information, on met à jour
export const SEUIL_PERTINENCE = 0.4;   // en dessous : souvenir jugé sans rapport (à ajuster en test)
export const MAX_TEXTE = 500;          // longueur max d'un souvenir

// ---------- Base IndexedDB ----------
let _db = null;

function ouvrir() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const r = indexedDB.open(NOM_BASE, VERSION_BASE);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("espace", "espace", { unique: false });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("IndexedDB indisponible"));
  });
  _db.catch(() => { _db = null; });   // permet de réessayer plus tard
  return _db;
}

const attendre = (req) => new Promise((ok, ko) => {
  req.onsuccess = () => ok(req.result);
  req.onerror = () => ko(req.error);
});

// Une transaction par opération (elle se ferme toute seule : on ne mélange
// jamais une transaction avec un appel réseau).
async function magasin(mode = "readonly") {
  const db = await ouvrir();
  return db.transaction(STORE, mode).objectStore(STORE);
}

async function tousDe(espace) {
  const s = await magasin();
  return attendre(s.index("espace").getAll(espace));
}

// ---------- Utilitaires ----------
const nettoyer = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTE);

function nouvelId() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Les vecteurs sont normalisés par gemini.js : produit scalaire = similarité cosinus.
function scalaire(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ---------- Stockage persistant (évite que le navigateur efface tout) ----------
export async function demanderStockagePersistant() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

export async function infosStockage() {
  try {
    const e = await navigator.storage.estimate();
    return { utilise: e.usage || 0, quota: e.quota || 0 };
  } catch { return { utilise: 0, quota: 0 }; }
}

// ---------- Ajouter un souvenir ----------
// Retourne { ok, id, doublon }. Si un souvenir très proche existe déjà,
// il est mis à jour au lieu d'être dupliqué.
export async function ajouter(texte, { espace = ESPACE_DEFAUT } = {}) {
  texte = nettoyer(texte);
  if (!texte) return { ok: false, raison: "vide" };
  const vecteur = Float32Array.from(await embed(texte, "RETRIEVAL_DOCUMENT"));

  const existants = await tousDe(espace);
  let proche = null, meilleur = 0;
  for (const s of existants) {
    const c = scalaire(vecteur, s.vecteur);
    if (c > meilleur) { meilleur = c; proche = s; }
  }

  const store = await magasin("readwrite");
  if (proche && meilleur >= SEUIL_DOUBLON) {
    await attendre(store.put({ ...proche, texte, vecteur, date: Date.now() }));
    return { ok: true, id: proche.id, doublon: true };
  }
  const id = nouvelId();
  await attendre(store.put({ id, espace, texte, vecteur, date: Date.now() }));
  return { ok: true, id, doublon: false };
}

// Ajoute plusieurs souvenirs, un par un (évite de saturer le quota gratuit).
// Retourne { ajoutes, mis_a_jour, echecs }.
export async function ajouterPlusieurs(textes, opts = {}) {
  const bilan = { ajoutes: 0, mis_a_jour: 0, echecs: 0 };
  for (const t of textes) {
    try {
      const r = await ajouter(t, opts);
      if (!r.ok) bilan.echecs++;
      else if (r.doublon) bilan.mis_a_jour++;
      else bilan.ajoutes++;
    } catch { bilan.echecs++; }
  }
  return bilan;
}

// ---------- Chercher ----------
// Retourne [{ id, texte, date, score }] triés du plus pertinent au moins pertinent.
export async function chercher(question, { espace = ESPACE_DEFAUT, k = 8, seuil = SEUIL_PERTINENCE } = {}) {
  const existants = await tousDe(espace);
  if (!existants.length) return [];          // rien en mémoire : pas d'appel réseau
  const q = await embed(nettoyer(question) || "?", "RETRIEVAL_QUERY");
  return existants
    .map((s) => ({ id: s.id, texte: s.texte, date: s.date, score: scalaire(q, s.vecteur) }))
    .filter((r) => r.score >= seuil)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- Gérer les souvenirs ----------
// Liste sans les vecteurs, du plus récent au plus ancien.
export async function lister({ espace = ESPACE_DEFAUT } = {}) {
  const tous = await tousDe(espace);
  return tous
    .map((s) => ({ id: s.id, texte: s.texte, date: s.date }))
    .sort((a, b) => b.date - a.date);
}

export async function compter({ espace = ESPACE_DEFAUT } = {}) {
  const s = await magasin();
  return attendre(s.index("espace").getAll(espace)).then((l) => l.length);
}

export async function supprimer(id) {
  const s = await magasin("readwrite");
  await attendre(s.delete(id));
}

export async function modifier(id, nouveauTexte) {
  const texte = nettoyer(nouveauTexte);
  if (!texte) return false;
  const vecteur = Float32Array.from(await embed(texte, "RETRIEVAL_DOCUMENT"));
  const store = await magasin("readwrite");
  const actuel = await attendre(store.get(id));
  if (!actuel) return false;
  await attendre(store.put({ ...actuel, texte, vecteur, date: Date.now() }));
  return true;
}

export async function vider({ espace = ESPACE_DEFAUT } = {}) {
  const tous = await tousDe(espace);
  const store = await magasin("readwrite");
  await Promise.all(tous.map((s) => attendre(store.delete(s.id))));
  return tous.length;
}

// ---------- Export / import (ta sauvegarde) ----------
// Le fichier contient les vecteurs : l'import ne coûte aucun appel à Gemini.
export async function exporter({ espace = ESPACE_DEFAUT } = {}) {
  const tous = await tousDe(espace);
  return {
    app: "mk4", format: 1, dims: DIMS_EMBED,
    exporteLe: new Date().toISOString(), espace,
    souvenirs: tous.map((s) => ({
      texte: s.texte, date: s.date,
      vecteur: Array.from(s.vecteur, (x) => Math.round(x * 1e5) / 1e5),
    })),
  };
}

// Déclenche le téléchargement d'un fichier .json (à brancher sur un bouton).
export async function exporterEnFichier(opts = {}) {
  const donnees = await exporter(opts);
  const blob = new Blob([JSON.stringify(donnees)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mk4-memoire-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return donnees.souvenirs.length;
}

// source : texte JSON ou objet. Fusionne sans écraser, ignore les doublons exacts.
export async function importer(source, { espace = ESPACE_DEFAUT } = {}) {
  const d = typeof source === "string" ? JSON.parse(source) : source;
  if (d?.app !== "mk4" || !Array.isArray(d.souvenirs)) throw new Error("Fichier de mémoire invalide");
  const textes = new Set((await tousDe(espace)).map((s) => s.texte));
  const store = await magasin("readwrite");
  const attentes = [];
  let ajoutes = 0, ignores = 0;
  for (const s of d.souvenirs) {
    const texte = nettoyer(s.texte);
    const vecteurOk = Array.isArray(s.vecteur) && s.vecteur.length === DIMS_EMBED;
    if (!texte || !vecteurOk || textes.has(texte)) { ignores++; continue; }
    textes.add(texte);
    attentes.push(attendre(store.put({
      id: nouvelId(), espace, texte,
      vecteur: Float32Array.from(s.vecteur), date: s.date || Date.now(),
    })));
    ajoutes++;
  }
  await Promise.all(attentes);
  return { ajoutes, ignores };
}

export async function importerFichier(fichier, opts = {}) {
  return importer(await fichier.text(), opts);
}
