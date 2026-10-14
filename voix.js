// =====================================================================
// Mk4 PWA — MODULE 7 : voix.js (appel vocal, 100 % gratuit)
// Rôle : écouter (micro du navigateur), répondre à voix haute (voix du
//        téléphone réglée en « robot sympa »), et un écran d'appel qui
//        boucle : écoute → Gemini → parole → écoute…
// Dépend de : rien (il reçoit le chat du module 4 en paramètre).
//   import { brancherVoix } from "./voix.js";
//   brancherVoix({ racine, chat });   // ajoute le bouton 📞 dans l'en-tête
// Note : la reconnaissance vocale marche surtout dans Chrome (Android) et
//        a besoin d'internet ; les voix dépendent du téléphone.
// =====================================================================

const CLE_VOIX = "mk4_voix";
const CLE_OPTIONS = "mk4_options";        // écrit par ui.js (modèle, recherche web)

export const LANGUE_DEFAUT = "fr-FR";
export const PRESETS = {
  robot:     { label: "🤖 Robot sympa", pitch: 1.45, rate: 1.08 },
  naturelle: { label: "🙂 Naturelle",   pitch: 1,    rate: 1 },
  posee:     { label: "🎙️ Posée",       pitch: 0.85, rate: 0.95 },
};
export const PRESET_DEFAUT = "robot";
export const CONSIGNE_APPEL =
  " Tu es en appel vocal : réponds en une à trois phrases courtes et naturelles, sans liste ni mise en forme, comme à l'oral.";
const SILENCES_MAX = 3;                   // 3 silences d'affilée : on raccroche

export function voixDisponible() {
  return {
    ecoute: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    parole: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
  };
}

function lireReglages() {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_VOIX) || "{}");
    return { preset: PRESETS[r.preset] ? r.preset : PRESET_DEFAUT };
  } catch { return { preset: PRESET_DEFAUT }; }
}
function ecrireReglages(r) { try { localStorage.setItem(CLE_VOIX, JSON.stringify(r)); } catch { /* rien */ } }
function lireOptions() { try { return JSON.parse(localStorage.getItem(CLE_OPTIONS) || "{}"); } catch { return {}; } }

// ---------- Préparer le texte pour la voix ----------
export function textePourVoix(t) {
  return String(t || "")
    .replace(/```[\s\S]*?```/g, " (un bloc de code) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[*_#>~|]/g, "")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
    .replace(/([^.!?…:;,\s])[ \t]*\n+/g, "$1. ")
    .replace(/\s+/g, " ").trim();
}

// Découpe en morceaux courts (certains téléphones coupent les longues phrases).
export function decouper(texte, max = 180) {
  const phrases = String(texte).match(/[^.!?…]+[.!?…]*\s*/g) || [String(texte)];
  const sortie = [];
  let cur = "";
  for (const p of phrases) {
    if ((cur + p).length > max && cur) { sortie.push(cur.trim()); cur = ""; }
    cur += p;
    while (cur.length > max) {
      let i = cur.lastIndexOf(" ", max);
      if (i < 40) i = max;
      sortie.push(cur.slice(0, i).trim());
      cur = cur.slice(i);
    }
  }
  if (cur.trim()) sortie.push(cur.trim());
  return sortie.filter(Boolean);
}

// ---------- Choisir la plus agréable des voix françaises du téléphone ----------
export function choisirVoix(voix, langue = LANGUE_DEFAUT) {
  const base = langue.slice(0, 2).toLowerCase();
  const norm = (v) => (v.lang || "").toLowerCase().replace("_", "-");
  const fr = voix.filter((v) => norm(v).startsWith(base));
  if (!fr.length) return null;
  const note = (v) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural|online|enhanced|premium/.test(n)) s += 4;
    if (/google/.test(n)) s += 3;
    if (/amelie|amélie|thomas|audrey|denise|henri|vivienne|remy|rémy/.test(n)) s += 2;
    if (norm(v) === langue.toLowerCase()) s += 1;
    return s;
  };
  return fr.slice().sort((a, b) => note(b) - note(a))[0];
}

function listeVoix() {
  return new Promise((ok) => {
    const s = window.speechSynthesis;
    if (!s) return ok([]);
    const l = s.getVoices();
    if (l.length) return ok(l);
    const fin = () => { s.removeEventListener("voiceschanged", fin); ok(s.getVoices()); };
    s.addEventListener("voiceschanged", fin);
    setTimeout(fin, 1500);
  });
}

