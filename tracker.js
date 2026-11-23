/**
 * Merry Mery English - Universal Progress Tracker (tracker.js)
 * Conecta cualquier ejercicio HTML (en GitHub Pages) con el Portal del Alumno y Firebase.
 * Soporta las 9 habilidades:
 * grammar, gerunds, vocabulary, collocations, phrasal, idioms, listening, reading, writing
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =====================================================================
   1. CONFIGURACIÓN DE FIREBASE (Usar exactamente los mismos datos de index.html)
   Cuando pegues tus claves reales de Firebase, cambiá USE_DEMO_MODE a false.
   ===================================================================== */
const USE_DEMO_MODE = true;

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdef123456"
};

let auth = null;
let db = null;
let activeUser = null;

if (!USE_DEMO_MODE) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    activeUser = user || null;
    updateFloatingBadge();
  });
} else {
  // En modo Demo toma el usuario guardado en localStorage si ingresó desde el portal
  const savedDemo = localStorage.getItem("mme_demo_user");
  if (savedDemo) {
    try {
      activeUser = JSON.parse(savedDemo);
    } catch (e) {
      activeUser = null;
    }
  }
}

/* =====================================================================
   2. API GLOBAL: MMETracker
   Disponible en window.MMETracker para llamar desde cualquier ejercicio HTML
   ===================================================================== */
const VALID_SKILLS = [
  "grammar",
  "gerunds",
  "vocabulary",
  "collocations",
  "phrasal",
  "idioms",
  "listening",
  "reading",
  "writing"
];

/**
 * Guarda los porcentajes obtenidos en un ejercicio.
 * Ejemplo:
 * MMETracker.saveProgress("little-prince", { reading: 88, vocabulary: 84 });
 */
async function saveProgress(exerciseId, scoresObj, options = {}) {
  if (!exerciseId || typeof scoresObj !== "object") {
    console.warn("[MMETracker] Faltan datos: exerciseId o scoresObj.");
    return false;
  }

  // Filtrar solo habilidades válidas con valores numéricos (0-100)
  const cleanScores = {};
  VALID_SKILLS.forEach((skill) => {
    if (typeof scoresObj[skill] === "number" && !isNaN(scoresObj[skill])) {
      cleanScores[skill] = Math.max(0, Math.min(100, Math.round(scoresObj[skill])));
    }
  });

  if (Object.keys(cleanScores).length === 0) {
    console.warn("[MMETracker] No se enviaron porcentajes numéricos válidos.");
    return false;
  }

  // --- MODO DEMO (LocalStorage) ---
  if (USE_DEMO_MODE) {
    const demoKey = "mme_demo_scores";
    const existing = JSON.parse(localStorage.getItem(demoKey) || "{}");
    const prev = existing[exerciseId] || {};

    // Por defecto conserva la mejor nota (keepBest = true)
    const keepBest = options.keepBest !== false;
    const merged = { ...prev };

    Object.entries(cleanScores).forEach(([skill, val]) => {
      merged[skill] = keepBest && typeof prev[skill] === "number"
        ? Math.max(prev[skill], val)
        : val;
    });

    merged.status = "graded";
    merged.updatedAt = new Date().toISOString();
    existing[exerciseId] = merged;

    localStorage.setItem(demoKey, JSON.stringify(existing));
    showTrackerToast("✓ Progreso guardado en tu Portal Merry Mery English");
    return true;
  }

  // --- MODO PRODUCCIÓN (Firebase Firestore) ---
  if (!activeUser) {
    showTrackerToast("ℹ️ Iniciá sesión en el Portal para guardar tu progreso", true);
    return false;
  }

  try {
    const userRef = doc(db, "students", activeUser.uid);
    const snap = await getDoc(userRef);
    const currentData = snap.exists() ? snap.data() : { scores: {} };
    const prevExScores = (currentData.scores && currentData.scores[exerciseId]) || {};

    const keepBest = options.keepBest !== false;
    const mergedScores = { ...prevExScores };

    Object.entries(cleanScores).forEach(([skill, val]) => {
      mergedScores[skill] = keepBest && typeof prevExScores[skill] === "number"
        ? Math.max(prevExScores[skill], val)
        : val;
    });

    mergedScores.status = "graded";
    mergedScores.updatedAt = new Date().toISOString();

    await setDoc(
      userRef,
      {
        name: activeUser.displayName || activeUser.email.split("@")[0],
        email: activeUser.email,
        lastActive: serverTimestamp(),
        scores: {
          [exerciseId]: mergedScores
        }
      },
      { merge: true }
    );

    showTrackerToast("✓ ¡Puntaje guardado en tu perfil!");
    return true;
  } catch (err) {
    console.error("[MMETracker] Error al guardar en Firebase:", err);
    showTrackerToast("⚠️ No se pudo guardar el progreso. Revisá tu conexión.", true);
    return false;
  }
}

