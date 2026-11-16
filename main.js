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
//
// Füüsilised foorid (ESP8266) on samas WiFi võrgus ja leht saadab neile oleku otse:
//   GET http://<seade>/state?A1=green&A7=green&J1=red&J6=red

// Füüsiliste fooride aadressid. Nimi (mDNS) või IP, mille ESP Serial Monitori prindib.
const DEVICES = [
  "valgusfoor-a1.local",
  // "valgusfoor-a7.local",
  // "192.168.1.50",
];

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
const HEARTBEAT_MS = 2000;     // ESP läheb vilkuvale kollasele, kui 5 s jooksul olekut ei tule
const SEND_TIMEOUT_MS = 1500;
const BLINK_MS = 500;

let phaseIndex = 0;
let phaseEndsAt = 0;

let isNight = false;        // öörežiim: autodele vilkuv kollane, jalakäijate tuled väljas
let pedestrianWaiting = false; // keegi vajutas "Lase jalakäija läbi" ajal, kui autodel polnud rohelist

let lastPublishedKey = "";
let lastPublishAt = 0;
const inFlight = new Set();

// Praegune olek kõigi nelja signaali jaoks.
function currentState() {
  if (isNight) {
    return { A1: "blinkingyellow", A7: "blinkingyellow", J1: "off", J6: "off" };
  }
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

  document.getElementById("greenTimeBtn").addEventListener("click", changeGreenTime);
  document.getElementById("nightToggle").addEventListener("change", (e) => setNight(e.target.checked));
  document.getElementById("pedestrianBtn").addEventListener("click", letPedestrianThrough);

  setInterval(tick, TICK_MS);
  tick();
}

// Jäta faas vahele: alusta antud faasist kohe.
function jumpToPhase(index) {
  phaseIndex = index;
  phaseEndsAt = performance.now() + PHASES[index].duration;
}

function showHint(text) {
  document.getElementById("hint").textContent = text;
}

// ---------- Nupud ----------

// Autode ja jalakäijate rohelise pikkus (faasid "Autod sõidavad" ja "Jalakäijad lähevad").
function changeGreenTime() {
  const seconds = parseInt(document.getElementById("greenTime").value, 10);
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) {
    showHint("Rohelise aeg peab olema 5–120 sekundit.");
    return;
  }
  const ms = seconds * 1000;
  for (const phase of PHASES) {
    if (phase.car === "green" || phase.person === "green") phase.duration = ms;
  }
  showHint(`Rohelise aeg on nüüd ${seconds} s (kehtib järgmisest rohelisest).`);
}

function setNight(on) {
  isNight = on;
  document.getElementById("pedestrianBtn").disabled = on;
  if (on) {
    showHint("Öörežiim: autodele vilkuv kollane, jalakäijate foorid väljas.");
  } else {
    // Ohutu tagasitulek: kõik punased -> punane+kollane -> roheline.
    jumpToPhase(6);
    showHint("Tavarežiim taastatud.");
  }
}

// Nõudenupp: kui autodel on parasjagu roheline, lõpeta see kohe ja lase jalakäijad läbi.
function letPedestrianThrough() {
  if (isNight) return;
  if (phaseIndex === 0) {
    jumpToPhase(1);
    showHint("Jalakäija nõue vastu võetud – autode roheline lõpeb.");
  } else if (phaseIndex >= 1 && phaseIndex <= 3) {
    showHint("Jalakäijad saavad varsti rohelise.");
  } else if (phaseIndex === 4 || phaseIndex === 5) {
    showHint("Jalakäijatel on juba roheline.");
  } else {
    showHint("Jalakäija nõue vastu võetud – autode roheline jääb lühikeseks.");
    pedestrianWaiting = true;
  }
}

// Kui jalakäija ootab, on järgmine autode roheline lühike.
const SHORT_GREEN_MS = 5000;

function phaseDuration(index) {
  if (index === 0 && pedestrianWaiting) {
    pedestrianWaiting = false;
    return SHORT_GREEN_MS;
  }
  return PHASES[index].duration;
}

function tick() {
  const now = performance.now();

  if (isNight) {
    render(now);
    publish(now);
    return;
  }

  // Liigu järgmisse faasi (while juhuks, kui vahekaart oli taustal ja aega läks rohkem).
  while (now >= phaseEndsAt) {
    phaseIndex = (phaseIndex + 1) % PHASES.length;
    phaseEndsAt += phaseDuration(phaseIndex);
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
    case "blinkinggreen":  return blinkOn ? ["green"] : [];
    case "blinkingyellow": return blinkOn ? ["yellow"] : [];
    default:               return []; // "off"
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

  if (isNight) {
    document.getElementById("phaseName").textContent = "Öörežiim";
    document.getElementById("timeLeft").textContent = "–";
    return;
  }
  const remaining = Math.max(0, phaseEndsAt - now);
  document.getElementById("phaseName").textContent = PHASES[phaseIndex].name;
  document.getElementById("timeLeft").textContent = (remaining / 1000).toFixed(1) + " s";
}

// ---------- Oleku saatmine füüsilistele fooridele (ESP8266, sama WiFi) ----------

function publish(now) {
  // Saada oleku muutusel kohe + iga HEARTBEAT_MS järel, et ESP teaks, et leht töötab.
  const query = new URLSearchParams(currentState()).toString();
  if (query === lastPublishedKey && now - lastPublishAt < HEARTBEAT_MS) return;

  lastPublishedKey = query;
  lastPublishAt = now;

  for (const host of DEVICES) {
    sendTo(host, query);
  }
}

async function sendTo(host, query) {
  // Kui eelmine päring samale seadmele veel käib, jäta vahele (järgmine heartbeat saadab uuesti).
  if (inFlight.has(host)) return;
  inFlight.add(host);
  try {
    await fetch(`http://${host}/state?${query}`, {
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`Foor ${host} ei vasta:`, err.message);
  } finally {
    inFlight.delete(host);
  }
}

document.addEventListener("DOMContentLoaded", start);
