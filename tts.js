// =====================================================================
// Mk4 PWA — MODULE 11 : tts.js (voix naturelle avec Gemini TTS)
// Rôle : transformer le texte en voix avec Gemini TTS (gratuit dans la
//        limite du quota de tes clés) et la jouer. Pendant qu'un extrait
//        est lu, le suivant est déjà préparé : la lecture reste fluide.
// Dépend de : gemini.js (appelGemini : la bascule entre clés est incluse).
// Solide : parlerGemini() ne lève jamais d'erreur. Si Gemini échoue
//        (quota, réseau, audio bloqué), il rend la main avec le texte qui
//        reste à lire : voix.js continue alors avec la voix du téléphone,
//        et Gemini est mis en pause 2 minutes (pas de quota gaspillé).
// =====================================================================
import { appelGemini, GeminiError } from "./gemini.js";

// Le premier modèle qui répond est gardé ; l'autre sert de secours.
export const MODELES_TTS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];

export const VOIX_GEMINI = [
  { id: "Sulafat", label: "Sulafat — chaleureuse" },
  { id: "Achird", label: "Achird — amicale" },
  { id: "Aoede", label: "Aoede — légère" },
  { id: "Puck", label: "Puck — enjouée" },
  { id: "Leda", label: "Leda — jeune" },
  { id: "Zephyr", label: "Zephyr — lumineuse" },
  { id: "Callirrhoe", label: "Callirrhoe — décontractée" },
  { id: "Vindemiatrix", label: "Vindemiatrix — douce" },
  { id: "Charon", label: "Charon — posée" },
  { id: "Kore", label: "Kore — ferme" },
];
export const VOIX_GEMINI_DEFAUT = "Sulafat";
export const STYLE_DEFAUT = "Dis de façon chaleureuse, naturelle et fluide, comme un ami, en français : ";

const PREMIER = 260;               // 1er extrait court : la voix démarre vite
const SUITE = 900;                 // extraits suivants longs : moins d'appels, donc moins de quota
const PAUSE_ECHEC = 2 * 60 * 1000;
const DELAI = 60000;
let modeleOk = null;
let enPauseJusqua = 0;

// ---------- Découpage du texte en extraits ----------
export function decouperTexte(texte, premier = PREMIER, suite = SUITE) {
  const phrases = String(texte || "").match(/[^.!?…]+[.!?…]*\s*/g) || [];
  const sortie = [];
  let cur = "";
  const max = () => (sortie.length ? suite : premier);
  for (const p of phrases) {
    if (cur && (cur + p).length > max()) { sortie.push(cur.trim()); cur = ""; }
    cur += p;
    while (cur.length > max()) {
      let i = cur.lastIndexOf(" ", max());
      if (i < 40) i = max();
      sortie.push(cur.slice(0, i).trim());
      cur = cur.slice(i);
    }
  }
  if (cur.trim()) sortie.push(cur.trim());
  return sortie.filter(Boolean);
}

// ---------- Audio renvoyé par Gemini : PCM 16 bits, 24 000 Hz, mono ----------
export function pcmVersFloat(base64, debut = 0) {
  const bin = atob(base64);
  const n = Math.max(0, (bin.length - debut) >> 1);
  const sortie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(debut + 2 * i) | (bin.charCodeAt(debut + 2 * i + 1) << 8);
    if (v & 0x8000) v -= 0x10000;
    sortie[i] = v / 32768;
  }
  return sortie;
}

export function lireAudio(j) {
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const p = parts.find((x) => x.inlineData?.data);
  if (!p) throw new GeminiError("Pas d'audio dans la réponse");
  const mime = p.inlineData.mimeType || "";
  const m = /rate=(\d+)/i.exec(mime);
  const echantillons = pcmVersFloat(p.inlineData.data, /wav/i.test(mime) ? 44 : 0);
  if (!echantillons.length) throw new GeminiError("Audio vide");
  return { echantillons, rate: m ? Number(m[1]) : 24000 };
}

