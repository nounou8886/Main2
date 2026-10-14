// =====================================================================
// Mk4 PWA — MODULE 5 : ui.js (l'interface) — avec style.css
// Rôle : afficher le chat (bulles, photos, statuts « Mk4 is thinking »),
//        l'onglet Mémoire (liste, modifier, supprimer, export/import)
//        et les options (modèle, recherche web).
// Dépend de : gemini.js (modèles), memoire.js, et d'un chat créé par chat.js.
//   import { demarrerUI } from "./ui.js";
//   demarrerUI({ racine: document.getElementById("racine"), chat: creerChat() });
// =====================================================================
import { MODELES, MODELE_DEFAUT, MAX_PHOTOS } from "./gemini.js";
import { lister, supprimer, modifier, vider, exporterEnFichier, importerFichier } from "./memoire.js";

const CLE_OPTIONS = "mk4_options";
const PHRASES = {
  memoire: "is loading memories", reflexion: "is thinking", web: "is searching the web",
  photo: "is looking at the photo", memorisation: "is saving this to memory",
};

// ---------- Mise en forme du texte (Markdown simplifié, sûr) ----------
export function echapper(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function enLigne(brut) {
  return echapper(brut).split(/(`[^`]+`)/).map((seg) => {
    if (/^`[^`]+`$/.test(seg)) return `<code>${seg.slice(1, -1)}</code>`;
    return seg
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }).join("");
}

export function markdownVersHtml(texte) {
  const lignes = String(texte || "").replace(/\r/g, "").split("\n");
  const sortie = [];
  const debutBloc = (l) => /^```|^#{1,3}\s|^\s*[-*•]\s+|^\s*\d+[.)]\s+/.test(l);
  let i = 0;
  while (i < lignes.length) {
    const l = lignes[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {                                   // bloc de code
      const code = [];
      i++;
      while (i < lignes.length && !/^```/.test(lignes[i])) code.push(lignes[i++]);
      i++;
      sortie.push(`<pre><code>${echapper(code.join("\n"))}</code></pre>`);
      continue;
    }
    const t = l.match(/^(#{1,3})\s+(.*)$/);                 // titres
    if (t) { const n = t[1].length + 2; sortie.push(`<h${n}>${enLigne(t[2])}</h${n}>`); i++; continue; }
    const puce = /^\s*[-*•]\s+/, num = /^\s*\d+[.)]\s+/;     // listes
    if (puce.test(l) || num.test(l)) {
      const motif = puce.test(l) ? puce : num, balise = puce.test(l) ? "ul" : "ol", items = [];
      while (i < lignes.length && motif.test(lignes[i])) items.push(`<li>${enLigne(lignes[i++].replace(motif, ""))}</li>`);
      sortie.push(`<${balise}>${items.join("")}</${balise}>`);
      continue;
    }
    const para = [];                                         // paragraphe
    while (i < lignes.length && lignes[i].trim() && !debutBloc(lignes[i])) para.push(enLigne(lignes[i++]));
    if (!para.length) { para.push(enLigne(lignes[i++])); }
    sortie.push(`<p>${para.join("<br>")}</p>`);
  }
  return sortie.join("");
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

const chargement = (phrase) =>
  `<div class="chargement"><span class="anneau"></span><span class="brille">${echapper(phrase)}</span>` +
  `<span class="points"><i></i><i></i><i></i></span></div>`;

function lireOptions() {
  try { return JSON.parse(localStorage.getItem(CLE_OPTIONS) || "{}"); } catch { return {}; }
}
function ecrireOptions(o) {
  try { localStorage.setItem(CLE_OPTIONS, JSON.stringify(o)); } catch { /* rien */ }
}

