// =====================================================================
// Mk4 PWA — MODULE 1 : gemini.js (appels à Gemini)
// Rôle : clé API (stockée sur l'appareil), test de la clé, génération de texte
//        avec repli automatique, recherche web, photos, embeddings.
// Ne dépend d'aucun autre module. Les autres modules l'importent :
//   import { generer, embed, lireCle } from "./gemini.js";
// =====================================================================

const API = "https://generativelanguage.googleapis.com/v1beta";
const CLE_STOCK = "mk4_cle_api";

export const MODELES = [
  { label: "⚡ 3.5 Flash-Lite (économe)", id: "gemini-3.5-flash-lite" },
  { label: "2.5 Flash", id: "gemini-2.5-flash" },
  { label: "🧠 2.5 Pro (analyse)", id: "gemini-2.5-pro" },
  { label: "3.5 Flash", id: "gemini-3.5-flash" },
];
export const MODELE_DEFAUT = "gemini-3.5-flash-lite";
export const MODELE_EMBED = "gemini-embedding-001";
export const DIMS_EMBED = 768;
export const MAX_PHOTOS = 3;
export const TAILLE_PHOTO = 1024;

// ---------- Erreur dédiée ----------
// fatal = true : inutile de réessayer (clé absente ou refusée).
export class GeminiError extends Error {
  constructor(message, status = 0, fatal = false) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.fatal = fatal;
  }
}

// ---------- Clé API (localStorage, uniquement sur cet appareil) ----------
export function lireCle() {
  try { return (localStorage.getItem(CLE_STOCK) || "").trim(); } catch { return ""; }
}

export function enregistrerCle(cle) {
  try { localStorage.setItem(CLE_STOCK, String(cle || "").trim()); return true; } catch { return false; }
}

export function effacerCle() {
  try { localStorage.removeItem(CLE_STOCK); } catch { /* rien */ }
}

// ---------- Appel HTTP de base ----------
async function appel(chemin, corps, { methode = "POST", delai = 45000 } = {}) {
  const cle = lireCle();
  if (!cle) throw new GeminiError("Clé API absente", 0, true);
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delai);
  try {
    const rep = await fetch(`${API}/${chemin}`, {
      method: methode,
      headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
      body: methode === "POST" ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
    if (!rep.ok) {
      let detail = "";
      try { detail = (await rep.json()).error?.message || ""; } catch { /* corps vide */ }
      const fatal = rep.status === 401 || rep.status === 403 ||
        (rep.status === 400 && /api key/i.test(detail));
      throw new GeminiError(`HTTP ${rep.status} ${detail.slice(0, 160)}`.trim(), rep.status, fatal);
    }
    return await rep.json();
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (e.name === "AbortError") throw new GeminiError("Délai dépassé", 0, false);
    throw new GeminiError("Réseau indisponible : " + e.message, 0, false);
  } finally {
    clearTimeout(minuteur);
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Test de la clé ----------
// Retourne { ok: true } ou { ok: false, erreur: "..." }
export async function testerCle() {
  try {
    await appel("models?pageSize=1", null, { methode: "GET", delai: 15000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, erreur: e.message };
  }
}

// ---------- Sources de la recherche web ----------
function sources(candidat) {
  const liens = [], vus = new Set();
  const morceaux = candidat?.groundingMetadata?.groundingChunks || [];
  for (const c of morceaux) {
    const w = c.web;
    if (w?.uri && !vus.has(w.uri)) {
      vus.add(w.uri);
      liens.push({ titre: w.title || "source", url: w.uri });
    }
  }
  return liens.slice(0, 4);
}

// ---------- Génération de texte ----------
// historique : [{ role: "user" | "model", texte: "..." }]
// photos     : tableau de parts créées par photoVersPart()
// Retourne   : { texte, modele (utilisé), sources: [{titre, url}] }
// Si le modèle choisi échoue, repli sur MODELE_DEFAUT. La recherche web est
// abandonnée à la dernière tentative si elle bloque tout.
export async function generer({
  system = "", historique = [], message, photos = [],
  modele = MODELE_DEFAUT, web = false, essais = 4,
  temperature = 0.7, json = false,   // json = true : réponse forcée en JSON (sans recherche web)
}) {
  const contents = historique.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.texte }],
  }));
  contents.push({ role: "user", parts: [{ text: message }, ...photos.slice(0, MAX_PHOTOS)] });

  let cible = modele;
  let derniere = null;
  for (let i = 0; i < essais; i++) {
    const corps = { contents, generationConfig: { temperature } };
    if (json) corps.generationConfig.responseMimeType = "application/json";
    if (system) corps.systemInstruction = { parts: [{ text: system }] };
    const avecWeb = web && i < essais - 1;
    if (avecWeb) corps.tools = [{ google_search: {} }];
    try {
      const j = await appel(`models/${cible}:generateContent`, corps);
      const cand = j.candidates?.[0];
      const texte = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
      if (!texte) {
        const bloc = j.promptFeedback?.blockReason;
        throw new GeminiError("Réponse vide" + (bloc ? ` (bloquée : ${bloc})` : ""));
      }
      return { texte, modele: cible, sources: avecWeb ? sources(cand) : [] };
    } catch (e) {
      derniere = e;
      console.warn(`⚠️ ${cible} : ${e.message}`);
      if (e.fatal) throw e;
      if (cible !== MODELE_DEFAUT) cible = MODELE_DEFAUT;
      else if (i < essais - 1) await pause(2 ** (i + 1) * 1000);
    }
  }
  throw new GeminiError("Échec de l'appel Gemini après plusieurs essais : " + (derniere?.message || ""));
}

// ---------- Embeddings (pour la mémoire, module 2) ----------
// Les vecteurs réduits à 768 dimensions ne sont pas normalisés : on le fait ici,
// ce qui permet au module mémoire de comparer par simple produit scalaire.
function normaliser(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// tache : "RETRIEVAL_DOCUMENT" pour enregistrer un souvenir,
//         "RETRIEVAL_QUERY" pour chercher avec une question.
export async function embed(texte, tache = "RETRIEVAL_DOCUMENT") {
  let derniere = null;
  for (let i = 0; i < 2; i++) {
    try {
      const j = await appel(`models/${MODELE_EMBED}:embedContent`, {
        model: `models/${MODELE_EMBED}`,
        content: { parts: [{ text: texte }] },
        taskType: tache,
        outputDimensionality: DIMS_EMBED,
      });
      const v = j.embedding?.values;
      if (!v?.length) throw new GeminiError("Embedding vide");
      return normaliser(v);
    } catch (e) {
      derniere = e;
      if (e.fatal) throw e;
      await pause(1500);
    }
  }
  throw derniere;
}

// ---------- Photos : réduction avant envoi (économise quotas et données) ----------
// fichier : objet File (input type="file" accept="image/*")
export async function photoVersPart(fichier) {
  const bmp = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  const ratio = Math.min(1, TAILLE_PHOTO / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * ratio);
  canvas.height = Math.round(bmp.height * ratio);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { inlineData: { mimeType: "image/jpeg", data } };
}