// ---------- Parler ----------
let parleId = 0;
// Retourne true si tout a été dit, false si interrompu. Ne lève jamais d'erreur.
export async function parler(texte, { preset = PRESET_DEFAUT, langue = LANGUE_DEFAUT } = {}) {
  const s = window.speechSynthesis;
  if (!s) return false;
  const morceaux = decouper(textePourVoix(texte));
  if (!morceaux.length) return true;
  const moi = ++parleId;
  s.cancel();
  const voix = choisirVoix(await listeVoix(), langue);
  const p = PRESETS[preset] || PRESETS[PRESET_DEFAUT];
  for (const m of morceaux) {
    if (moi !== parleId) return false;
    await new Promise((ok) => {
      const u = new SpeechSynthesisUtterance(m);
      u.lang = voix?.lang || langue;
      if (voix) u.voice = voix;
      u.pitch = p.pitch;
      u.rate = p.rate;
      const garde = setTimeout(ok, 4000 + m.length * 120);     // sécurité si « fin » ne vient jamais
      const fin = () => { clearTimeout(garde); ok(); };
      u.onend = fin;
      u.onerror = fin;
      s.speak(u);
    });
  }
  return moi === parleId;
}

export function arreterParole() {
  parleId++;
  try { window.speechSynthesis?.cancel(); } catch { /* rien */ }
}

// ---------- Écouter ----------
let reco = null;
export function arreterEcoute() { try { reco?.abort(); } catch { /* rien */ } }

// Retourne le texte entendu ("" si silence). Lève une erreur si le micro est refusé, etc.
export function ecouter({ langue = LANGUE_DEFAUT, delai = 15000, onPartiel = () => {} } = {}) {
  return new Promise((ok, ko) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return ko(new Error("indisponible"));
    const r = new SR();
    reco = r;
    r.lang = langue; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = "", partiel = "", fini = false;
    const minuteur = setTimeout(() => { try { r.stop(); } catch { /* rien */ } }, delai);
    const fin = (err) => {
      if (fini) return;
      fini = true; clearTimeout(minuteur);
      if (reco === r) reco = null;
      if (err) ko(err); else ok((final || partiel).trim());
    };
    r.onresult = (e) => {
      let f = "", p = "";
      for (let i = 0; i < e.results.length; i++) {
        const x = e.results[i];
        if (x.isFinal) f += x[0].transcript; else p += x[0].transcript;
      }
      final = f; partiel = p;
      onPartiel((f + p).trim());
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") fin(); else fin(new Error(e.error || "erreur"));
    };
    r.onend = () => fin();
    try { r.start(); } catch (e) { fin(e); }
  });
}

function messageErreur(e) {
  const m = String(e?.message || e);
  if (/not-allowed|service-not-allowed/.test(m)) return "Micro refusé : autorise-le dans les réglages du navigateur.";
  if (/network/.test(m)) return "La reconnaissance vocale a besoin d'internet.";
  if (/audio-capture/.test(m)) return "Aucun micro détecté.";
  if (/indisponible/.test(m)) return "Appel vocal indisponible sur ce navigateur (essaie Chrome).";
  return "Micro : " + m;
}

// ---------- L'appel : écoute → Gemini → parole → écoute… ----------
// Callbacks : onEtat("ecoute"|"reflexion"|"parole"|"fin"), onPartiel(texte), onVous(texte),
//             onReponse(texte), onMessage(texte). Retourne { raccrocher(), fini, actif }.
export function demarrerAppel({
  chat, langue = LANGUE_DEFAUT, lirePreset = () => PRESET_DEFAUT,
  onEtat = () => {}, onPartiel = () => {}, onVous = () => {}, onReponse = () => {}, onMessage = () => {},
}) {
  let actif = true, silences = 0, verrou = null;
  const ancienne = chat.systemBase;
  chat.systemBase = ancienne + CONSIGNE_APPEL;
  try {                                    // garde l'écran allumé pendant l'appel
    navigator.wakeLock?.request("screen").then((l) => { verrou = l; if (!actif) l.release().catch(() => {}); }).catch(() => {});
  } catch { /* rien */ }

  const raccrocher = () => {
    if (!actif) return;
    actif = false;
    arreterEcoute(); arreterParole();
    chat.systemBase = ancienne;
    try { verrou?.release(); } catch { /* rien */ }
    onEtat("fin");
  };

  const fini = (async () => {
    try {
      while (actif) {
        onEtat("ecoute");
        let texte = "";
        try { texte = await ecouter({ langue, onPartiel }); }
        catch (e) { onMessage(messageErreur(e)); break; }
        if (!actif) break;
        if (!texte) {
          if (++silences >= SILENCES_MAX) { onMessage("Je ne t'entends plus, j'ai raccroché."); break; }
          continue;
        }
        silences = 0;
        onVous(texte);
        onEtat("reflexion");
        let rep = null;
        try {
          const o = lireOptions();
          rep = await chat.envoyer(texte, { modele: o.modele || undefined, web: !!o.web });
        } catch (e) {
          if (!actif) break;
          onMessage("⚠️ " + (e.message || "erreur"));
          await parler("Désolé, j'ai eu un souci. Réessaie.", { preset: lirePreset(), langue });
          continue;
        }
        if (!actif) break;
        if (!rep) continue;
        onReponse(rep.texte);
        onEtat("parole");
        await parler(rep.texte, { preset: lirePreset(), langue });
      }
    } finally { raccrocher(); }
  })();

  return { raccrocher, fini, get actif() { return actif; } };
}

