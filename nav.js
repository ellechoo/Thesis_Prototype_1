// nav.js — "Breakdown" and "Portrait" only open once there's a recording to show:
// one the visitor just made, or one they opened from the archive. Until then the two tabs are
// greyed out. The current recording is remembered for this browser tab only (sessionStorage),
// so a new visitor in a fresh tab starts with them locked again. Visiting Record locks them again too.
const KEY = "currentTakeId";
const page = location.pathname.split("/").pop() || "index.html"; // index.html is the landing page
const urlId = new URLSearchParams(location.search).get("id");
// an ID card (archive.html?id=…) counts too: Breakdown and Portrait open for that person
const onTakePage = page === "breakdown.html" || page === "portrait.html" || (page === "archive.html" && !!urlId);

function read() { try { return sessionStorage.getItem(KEY); } catch { return null; } }
export function setCurrentTakeId(id) { try { sessionStorage.setItem(KEY, id); } catch {} }
if (onTakePage && urlId) setCurrentTakeId(urlId);
// Going to the Record page or the Archive gallery starts over: Breakdown and Portrait lock (and fold away) again
// until the next recording, or until a portrait is opened from the archive.
if (page === "record.html" || (page === "archive.html" && !urlId)) { try { sessionStorage.removeItem(KEY); } catch {} }

/** The recording the Breakdown / Portrait pages should show, or null. */
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

// FOLDER-TAB ANIMATION: Breakdown and Portrait sit collapsed behind Record while locked.
// If that changed since the last page (e.g. just finished recording, or came back to Record),
// the page starts in the old state and then animates to the new one.
const nav = document.querySelector(".tabs");
if (nav) {
  const collapsed = !id;
  let was = null;
  try { was = sessionStorage.getItem("navCollapsed"); } catch {}
  const start = was === null ? collapsed : was === "1";
  nav.classList.add("no-anim");
  nav.classList.toggle("collapsed", start);
  void nav.offsetWidth; // apply the starting state without animating
  requestAnimationFrame(() => requestAnimationFrame(() => {
    nav.classList.remove("no-anim");
    nav.classList.toggle("collapsed", collapsed);
  }));
  try { sessionStorage.setItem("navCollapsed", collapsed ? "1" : "0"); } catch {}
}
