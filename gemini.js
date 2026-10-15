
const API = "https://generativelanguage.googleapis.com/v1beta";
const CLE_STOCK = "mk4_cle_api";
const CLES_STOCK = "mk4_cles_api";

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
export const TEMPERATURE_DEFAUT = 0.85;

export class GeminiError extends Error {
  constructor(message, status = 0, fatal = false) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.fatal = fatal;
  }
}

export const MAX_CLES = 5;
const PAUSE_QUOTA = 60 * 1000;
const PAUSE_REFUSEE = 24 * 3600 * 1000;
const pauses = new Map();
let actif = 0;
const ecouteurs = [];

export function lireCles() {
  try {
    const l = JSON.parse(localStorage.getItem(CLES_STOCK) || "null");
    if (Array.isArray(l)) return l.filter((c) => typeof c === "string" && c.trim());
  } catch {}
  try {
    const ancienne = (localStorage.getItem(CLE_STOCK) || "").trim();
    return ancienne ? [ancienne] : [];
  } catch {
    return [];
  }
}

function ecrireCles(liste) {
  try {
    const propre = [...new Set(liste.map((c) => String(c || "").trim()).filter(Boolean))].slice(0, MAX_CLES);
    localStorage.setItem(CLES_STOCK, JSON.stringify(propre));
    localStorage.removeItem(CLE_STOCK);
    return true;
  } catch {
    return false;
  }
}

export function lireCle() {
  const l = lireCles();
  return l[Math.min(actif, l.length - 1)] || "";
}

export function ajouterCle(cle) {
  const c = String(cle || "").trim();
  if (!c) return false;
  const l = lireCles();
  if (l.includes(c)) return true;
  if (l.length >= MAX_CLES) return false;
  return ecrireCles([...l, c]);
}
export const enregistrerCle = ajouterCle;

export function retirerCle(cle) {
  pauses.delete(cle);
  return ecrireCles(lireCles().filter((c) => c !== cle));
}

export function effacerCle() {
  pauses.clear();
  actif = 0;
  ecrireCles([]);
}

export function surBascule(fn) {
  if (typeof fn === "function") ecouteurs.push(fn);
}

export function etatCles() {
  const maintenant = Date.now();
  return lireCles().map((c, i) => ({
    numero: i + 1,
    fin: c.slice(-4),
    active: i === actif,
    enPause: (pauses.get(c) || 0) > maintenant,
  }));
}

function prevenir(idx, total) {
  console.info(`🔁 Bascule sur la clé ${idx + 1}/${total}`);
  for (const f of ecouteurs) {
    try {
      f({ numero: idx + 1, total });
    } catch {}
  }
}

async function appelUneCle(cle, chemin, corps, methode, delai) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delai);
  try {
    const rep = await fetch(`${API}/${chemin}`, {
      method: methode,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cle,
      },
      body: methode === "POST" ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
    if (!rep.ok) {
      let detail = "";
      try {
        detail = (await rep.json()).error?.message || "";
      } catch {}
      const e = new GeminiError(
        `HTTP ${rep.status} ${detail.slice(0, 160)}`.trim(),
        rep.status,
        false
      );
      e.refusee =
        rep.status === 401 ||
        rep.status === 403 ||
        (rep.status === 400 && /api key/i.test(detail));
      throw e;
    }
    return await rep.json();
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (e.name === "AbortError") {
      throw new GeminiError("Délai dépassé", 0, false);
    }
    throw new GeminiError("Réseau indisponible : " + e.message, 0, false);
  } finally {
    clearTimeout(minuteur);
  }
}

async function appel(
  chemin,
  corps,
  { methode = "POST", delai = 45000, cle: cleTest } = {}
) {
  if (cleTest) {
    try {
      return await appelUneCle(cleTest, chemin, corps, methode, delai);
    } catch (e) {
      if (e.refusee) e.fatal = true;
      throw e;
    }
  }

  const cles = lireCles();
  if (!cles.length) throw new GeminiError("Clé API absente", 0, true);
  if (actif >= cles.length) actif = 0;

  let derniere = null;
  let essayees = 0;

  for (let i = 0; i < cles.length; i++) {
    const idx = (actif + i) % cles.length;
    const cle = cles[idx];
    if ((pauses.get(cle) || 0) > Date.now()) continue;
    essayees++;

    try {
      const r = await appelUneCle(cle, chemin, corps, methode, delai);
      if (idx !== actif) {
        actif = idx;
        prevenir(idx, cles.length);
      }
      return r;
    } catch (e) {
      derniere = e;
      if (e.status === 429) {
        pauses.set(cle, Date.now() + PAUSE_QUOTA);
      } else if (e.refusee) {
        pauses.set(cle, Date.now() + PAUSE_REFUSEE);
      } else {
        throw e;
      }
    }
  }

  if (!essayees) {
    throw new GeminiError(
      "Toutes tes clés sont épuisées pour le moment. Réessaie dans une minute ou ajoute une clé.",
      429,
      false
    );
  }

  if (cles.every((c) => (pauses.get(c) || 0) > Date.now() + PAUSE_QUOTA)) {
    derniere.fatal = true;
  }
  throw derniere;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function testerCle(cle) {
  try {
    await appel("models?pageSize=1", null, {
      methode: "GET",
      delai: 15000,
      cle: String(cle || "").trim() || undefined,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, erreur: e.message };
  }
}

function sources(candidat) {
  const liens = [];
  const vus = new Set();
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

export async function generer({
  system = "",
  historique = [],
  message,
  photos = [],
  modele = MODELE_DEFAUT,
  web = false,
  essais = 4,
  temperature = TEMPERATURE_DEFAUT,
  json = false,
}) {
  const contents = historique.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.texte }],
  }));

  contents.push({
    role: "user",
    parts: [{ text: message }, ...photos.slice(0, MAX_PHOTOS)],
  });

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
      const texte = (cand?.content?.parts || [])
        .map((p) => p.text || "")
        .join("")
        .trim();

      if (!texte) {
        const bloc = j.promptFeedback?.blockReason;
        throw new GeminiError(
          "Réponse vide" + (bloc ? ` (bloquée : ${bloc})` : "")
        );
      }

      return {
        texte,
        modele: cible,
        sources: avecWeb ? sources(cand) : [],
      };
    } catch (e) {
      derniere = e;
      console.warn(`⚠ ${cible} : ${e.message}`);
      if (e.fatal) throw e;
      if (cible !== MODELE_DEFAUT) {
        cible = MODELE_DEFAUT;
      } else if (i < essais - 1) {
        await pause(2 ** (i + 1) * 1000);
      }
    }
  }

  throw new GeminiError(
    "Échec de l'appel Gemini après plusieurs essais : " +
      (derniere?.message || "")
  );
}

function normaliser(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

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

export async function photoVersPart(fichier) {
  const bmp = await createImageBitmap(fichier, {
    imageOrientation: "from-image",
  });
  const ratio = Math.min(
    1,
    TAILLE_PHOTO / Math.max(bmp.width, bmp.height)
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * ratio);
  canvas.height = Math.round(bmp.height * ratio);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { inlineData: { mimeType: "image/jpeg", data } };
}