// ---------- Écran d'appel + bouton 📞 dans l'en-tête ----------
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

const STATUTS = { repos: "Prêt à appeler", ecoute: "Je t'écoute…", reflexion: "Je réfléchis…", parole: "Je parle…", fin: "Appel terminé" };

export function brancherVoix({ racine, chat }) {
  const tete = racine.querySelector(".tete");
  if (!tete) return null;
  const dispo = voixDisponible();
  let appel = null;

  const orbe = el("div", { class: "orbe" });
  const statut = el("div", { class: "appel-statut", texte: STATUTS.repos });
  const vous = el("p", { class: "appel-vous" });
  const lui = el("p", { class: "appel-lui" });
  const msg = el("p", { class: "appel-msg" });
  const choix = el("select", { id: "preset", "aria-label": "Voix" },
    Object.entries(PRESETS).map(([id, p]) => el("option", { value: id, texte: p.label })));
  choix.value = lireReglages().preset;
  choix.addEventListener("change", () => ecrireReglages({ preset: choix.value }));
  const btnTest = el("button", { class: "btn", type: "button", texte: "🔊 Tester la voix" });
  const btnAppel = el("button", { class: "btn principal", type: "button", texte: "📞 Appeler" });
  const btnFermer = el("button", { class: "btn", type: "button", texte: "✕ Fermer" });
  const ecran = el("div", { class: "appel", hidden: true, "data-etat": "repos" },
    el("b", { class: "appel-nom", texte: chat.nom }), orbe, statut, vous, lui, msg,
    el("div", { class: "appel-voix" }, choix, btnTest), btnAppel, btnFermer);
  document.body.append(ecran);

  const etat = (e) => { ecran.dataset.etat = e; statut.textContent = STATUTS[e] || ""; };

  btnTest.addEventListener("click", () => {
    parler("Salut ! Je suis " + chat.nom + ", ton assistant. Comment tu me trouves ?", { preset: choix.value });
  });

  btnAppel.addEventListener("click", () => {
    if (appel?.actif) { appel.raccrocher(); return; }
    if (!dispo.ecoute || !dispo.parole) { msg.textContent = messageErreur("indisponible"); return; }
    if (chat.occupe) { msg.textContent = "Une réponse est déjà en cours, patiente un instant."; return; }
    vous.textContent = ""; lui.textContent = ""; msg.textContent = "";
    btnAppel.textContent = "📞 Raccrocher";
    btnTest.disabled = true;
    appel = demarrerAppel({
      chat, lirePreset: () => choix.value,
      onEtat: (e) => {
        etat(e);
        if (e === "fin") { btnAppel.textContent = "📞 Appeler"; btnTest.disabled = false; }
      },
      onPartiel: (t) => { vous.textContent = "Toi : " + t; },
      onVous: (t) => { vous.textContent = "Toi : " + t; lui.textContent = ""; },
      onReponse: (t) => { lui.textContent = chat.nom + " : " + (t.length > 400 ? t.slice(0, 400) + "…" : t); },
      onMessage: (t) => { msg.textContent = t; },
    });
  });

  btnFermer.addEventListener("click", () => {
    if (appel?.actif) appel.raccrocher();
    arreterParole();
    ecran.hidden = true;
  });

  const bouton = el("button", { class: "btn", id: "appel", type: "button", "aria-label": "Appel vocal", texte: "📞" });
  bouton.addEventListener("click", () => {
    if (chat.occupe) return;
    if (!appel?.actif) { etat("repos"); msg.textContent = dispo.ecoute && dispo.parole ? "" : messageErreur("indisponible"); }
    ecran.hidden = false;
  });
  tete.insertBefore(bouton, tete.querySelector("#neuf"));
  return { ouvrir: () => bouton.click() };
}
