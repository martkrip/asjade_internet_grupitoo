// Kreutzwaldi tänava valgusfoor — põhirežiim (default)
//
// Signaalgrupid:
//   A1 – autod otse (Mustamäe tee poolt)
//   A7 – autod otse vastassuunast (A1 paariline, alati sama tuli)
//   J1, J6 – jalakäijad (ületavad A1/A7 sõiduteed, seega vastupidi autodele)
//
// Tulede väärtused:
//   autod:      "green" | "blinkinggreen" | "yellow" | "red" | "redyellow"
//   jalakäijad: "green" | "blinkinggreen" | "red"

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwPbwky8fri2VPIsEYw0bgAAe7TtB1lyMY-N1u5RFLSS5KZdjkepiVNle3eKyESg-hP/exec";

// Faasid järjekorras. duration on millisekundites.
const PHASES = [
  { name: "Autod sõidavad",             duration: 15000, car: "green",         person: "red" },
  { name: "Autode roheline lõpeb",      duration: 3000,  car: "blinkinggreen", person: "red" },
  { name: "Autod peatuvad",             duration: 3000,  car: "yellow",        person: "red" },
  { name: "Kõik punased",               duration: 2000,  car: "red",           person: "red" },
  { name: "Jalakäijad lähevad",         duration: 15000, car: "red",           person: "green" },
  { name: "Jalakäijate roheline lõpeb", duration: 4000,  car: "red",           person: "blinkinggreen" },
  { name: "Kõik punased",               duration: 2000,  car: "red",           person: "red" },
  { name: "Autod valmistuvad",          duration: 2000,  car: "redyellow",     person: "red" },
];

const TICK_MS = 100;
const HEARTBEAT_MS = 10000;
const BLINK_MS = 500;

let phaseIndex = 0;
let phaseEndsAt = 0;

let lastPublishedPhase = -1;
let lastPublishAt = 0;
let sendInFlight = false;
let queuedUrl = null;

// Praegune olek kõigi nelja signaali jaoks.
function currentState() {
  const phase = PHASES[phaseIndex];
  return {
    A1: phase.car,
    A7: phase.car,
    J1: phase.person,
    J6: phase.person,
  };
}

function start() {
  phaseIndex = 0;
  phaseEndsAt = performance.now() + PHASES[0].duration;
  setInterval(tick, TICK_MS);
  tick();
}

function tick() {
  const now = performance.now();

  // Liigu järgmisse faasi (while juhuks, kui vahekaart oli taustal ja aega läks rohkem).
  while (now >= phaseEndsAt) {
    phaseIndex = (phaseIndex + 1) % PHASES.length;
    phaseEndsAt += PHASES[phaseIndex].duration;
  }

  render(now);
  publish(now);
}

// ---------- Ekraanil kuvamine ----------

// Millised lambid põlevad antud olekus (blinkOn = vilkumise "sees" pool).
function litLamps(state, blinkOn) {
  switch (state) {
    case "red":           return ["red"];
    case "yellow":        return ["yellow"];
    case "redyellow":     return ["red", "yellow"];
    case "green":         return ["green"];
    case "blinkinggreen": return blinkOn ? ["green"] : [];
    default:              return [];
  }
}

function render(now) {
  const state = currentState();
  const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;

  for (const [id, value] of Object.entries(state)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const on = litLamps(value, blinkOn);
    el.querySelectorAll(".lamp").forEach((lamp) => {
      lamp.classList.toggle("on", on.includes(lamp.dataset.color));
    });
    el.querySelector(".state").textContent = value;
  }

  const remaining = Math.max(0, phaseEndsAt - now);
  document.getElementById("phaseName").textContent = PHASES[phaseIndex].name;
  document.getElementById("timeLeft").textContent = (remaining / 1000).toFixed(1) + " s";
}

// ---------- Oleku saatmine Google Apps Scriptile (füüsiline foor loeb sealt) ----------

function publish(now) {
  // Saada ainult faasi vahetusel + iga HEARTBEAT_MS järel.
  if (phaseIndex === lastPublishedPhase && now - lastPublishAt < HEARTBEAT_MS) return;

  lastPublishedPhase = phaseIndex;
  lastPublishAt = now;

  const state = currentState();
  const params = new URLSearchParams({
    ...state,
    // Vanad väljad, et olemasolev Apps Script / ESP8266 kood töötaks edasi.
    currentCarLight: state.A1,
    currentPersonLight: state.J1,
    timeLeft: String(Math.round(phaseEndsAt - now)),
  });

  queuedUrl = `${SCRIPT_URL}?${params.toString()}`;
  drain();
}

async function drain() {
  if (sendInFlight || !queuedUrl) return;
  const url = queuedUrl;
  queuedUrl = null;
  sendInFlight = true;
  try {
    await fetch(url, { cache: "no-store", mode: "no-cors" });
  } catch (err) {
    console.warn("Oleku saatmine ebaõnnestus:", err);
  } finally {
    sendInFlight = false;
    if (queuedUrl) drain();
  }
}

document.addEventListener("DOMContentLoaded", start);
