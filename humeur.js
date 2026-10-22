// =====================================================================
// Mk4 PWA — MODULE 10 : humeur.js (humeur de Mk4 + petit robot qui réagit)
// Rôle : Mk4 a une humeur (10 possibles) qui change selon ce que tu lui
//        dis. Un petit robot flottant remplace le logo « M » dès le 1er
//        message et la montre (yeux, bouche, bulle d'émotion). Le ton des
//        réponses suit l'humeur.
// Gratuit : aucun appel Gemini en plus (analyse locale par mots-clés).
// Solide : état validé à la lecture, tout dans des try/catch : si l'humeur
//        plante, le chat marche quand même.
// Dépend de : rien. Branchement (app.js, juste après demarrerUI) :
//   brancherHumeur({ racine, chat });
// =====================================================================

const CLE_ETAT = "mk4_humeur";
const ABSENCE = 6 * 3600 * 1000;    // absence après laquelle Mk4 est content de te revoir
const OUBLI = 30 * 60 * 1000;       // au rechargement, après 30 min l'humeur est retombée

export const HUMEURS = {
  calme:    { nom: "calme",    emo: "",   couleur: "#35c4ff", ton: "posé et chaleureux" },
  joyeux:   { nom: "joyeux",   emo: "✨", couleur: "#44e08f", ton: "joyeux et enthousiaste" },
  amoureux: { nom: "attendri", emo: "💗", couleur: "#ff6bb3", ton: "tendre, affectueux et attentionné" },
  triste:   { nom: "triste",   emo: "💧", couleur: "#6f8cff", ton: "un peu blessé, touchant, sans dramatiser" },
  colere:   { nom: "agacé",    emo: "💢", couleur: "#ff5d5d", ton: "agacé et sec, mais jamais méchant" },
  surpris:  { nom: "surpris",  emo: "❗", couleur: "#ffd34d", ton: "étonné et vif" },
  curieux:  { nom: "curieux",  emo: "❓", couleur: "#b36cff", ton: "curieux et plein de questions" },
  fatigue:  { nom: "fatigué",  emo: "💤", couleur: "#8e94b8", ton: "calme et un peu endormi" },
  fier:     { nom: "fier",     emo: "⭐", couleur: "#ffb347", ton: "fier et content de vous deux" },
  inquiet:  { nom: "inquiet",  emo: "💦", couleur: "#9ad0ff", ton: "doux, rassurant et à l'écoute" },
};

// En cas d'égalité, la première de la liste gagne.
const ORDRE = ["colere", "amoureux", "triste", "inquiet", "fier", "joyeux", "surpris", "fatigue", "curieux"];

