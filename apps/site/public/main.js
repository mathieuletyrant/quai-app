// The landing's moving parts: the Lock Screen's Live Activity, the Quai Cloud switch,
// and cards that fade in as they scroll into view.
document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEPS = 4;
const AMBER = "#FFC230";
const GREEN = "#30D158";

// One tick every 110 ms, 125 ticks a loop: downloading from 40%, importing, ready.
const activityAt = (t) => {
  const phase = t < 60 ? 0 : t < 85 ? 1 : 2;
  const pct = phase === 0 ? 40 + t : 100;
  const left = Math.max(1, Math.ceil((100 - pct) / 12));
  return {
    phase,
    pct,
    sub: ["≈ " + left + " min left · 11 MB/s", "Importing into Jellyfin", "Ready to watch"][phase],
    flags: { isDl: phase === 0, isImp: phase === 1, isReady: phase === 2, notReady: phase !== 2 },
  };
};

const phone = document.querySelector('[role="img"][aria-label^="iPhone Lock Screen"]');

const renderActivity = (t) => {
  if (!phone) return;
  const { phase, pct, sub, flags } = activityAt(t);
  const colour = phase === 2 ? GREEN : AMBER;
  for (const el of phone.querySelectorAll("q-if[data-if]")) el.hidden = !flags[el.dataset.if];
  for (const el of phone.querySelectorAll('q-t[data-text="pctText"]')) el.textContent = pct + "%";
  for (const el of phone.querySelectorAll('q-t[data-text="sub"]')) el.textContent = sub;
  const bar = phone.querySelector("[data-bar]");
  bar.style.width = pct + "%";
  bar.style.backgroundColor = colour;
  const active = phase + 1;
  for (let i = 0; i < STEPS; i++) {
    const step = phone.querySelector(`[data-step="${i}"]`);
    step.firstElementChild.style.backgroundColor = i <= active ? colour : "#3A3A42";
    const label = step.lastElementChild;
    label.style.color = i === active ? "#F5F5F7" : "#A1A1A6";
    label.style.fontWeight = i === active ? "700" : "500";
  }
};

if (phone && !reduceMotion) {
  let t = 23;
  let timer = 0;
  const start = () => { if (!timer) timer = window.setInterval(() => { t = (t + 1) % 125; renderActivity(t); }, 110); };
  const stop = () => { window.clearInterval(timer); timer = 0; };
  // Only run while the phone is on screen and the tab is visible.
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