// ---------- Interface ----------
export function demarrerUI({ racine, chat }) {
  const opts = lireOptions();
  let photos = [];          // fichiers en attente d'envoi
  let numeroEnvoi = 0;      // pour ignorer les statuts d'un envoi plus ancien

  // --- En-tête et onglets ---
  const titre = el("b", { texte: chat.nom });
  const btnNeuf = el("button", { class: "btn", id: "neuf", type: "button", texte: "🧹 Nouveau" });
  const tete = el("header", { class: "tete" },
    el("div", { class: "logo", texte: "M" }),
    el("div", { class: "titre" }, titre, el("span", { texte: "mémoire locale · Gemini" })),
    btnNeuf);
  const ongChat = el("button", { class: "onglet actif", type: "button", texte: "💬 Chat" });
  const ongMem = el("button", { class: "onglet", type: "button", texte: "🧠 Mémoire" });
  const onglets = el("nav", { class: "onglets" }, ongChat, ongMem);

  // --- Vue Chat ---
  const selModele = el("select", { id: "modele" },
    MODELES.map((m) => el("option", { value: m.id, texte: m.label })));
  selModele.value = MODELES.some((m) => m.id === opts.modele) ? opts.modele : MODELE_DEFAUT;
  const caseWeb = el("input", { type: "checkbox", id: "web" });
  caseWeb.checked = !!opts.web;
  const sauverOptions = () => ecrireOptions({ modele: selModele.value, web: caseWeb.checked });
  selModele.addEventListener("change", sauverOptions);
  caseWeb.addEventListener("change", sauverOptions);
  const options = el("details", { class: "options" },
    el("summary", { texte: "⚙️ Options (modèle, recherche web)" }),
    el("label", { texte: "🧠 Modèle Gemini" }), selModele,
    el("label", { class: "case" }, caseWeb, " 🌐 Recherche web (Google)"));

  const fil = el("div", { class: "fil", id: "chat" });
  const etat = el("div", { class: "etat", id: "etat" });
  const apercu = el("div", { class: "apercu" });
  const zone = el("textarea", { id: "saisie", rows: "1", placeholder: "Écris à " + chat.nom + "…", enterkeyhint: "send" });
  const fichier = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  const btnPhoto = el("button", { class: "rond", type: "button", "aria-label": "Joindre une photo", texte: "📎" });
  const btnEnvoi = el("button", { class: "rond envoi", type: "submit", "aria-label": "Envoyer", texte: "➤" });
  const saisie = el("form", { class: "saisie" }, btnPhoto, zone, btnEnvoi);
  const vueChat = el("section", { class: "vue", id: "vueChat" }, options, fil, etat, apercu, saisie, fichier);

  // --- Vue Mémoire ---
  const msgMem = el("div", { class: "etat" });
  const compteur = el("b", { texte: "" });
  const listeMem = el("div", { class: "liste-mem" });
  const fichierImport = el("input", { type: "file", accept: "application/json,.json", hidden: true });
  const barre = el("div", { class: "barre-mem" },
    el("button", { class: "btn", type: "button", texte: "🔄 Actualiser", onclick: () => rafraichirMemoire() }),
    el("button", { class: "btn", type: "button", texte: "⬇️ Exporter", onclick: exporterMem }),
    el("button", { class: "btn", type: "button", texte: "⬆️ Importer", onclick: () => fichierImport.click() }),
    el("button", { class: "btn danger", type: "button", texte: "🗑️ Tout effacer", onclick: toutEffacer }));
  const vueMem = el("section", { class: "vue", id: "vueMem", hidden: true }, compteur, barre, msgMem, listeMem, fichierImport);

  racine.textContent = "";
  racine.append(el("div", { class: "app" }, tete, onglets, vueChat, vueMem));

  // --- Hauteur : le clavier ne doit jamais faire défiler la page ---
  function ajusterHauteur() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty("--hauteur", h + "px");
    window.scrollTo(0, 0);
  }
  ajusterHauteur();
  window.addEventListener("resize", ajusterHauteur);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", ajusterHauteur);
    window.visualViewport.addEventListener("scroll", () => window.scrollTo(0, 0));
  }

  // --- Onglets ---
  function afficher(nom) {
    const memoire = nom === "memoire";
    vueChat.hidden = memoire;
    vueMem.hidden = !memoire;
    ongChat.classList.toggle("actif", !memoire);
    ongMem.classList.toggle("actif", memoire);
    if (memoire) rafraichirMemoire();
  }
  ongChat.addEventListener("click", () => afficher("chat"));
  ongMem.addEventListener("click", () => afficher("memoire"));

  // --- Messages ---
  const defiler = () => { fil.scrollTop = fil.scrollHeight; };

  function videAccueil() {
    fil.append(el("div", { class: "accueil", id: "accueil" },
      el("b", { texte: chat.nom }), "Je me souviens de nos conversations.", el("br"), "Écris-moi quelque chose 👇"));
  }
  function retirerAccueil() { const a = fil.querySelector("#accueil"); if (a) a.remove(); }

  function bulleUtilisateur(texte, fichiers, nbPhotos) {
    const b = el("div", { class: "msg moi" });
    for (const f of fichiers || []) {
      const img = el("img", { class: "mini", alt: "photo jointe" });
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      b.append(img);
    }
    if (!fichiers?.length && nbPhotos) b.append(el("div", { class: "note", texte: `📷 × ${nbPhotos}` }));
    if (texte) b.append(el("p", { texte }));
    fil.append(b);
    return b;
  }

  function sourcesHtml(sources) {
    if (!sources || !sources.length) return "";
    const liens = sources.map((s) => /^https?:\/\//.test(s.url)
      ? `<a href="${echapper(s.url)}" target="_blank" rel="noopener noreferrer">${echapper(s.titre)}</a>` : "").filter(Boolean);
    return liens.length ? `<p class="sources">🌐 <b>Sources</b> : ${liens.join(" · ")}</p>` : "";
  }

  function bulleBot(html) {
    const b = el("div", { class: "msg bot" });
    b.innerHTML = html;          // html = déjà échappé (markdownVersHtml / chargement)
    fil.append(b);
    return b;
  }

  function restaurerHistorique() {
    const h = chat.historique;
    if (!h.length) { videAccueil(); return; }
    for (const m of h) {
      if (m.role === "user") bulleUtilisateur(m.texte, null, m.photos);
      else bulleBot(markdownVersHtml(m.texte) + sourcesHtml(m.sources));
    }
    defiler();
  }

  // --- Envoi ---
  async function envoyer() {
    if (chat.occupe) return;
    const texte = zone.value.trim();
    if (!texte && !photos.length) return;
    const fichiers = photos.slice();
    zone.value = "";
    photos = [];
    ajusterZone();
    majApercu();
    retirerAccueil();
    const moi = ++numeroEnvoi;
    bulleUtilisateur(texte, fichiers);
    const bulle = bulleBot(chargement(chat.nom + " is waking up"));
    etat.textContent = "";
    btnEnvoi.disabled = true;
    defiler();
    let fini = false;
    try {
      const r = await chat.envoyer(texte, {
        fichiers, modele: selModele.value, web: caseWeb.checked,
        onEtat: (e) => {
          if (e === "memorisation") { if (moi === numeroEnvoi) etat.innerHTML = chargement(`${chat.nom} ${PHRASES[e]}`); }
          else if (!fini) bulle.innerHTML = chargement(`${chat.nom} ${PHRASES[e] || "is working"}`);
        },
      });
      fini = true;
      if (!r) { bulle.remove(); return; }
      bulle.innerHTML = markdownVersHtml(r.texte) + sourcesHtml(r.sources);
      defiler();
      const infos = [];
      if (r.repli) infos.push(`⚠️ ${selModele.value} indisponible, réponse via ${r.modele}`);
      if (r.memoireIndispo) infos.push("⚠️ mémoire indisponible pour cette réponse");
      if (r.sources.length) infos.push("🌐 recherche web");
      const m = await r.memorisation;   // l'animation « saving » reste visible jusqu'ici
      if (moi === numeroEnvoi) {
        if (m.erreur) infos.push("⚠️ mémorisation échouée : " + m.erreur);
        else if (m.bilan && m.bilan.ajoutes + m.bilan.mis_a_jour > 0) infos.push(`✓ ${chat.nom} a retenu ${m.bilan.ajoutes + m.bilan.mis_a_jour} info(s)`);
        etat.textContent = infos.join(" · ");
      }
    } catch (e) {
      fini = true;
      bulle.innerHTML = markdownVersHtml("⚠️ " + (e.message || "Une erreur est survenue, réessaie."));
      zone.value = texte;                     // on rend le texte et les photos pour réessayer
      photos = fichiers;
      ajusterZone();
      majApercu();
    } finally {
      btnEnvoi.disabled = false;
      defiler();
    }
  }

  // --- Saisie : zone qui grandit, Entrée envoie sur ordinateur ---
  function ajusterZone() {
    zone.style.height = "auto";
    zone.style.height = Math.min(zone.scrollHeight, Math.round(window.innerHeight * 0.28)) + "px";
  }
  zone.addEventListener("input", ajusterZone);
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      envoyer();
    }
  });
  saisie.addEventListener("submit", (e) => { e.preventDefault(); envoyer(); });

  // --- Photos ---
  function majApercu() {
    apercu.textContent = "";
    photos.forEach((f, i) => {
      const img = el("img", { alt: "", class: "puce-img" });
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      apercu.append(el("span", { class: "puce" }, img,
        el("button", { type: "button", "aria-label": "Retirer la photo", texte: "×", onclick: () => { photos.splice(i, 1); majApercu(); } })));
    });
  }
  btnPhoto.addEventListener("click", () => fichier.click());
  fichier.addEventListener("change", () => {
    const nouvelles = Array.from(fichier.files || []).filter((f) => /^image\//.test(f.type));
    photos = photos.concat(nouvelles).slice(0, MAX_PHOTOS);
    fichier.value = "";
    majApercu();
  });

  // --- Nouvelle conversation ---
  btnNeuf.addEventListener("click", () => {
    if (chat.occupe) return;
    chat.nouvelleConversation();
    fil.textContent = "";
    etat.textContent = "";
    videAccueil();
  });

  // --- Mémoire ---
  async function rafraichirMemoire() {
    try {
      const liste = await lister({ espace: chat.espace });
      compteur.textContent = `${liste.length} souvenir(s)`;
      listeMem.textContent = "";
      if (!liste.length) listeMem.append(el("p", { class: "vide-mem", texte: "Aucun souvenir pour l'instant." }));
      for (const s of liste) {
        listeMem.append(el("div", { class: "souv" },
          el("div", { class: "souv-txt" }, el("p", { texte: s.texte }), el("small", { texte: new Date(s.date).toLocaleDateString("fr-FR") })),
          el("div", { class: "souv-actions" },
            el("button", { type: "button", "aria-label": "Modifier", texte: "✏️", onclick: () => modifierSouvenir(s) }),
            el("button", { type: "button", "aria-label": "Supprimer", texte: "🗑️", onclick: () => supprimerSouvenir(s) }))));
      }
    } catch (e) {
      msgMem.textContent = "⚠️ " + e.message;
    }
  }
  async function modifierSouvenir(s) {
    const t = prompt("Modifier le souvenir :", s.texte);
    if (!t || !t.trim() || t.trim() === s.texte) return;
    msgMem.innerHTML = chargement(chat.nom + " is updating");
    try { await modifier(s.id, t); msgMem.textContent = "✓ Souvenir modifié"; } catch (e) { msgMem.textContent = "⚠️ " + e.message; }
    rafraichirMemoire();
  }
  async function supprimerSouvenir(s) {
    if (!confirm("Supprimer ce souvenir ?")) return;
    try { await supprimer(s.id); msgMem.textContent = ""; } catch (e) { msgMem.textContent = "⚠️ " + e.message; }
    rafraichirMemoire();
  }
  async function toutEffacer() {
    if (!confirm("Effacer TOUS les souvenirs ? C'est irréversible (pense à exporter d'abord).")) return;
    try { const n = await vider({ espace: chat.espace }); msgMem.textContent = `✓ ${n} souvenir(s) effacé(s)`; } catch (e) { msgMem.textContent = "⚠️ " + e.message; }
    rafraichirMemoire();
  }
  async function exporterMem() {
    try { const n = await exporterEnFichier({ espace: chat.espace }); msgMem.textContent = `✓ ${n} souvenir(s) exporté(s)`; } catch (e) { msgMem.textContent = "⚠️ " + e.message; }
  }
  fichierImport.addEventListener("change", async () => {
    const f = fichierImport.files && fichierImport.files[0];
    fichierImport.value = "";
    if (!f) return;
    try {
      const r = await importerFichier(f, { espace: chat.espace });
      msgMem.textContent = `✓ ${r.ajoutes} ajouté(s), ${r.ignores} ignoré(s)`;
    } catch (e) { msgMem.textContent = "⚠️ " + e.message; }
    rafraichirMemoire();
  });

  restaurerHistorique();
}