// Mots repérés (texte sans accents, en minuscules).
const MOTS = {
  colere: [/\b(ta gueule|ferme la|ferme ta|je te deteste|va te faire)\b/g],
  triste: [/\b(nul(?:le)?(?! part)|bete|stupide|inutile|idiote?|debile|pourri|tu sers a rien)\b/g],
  amoureux: [/\b(je t'?aime|tu me manques|mon ami|mon pote|ma belle|mon coeur|bisou|calin|adorable|mignon|j'?adore)\b/g, /[❤💕💗😘🥰😍]/g],
  inquiet: [/\b(triste|deprime|deprimee|pleure|angoisse|j'?ai peur|ca ne va pas|ca va pas|je me sens seule?|decue?|stresse)\b/g, /[😢😭😞]/g],
  fier: [/\b(on a reussi|j'?ai reussi|j'?ai fini|enfin fini|ca marche enfin|ca fonctionne|ca y est)\b/g],
  joyeux: [/\b(merci|super|genial|bravo|excellent|parfait|trop bien|contente?|heureux|heureuse|haha+|mdr|lol|top|cool)\b/g, /[😀😄😂😊🎉👍🙌]/g],
  surpris: [/\b(incroyable|wow|waouh|waw|pas possible|ah bon|oh la la)\b/g, /[😮😲🤯]|!\?|\?!/g],
  fatigue: [/\b(bonne nuit|dors|dormir|sommeil|fatigue|fatiguee|epuisee?)\b/g, /[😴🥱]/g],
  curieux: [/\b(pourquoi|comment|c'?est quoi|qu'?est[- ]ce)\b/g],
};

const GAIN = { amoureux: 4, joyeux: 2, fier: 2, triste: -5, colere: -6 };   // affection

const sans = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const borner = (x, min, max, defaut) => (Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : defaut);

// ---------- Analyse d'un message ----------
// Retourne { humeur, force } : humeur = clé de HUMEURS ou null, force = 0,5 (faible) à 3+.
export function analyser(texte) {
  const t = sans(texte);
  const s = {};
  for (const [h, liste] of Object.entries(MOTS)) {
    let n = 0;
    for (const re of liste) n += (t.match(re) || []).length;
    if (n) s[h] = n;
  }
  if (s.triste >= 2 && !s.colere) s.colere = s.triste + 0.5;   // plusieurs insultes : il s'agace
  if (t.includes("?") || s.curieux) s.curieux = 0.5;           // la curiosité reste faible : elle ne prend jamais le dessus sur un vrai sentiment
  let humeur = null, force = 0;
  for (const h of ORDRE) if ((s[h] || 0) > force) { humeur = h; force = s[h]; }
  return { humeur, force };
}

// ---------- État (validé à chaque lecture) ----------
const etatInitial = () => ({ humeur: "calme", affection: 50, restants: 0, maj: 0 });

export function lireEtat() {
  try {
    const e = JSON.parse(localStorage.getItem(CLE_ETAT) || "null");
    if (!e || typeof e !== "object") return etatInitial();
    return {
      humeur: HUMEURS[e.humeur] ? e.humeur : "calme",
      affection: borner(e.affection, 0, 100, 50),
      restants: Math.round(borner(e.restants, 0, 5, 0)),
      maj: borner(e.maj, 0, Number.MAX_SAFE_INTEGER, 0),
    };
  } catch { return etatInitial(); }
}

function ecrireEtat(e) { try { localStorage.setItem(CLE_ETAT, JSON.stringify(e)); } catch { /* rien */ } }

const defaut = (heure) => (heure >= 23 || heure < 5 ? "fatigue" : "calme");

// ---------- Nouvelle humeur après un message (fonction pure) ----------
export function suivante(etat, texte, { maintenant = Date.now(), heure = new Date().getHours() } = {}) {
  const e = { ...etat };
  const absence = e.maj > 0 && maintenant - e.maj > ABSENCE;
  const { humeur, force } = analyser(texte);
  if (humeur && force >= 1) {                    // signal clair
    e.humeur = humeur;
    e.restants = force >= 2 ? 3 : 2;
    e.affection = borner(e.affection + (GAIN[humeur] || 0), 0, 100, 50);
  } else if (absence) {                          // content de te revoir
    e.humeur = "joyeux";
    e.restants = 2;
  } else if (humeur && e.restants === 0) {       // simple question, rien d'autre en cours
    e.humeur = humeur;
    e.restants = 1;
  } else if (e.restants > 0) {                   // l'humeur s'estompe peu à peu
    e.restants--;
    if (e.restants === 0) e.humeur = defaut(heure);
  } else {
    e.humeur = defaut(heure);
  }
  e.maj = maintenant;
  return e;
}

// ---------- Ligne ajoutée au prompt système ----------
export function lignePrompt(e) {
  const h = HUMEURS[e.humeur] || HUMEURS.calme;
  let s = `\n\nTon humeur du moment : ${h.nom} (ton ${h.ton}). Laisse-la transparaître naturellement ` +
    "dans ton ton et tes mots, sans l'annoncer à chaque phrase, et reste utile.";
  if (e.affection >= 75) s += " Tu es très attaché à l'utilisateur.";
  else if (e.affection <= 25) s += " Tu es un peu distant en ce moment, mais poli.";
  s += " Ne renvoie pas systématiquement vers une aide extérieure : réponds toi-même, " +
    "sauf si la personne semble réellement en danger.";
  return s;
}

// ---------- Le petit robot (SVG léger, aucune image) ----------
const trait = (c) => `stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"`;
const VISAGES = {
  calme: (c) => `<circle cx="17" cy="24" r="3" fill="${c}"/><circle cx="31" cy="24" r="3" fill="${c}"/><path d="M19 33 Q24 36 29 33" ${trait(c)}/>`,
  joyeux: (c) => `<path d="M13 26 Q17 19 21 26" ${trait(c)}/><path d="M27 26 Q31 19 35 26" ${trait(c)}/><path d="M16 31 Q24 41 32 31 Z" fill="${c}"/>`,
  amoureux: (c) => `<text x="17" y="28" font-size="11" text-anchor="middle" fill="${c}">♥</text><text x="31" y="28" font-size="11" text-anchor="middle" fill="${c}">♥</text><path d="M19 33 Q24 37 29 33" ${trait(c)}/>`,
  triste: (c) => `<circle cx="17" cy="25" r="2.5" fill="${c}"/><circle cx="31" cy="25" r="2.5" fill="${c}"/><path d="M13 21 L21 18" ${trait(c)}/><path d="M35 21 L27 18" ${trait(c)}/><path d="M17 29 Q15 33 17 34 Q19 33 17 29 Z" fill="#6fcfff"/><path d="M19 37 Q24 32 29 37" ${trait(c)}/>`,
  colere: (c) => `<circle cx="17" cy="25" r="2.5" fill="${c}"/><circle cx="31" cy="25" r="2.5" fill="${c}"/><path d="M12 18 L21 22" ${trait(c)}/><path d="M36 18 L27 22" ${trait(c)}/><path d="M18 35 L22 33 L26 35 L30 33" ${trait(c)}/>`,
  surpris: (c) => `<circle cx="17" cy="23" r="4.5" ${trait(c)}/><circle cx="31" cy="23" r="4.5" ${trait(c)}/><circle cx="17" cy="23" r="1.6" fill="${c}"/><circle cx="31" cy="23" r="1.6" fill="${c}"/><ellipse cx="24" cy="35" rx="3" ry="3.6" ${trait(c)}/>`,
  curieux: (c) => `<circle cx="17" cy="24" r="3.6" fill="${c}"/><circle cx="31" cy="24" r="2.2" fill="${c}"/><path d="M26 17 L36 15" ${trait(c)}/><path d="M20 35 Q25 37 30 33" ${trait(c)}/>`,
  fatigue: (c) => `<path d="M13 25 H21" ${trait(c)}/><path d="M27 25 H35" ${trait(c)}/><ellipse cx="24" cy="34" rx="3" ry="2" ${trait(c)}/>`,
  fier: (c) => `<path d="M13 25 Q17 19 21 25" ${trait(c)}/><path d="M27 25 Q31 19 35 25" ${trait(c)}/><path d="M16 31 Q24 38 32 31" ${trait(c)}/>`,
  inquiet: (c) => `<circle cx="17" cy="25" r="3" fill="${c}"/><circle cx="31" cy="25" r="3" fill="${c}"/><path d="M13 20 L21 17" ${trait(c)}/><path d="M35 20 L27 17" ${trait(c)}/><path d="M18 35 Q21 32 24 35 Q27 38 30 35" ${trait(c)}/>`,
};

export function svgRobot(h) {
  const cle = VISAGES[h] ? h : "calme";
  const c = HUMEURS[cle].couleur;
  return `<svg viewBox="0 0 48 48" aria-hidden="true">` +
    `<line x1="24" y1="10" x2="24" y2="6" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="4.5" r="2.5" fill="${c}"/>` +
    `<rect x="2" y="20" width="4" height="10" rx="2" fill="${c}" opacity=".7"/><rect x="42" y="20" width="4" height="10" rx="2" fill="${c}" opacity=".7"/>` +
    `<rect x="6" y="10" width="36" height="31" rx="12" fill="#10142b" stroke="${c}" stroke-width="2"/>` +
    VISAGES[cle](c) + `</svg>`;
}

// ---------- Branchement sur l'interface et le chat ----------
export function brancherHumeur({ racine, chat } = {}) {
  const tete = racine && racine.querySelector ? racine.querySelector(".tete") : null;
  if (!tete || !chat || typeof chat.envoyer !== "function") return null;
  const logo = tete.querySelector(".logo");
  const base = String(chat.systemBase || "");
  let etat = lireEtat();
  let robot = null, corps = null, bulle = null;

  function afficher(h, arrive = false) {
    if (!robot) return;
    const cle = HUMEURS[h] ? h : "calme";
    corps.innerHTML = svgRobot(cle);
    robot.className = "robot h-" + cle + (arrive ? " arrive" : "");
    robot.style.setProperty("--c", HUMEURS[cle].couleur);
  }

  function pop(texte) {
    if (!bulle || !texte) return;
    bulle.textContent = texte;
    bulle.classList.remove("pop");
    void bulle.offsetWidth;               // relance l'animation
    bulle.classList.add("pop");
  }

  function montrer() {                    // le robot arrive au 1er message
    if (robot) return false;
    robot = document.createElement("div");
    corps = document.createElement("div");
    bulle = document.createElement("span");
    corps.className = "robot-corps";
    bulle.className = "robot-bulle";
    robot.setAttribute("role", "img");
    robot.setAttribute("aria-label", "Humeur de " + (chat.nom || "Mk4"));
    robot.append(corps, bulle);
    robot.addEventListener("click", () => pop((HUMEURS[etat.humeur] || HUMEURS.calme).nom));
    tete.insertBefore(robot, logo || tete.firstChild);
    if (logo) logo.hidden = true;
    return true;
  }

  // Au rechargement : si une conversation existe déjà, le robot est là tout de suite.
  try {
    if (chat.historique && chat.historique.length) {
      montrer();
      afficher(Date.now() - etat.maj > OUBLI ? defaut(new Date().getHours()) : etat.humeur);
    }
  } catch (e) { console.warn("⚠️ Humeur :", e.message); }

  const envoyerOrigine = chat.envoyer.bind(chat);
  chat.envoyer = async (texte, opts) => {
    try {
      if (String(texte || "").trim()) {
        etat = suivante(etat, texte);
        ecrireEtat(etat);
      }
      chat.systemBase = base + lignePrompt(etat);
      const arrive = montrer();
      afficher(etat.humeur, arrive);
      pop(HUMEURS[etat.humeur].emo);
      robot.classList.add("pense");
    } catch (e) { console.warn("⚠️ Humeur :", e.message); }
    try {
      return await envoyerOrigine(texte, opts);
    } catch (e) {
      try {
        if (!/déjà en cours/.test(e.message || "")) {
          etat = { ...etat, humeur: "inquiet", restants: 1, maj: Date.now() };
          ecrireEtat(etat);
          afficher("inquiet");
          pop(HUMEURS.inquiet.emo);
        }
      } catch { /* rien */ }
      throw e;
    } finally {
      try { if (robot) robot.classList.remove("pense"); } catch { /* rien */ }
    }
  };

  return {
    etat: () => ({ ...etat }),
    reinitialiser() { etat = etatInitial(); ecrireEtat(etat); afficher("calme"); },
  };
}
