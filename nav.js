// nav.js — "Your data" and "Portrait" only open once there's a recording to show:
// one the visitor just made, or one they opened from the archive. Until then the two tabs are
// greyed out. The current recording is remembered for this browser tab only (sessionStorage),
// so a new visitor in a fresh tab starts with them locked again.
const KEY = "currentTakeId";
const page = location.pathname.split("/").pop() || "index.html";
const urlId = new URLSearchParams(location.search).get("id");
const onTakePage = page === "breakdown.html" || page === "portrait.html";

function read() { try { return sessionStorage.getItem(KEY); } catch { return null; } }
export function setCurrentTakeId(id) { try { sessionStorage.setItem(KEY, id); } catch {} }
if (onTakePage && urlId) setCurrentTakeId(urlId);

/** The recording the Your data / Portrait pages should show, or null. */
export function currentTakeId() { return (onTakePage && urlId) || read(); }

const id = currentTakeId();
document.querySelectorAll(".tabs a").forEach((a) => {
  const target = (a.getAttribute("href") || a.dataset.href || "").split("?")[0];
  if (target !== "breakdown.html" && target !== "portrait.html") return;
  a.dataset.href = target;
  if (id) {
    a.href = `${target}?id=${encodeURIComponent(id)}`;
    a.removeAttribute("aria-disabled");
    a.removeAttribute("title");
  } else {
    a.removeAttribute("href");
    a.setAttribute("aria-disabled", "true");
    a.title = "Record your voice, or open a portrait from the archive, first";
  }
});