// ---------- Un extrait de texte -> de l'audio ----------
export async function synthetiser(texte, { voix = VOIX_GEMINI_DEFAUT, style = STYLE_DEFAUT } = {}) {
  const corps = {
    contents: [{ parts: [{ text: style + texte }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voix } } },
    },
  };
  let derniere = null;
  for (const modele of modeleOk ? [modeleOk] : MODELES_TTS) {
    for (let essai = 0; essai < 2; essai++) {
      try {
        const audio = lireAudio(await appelGemini(`models/${modele}:generateContent`, corps, { delai: DELAI }));
        modeleOk = modele;
        return audio;
      } catch (e) {
        derniere = e;
        if (e.fatal) throw e;
        if (e.status === 400 || e.status === 404) break;   // modèle inconnu ou refusé : on passe au suivant
      }                                                      // sinon (pas d'audio, réseau…) : 2e essai
    }
  }
  throw derniere || new GeminiError("Synthèse vocale impossible");
}

// ---------- Lecture (WebAudio) ----------
let ctx = null, source = null;

// À appeler dans un clic (le navigateur exige un geste pour déverrouiller le son).
export function preparerAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx || ctx.state === "closed") ctx = new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return true;
  } catch { return false; }
}

export function arreterAudio() {
  try { source?.stop(); } catch { /* rien */ }
  source = null;
}

async function jouer(audio) {
  if (!preparerAudio()) throw new Error("Audio indisponible");
  if (ctx.state !== "running") { try { await ctx.resume(); } catch { /* rien */ } }
  if (ctx.state !== "running") throw new Error("Audio bloqué par le navigateur");
  await new Promise((ok, ko) => {
    try {
      const buf = ctx.createBuffer(1, audio.echantillons.length, audio.rate);
      buf.copyToChannel(audio.echantillons, 0);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(ctx.destination);
      const garde = setTimeout(ok, (audio.echantillons.length / audio.rate) * 1000 + 4000);  // sécurité
      s.onended = () => { clearTimeout(garde); if (source === s) source = null; ok(); };
      source = s;
      s.start();
    } catch (e) { ko(e); }
  });
}

// ---------- Lire un texte avec Gemini ----------
// actuel() : renvoie false si la lecture a été interrompue (raccrocher, couper).
// Retourne { etat: "fini" } | { etat: "interrompu" } | { etat: "echec", reste, erreur }
// où reste = le texte pas encore lu (à lire avec la voix du téléphone).
export async function parlerGemini(texte, { voix, style, actuel = () => true } = {}) {
  if (Date.now() < enPauseJusqua) return { etat: "echec", reste: String(texte || ""), erreur: "pause" };
  const morceaux = decouperTexte(texte);
  if (!morceaux.length) return { etat: "fini" };
  const echec = (restants, e) => {
    enPauseJusqua = Date.now() + PAUSE_ECHEC;
    return { etat: "echec", reste: restants.join(" "), erreur: String(e?.message || e) };
  };
  const lancer = (t) => synthetiser(t, { voix, style }).then((a) => ({ a }), (e) => ({ e }));
  let suivant = lancer(morceaux[0]);
  for (let i = 0; i < morceaux.length; i++) {
    const r = await suivant;
    if (!actuel()) return { etat: "interrompu" };
    if (i + 1 < morceaux.length) suivant = lancer(morceaux[i + 1]);   // prépare le suivant pendant la lecture
    if (r.e) return echec(morceaux.slice(i), r.e);
    try { await jouer(r.a); } catch (e) { return echec(morceaux.slice(i), e); }
    if (!actuel()) return { etat: "interrompu" };
  }
  return { etat: "fini" };
}

// Pour les tests : remet le module à zéro.
export function _reinitialiser() { modeleOk = null; enPauseJusqua = 0; ctx = null; source = null; }
