// The landing's moving parts: the Lock Screen's Live Activity, the Quai Cloud switch,
// and cards that fade in as they scroll into view.
document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const AMBER = "#FFC230";
const GREEN = "#30D158";
const PURPLE = "#B57EDC";

// The story the Lock Screen tells, in seconds: a request on Seerr is approved from the Lock Screen,
// then searched for, downloaded, imported, ready; then it's played, and the download's Live Activity gives way to the playback one.
const SCENE = [
  { until: 0.8, card: null },
  { until: 3.4, card: "request" },
  { until: 3.9, card: "request", approved: true },
  { until: 4.4, card: null },
  { until: 6.0, card: "dl", stage: "search" },
  { until: 10.2, card: "dl", stage: "dl" },
  { until: 11.8, card: "dl", stage: "import" },
  { until: 14.4, card: "dl", stage: "ready" },
  { until: 15.0, card: null },
  { until: 20.5, card: "play" },
  { until: 21.4, card: null },
];
const LOOP = SCENE[SCENE.length - 1].until;
const DOWNLOAD = { from: 6.0, to: 10.2 };
const PLAYBACK = { from: 15.0, runtime: 166 * 60 + 12 };

const sceneAt = (t) => SCENE.find((s) => t < s.until) ?? SCENE[0];

const clock = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/** What the download's Live Activity shows at `t`. */
const downloadAt = (t, stage) => {
  if (stage === "search") return { step: 0, pct: 4, sub: "Looking for a release", island: "Search", colour: AMBER };
  if (stage === "import") return { step: 2, pct: 100, sub: "Importing into Jellyfin", island: "Import", colour: AMBER };
  if (stage === "ready") return { step: 3, pct: 100, sub: "Ready to watch", island: "Ready", colour: GREEN };
  const pct = Math.min(99, Math.round(8 + ((t - DOWNLOAD.from) / (DOWNLOAD.to - DOWNLOAD.from)) * 91));
  const left = Math.max(1, Math.ceil((100 - pct) / 12));
  return { step: 1, pct, sub: `≈ ${left} min left · 11 MB/s`, island: `${pct}%`, colour: AMBER };
};

const phone = document.querySelector('[role="img"][aria-label^="iPhone Lock Screen"]');

const renderPhone = (t) => {
  const scene = sceneAt(t);
  const island = phone.querySelector(".q-island");
  const dlCard = phone.querySelector('[data-card="dl"]');
  for (const card of phone.querySelectorAll("[data-card]")) card.classList.toggle("is-out", card.dataset.card !== scene.card);
  island.classList.toggle("is-idle", scene.card === null);
  const islandText = phone.querySelector('[data-text="island"]');

  if (scene.card === "request") {
    for (const el of island.querySelectorAll("[data-show]")) el.hidden = el.dataset.show !== "request";
    islandText.textContent = "Request";
    islandText.style.color = "#8F7BFF";
    phone.querySelector(".q-approve").classList.toggle("is-pressed", Boolean(scene.approved));
    return;
  }

  if (scene.card === "play") {
    const elapsed = (t - PLAYBACK.from) * 60;
    for (const el of island.querySelectorAll("[data-show]")) el.hidden = el.dataset.show !== "play";
    islandText.textContent = clock(PLAYBACK.runtime - elapsed);
    islandText.style.color = PURPLE;
    phone.querySelector('[data-text="elapsed"]').textContent = clock(elapsed);
    phone.querySelector('[data-text="remaining"]').textContent = `-${clock(PLAYBACK.runtime - elapsed)}`;
    phone.querySelector("[data-play-bar]").style.width = `${Math.max(1, (elapsed / PLAYBACK.runtime) * 100)}%`;
    return;
  }
  if (scene.card !== "dl") return;

  const d = downloadAt(t, scene.stage);
  const shows = { search: scene.stage === "search", dl: scene.stage === "dl", import: scene.stage === "import", ready: scene.stage === "ready", pct: scene.stage === "dl" };
  for (const el of dlCard.querySelectorAll("[data-show]")) el.hidden = !shows[el.dataset.show];
  for (const el of island.querySelectorAll("[data-show]")) {
    const side = el.dataset.show;
    el.hidden = !(side === "ready" ? shows.ready : side === "search" ? shows.search : side === "dl" ? shows.dl || shows.import : false);
  }
  islandText.textContent = d.island;
  islandText.style.color = d.colour;
  phone.querySelector('[data-text="pct"]').textContent = `${d.pct}%`;
  phone.querySelector('[data-text="sub"]').textContent = d.sub;
  const bar = phone.querySelector("[data-bar]");
  bar.style.width = `${d.pct}%`;
  bar.style.backgroundColor = d.colour;
  for (const step of phone.querySelectorAll(".q-step")) {
    const i = Number(step.dataset.step);
    step.classList.toggle("is-active", i === d.step);
    step.classList.toggle("is-todo", i > d.step);
    step.style.setProperty("--q-step", d.colour);
  }
};