/**
 * Marca un ejercicio de Writing como "Enviado vía Copy & Open Gemini" (pendiente de revisión de Maru).
 * No altera el promedio del alumno hasta que Maru cargue la nota en su Panel Coach.
 * Ejemplo:
 * MMETracker.submitWritingForReview("writing-email", "Texto opcional del alumno...");
 */
async function submitWritingForReview(exerciseId, studentTextPreview = "") {
  if (!exerciseId) return false;

  const payload = {
    writing: null,
    status: "pending_review",
    submittedAt: new Date().toISOString(),
    preview: studentTextPreview.slice(0, 300)
  };

  if (USE_DEMO_MODE) {
    const demoKey = "mme_demo_scores";
    const existing = JSON.parse(localStorage.getItem(demoKey) || "{}");
    existing[exerciseId] = payload;
    localStorage.setItem(demoKey, JSON.stringify(existing));
    showTrackerToast("✍️ Writing enviado. Quedó pendiente de revisión por Maru.");
    return true;
  }

  if (!activeUser) {
    showTrackerToast("ℹ️ Iniciá sesión en el Portal para registrar tu Writing", true);
    return false;
  }

  try {
    const userRef = doc(db, "students", activeUser.uid);
    await setDoc(
      userRef,
      {
        name: activeUser.displayName || activeUser.email.split("@")[0],
        email: activeUser.email,
        lastActive: serverTimestamp(),
        scores: {
          [exerciseId]: payload
        }
      },
      { merge: true }
    );
    showTrackerToast("✍️ Writing registrado. Esperando revisión de Maru.");
    return true;
  } catch (err) {
    console.error("[MMETracker] Error al registrar Writing:", err);
    return false;
  }
}

/* =====================================================================
   3. INDICADOR FLOTANTE DISCRETO EN EL EJERCICIO (CON LOGO REAL)
   ===================================================================== */
function injectStyles() {
  if (document.getElementById("mme-tracker-styles")) return;
  const style = document.createElement("style");
  style.id = "mme-tracker-styles";
  style.textContent = `
    .mme-portal-pill {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 9999;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(6px);
      color: #fff;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px 6px 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.22);
      border: 1px solid rgba(13, 148, 136, 0.45);
      transition: transform 0.2s ease, background 0.2s ease;
    }
    .mme-tracker-logo {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      border: 1.5px solid #2dd4bf;
      background: #fff;
      flex-shrink: 0;
    }
    .mme-portal-pill:hover {
      transform: translateY(-2px);
      background: #4f46e5;
    }
    .mme-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
    }
    .mme-dot.offline {
      background: #fbbf24;
    }
    .mme-tracker-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      background: #0f172a;
      color: #fff;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      font-weight: 600;
      padding: 12px 18px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
      pointer-events: none;
    }
    .mme-tracker-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
}

function updateFloatingBadge() {
  injectStyles();
  let pill = document.getElementById("mme-portal-pill");
  if (!pill) {
    pill = document.createElement("a");
    pill.id = "mme-portal-pill";
    pill.className = "mme-portal-pill";
    pill.href = "index.html";
    document.body.appendChild(pill);
  }

  const isConnected = USE_DEMO_MODE || Boolean(activeUser);
  const label = activeUser
    ? `Portal: ${activeUser.displayName || activeUser.email.split("@")[0]}`
    : (USE_DEMO_MODE ? "← Volver al Portal" : "Iniciar sesión para guardar");

  pill.innerHTML = `<img src="logo.png" alt="Merry Mery English Logo" class="mme-tracker-logo" /><span class="mme-dot ${isConnected ? "" : "offline"}"></span><span>${label}</span>`;
}

function showTrackerToast(message, isWarning = false) {
  injectStyles();
  let toast = document.getElementById("mme-tracker-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "mme-tracker-toast";
    toast.className = "mme-tracker-toast";
    document.body.appendChild(toast);
  }
  toast.style.borderLeft = isWarning ? "4px solid #f59e0b" : "4px solid #34d399";
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}

// Inicializar badge al cargar el DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", updateFloatingBadge);
} else {
  updateFloatingBadge();
}

// Exponer globalmente
window.MMETracker = {
  saveProgress,
  submitWritingForReview,
  VALID_SKILLS
};