if (phone && !reduceMotion) {
  let started = performance.now();
  let frame = 0;
  let lastDrawn = -1;
  const tick = (now) => {
    const t = ((now - started) / 1000) % LOOP;
    // Ten frames a second is plenty for a progress bar, and keeps the page quiet.
    if (Math.floor(t * 10) !== lastDrawn) {
      lastDrawn = Math.floor(t * 10);
      renderPhone(t);
    }
    frame = requestAnimationFrame(tick);
  };
  const start = () => { if (!frame) { started = performance.now(); frame = requestAnimationFrame(tick); } };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  // Only run while the phone is on screen and the tab is visible; each start replays the story.
  let onScreen = true;
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; onScreen && !document.hidden ? start() : stop(); }).observe(phone);
  document.addEventListener("visibilitychange", () => { onScreen && !document.hidden ? start() : stop(); });
  start();
}

// "With our Quai Cloud" or "Fully self-hosted": both buttons switch the diagram and the cards below it.
const picks = document.querySelectorAll(".q-pick");
const how = document.getElementById("how");
for (const button of picks) {
  button.addEventListener("click", () => {
    const ours = button.dataset.mode === "ours";
    for (const b of picks) b.setAttribute("aria-pressed", String(b === button));
    for (const el of how.querySelectorAll("q-if[data-if]")) {
      const show = el.dataset.if === "ours" ? ours : !ours;
      if (show === !el.hidden) continue;
      el.hidden = !show;
      for (const child of el.querySelectorAll("[data-reveal]")) child.classList.add("in");
      if (show && !reduceMotion) {
        for (const child of el.children) {
          child.classList.remove("q-swap");
          void child.offsetWidth;
          child.classList.add("q-swap");
        }
      }
    }
  });
}

// Our Quai Cloud or one's own: the setup's compose.yaml and its sentence follow the choice.
const cloudPicks = document.querySelectorAll(".q-cloud-pick");
for (const button of cloudPicks) {
  button.addEventListener("click", () => {
    const choice = button.dataset.cloud;
    for (const b of cloudPicks) b.setAttribute("aria-pressed", String(b === button));
    for (const el of document.querySelectorAll("[data-compose], [data-compose-text]")) {
      el.hidden = (el.dataset.compose ?? el.dataset.composeText) !== choice;
    }
  });
}

// Reveal on scroll, staggered among siblings.
const revealed = document.querySelectorAll("[data-reveal]");
if (reduceMotion || !("IntersectionObserver" in window)) {
  for (const el of revealed) el.classList.add("in");
} else {
  for (const el of revealed) {
    const siblings = [...el.parentElement.children].filter((c) => c.hasAttribute("data-reveal"));
    el.style.setProperty("--delay", Math.min(siblings.indexOf(el), 4) * 0.08 + "s");
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const el of revealed) observer.observe(el);
}
