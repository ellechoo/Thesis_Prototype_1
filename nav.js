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
// Going to the landing page, the Record page or the Archive gallery starts over: Breakdown and Portrait lock (and fold away) again
// until the next recording, or until a portrait is opened from the archive.
if (page === "index.html" || page === "record.html" || (page === "archive.html" && !urlId)) { try { sessionStorage.removeItem(KEY); } catch {} }

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

// FOLDER-TAB ANIMATION: Breakdown and Portrait sit collapsed (folded away) while locked, and the
// Record tab is folded away on every page except Record itself. If either changed since the last page
// (e.g. just finished recording, came back to the landing page, opened an ID card), the page starts in
// the old state and then animates to the new one, so tabs slide open and shut instead of popping.
const nav = document.querySelector(".tabs");
if (nav) {
  const states = { collapsed: !id, "no-record": page !== "record.html" };
  const memory = { collapsed: "navCollapsed", "no-record": "navNoRecord" };
  nav.classList.add("no-anim");
  for (const [cls, now] of Object.entries(states)) {
    let was = null;
    try { was = sessionStorage.getItem(memory[cls]); } catch {}
    nav.classList.toggle(cls, was === null ? now : was === "1");
    try { sessionStorage.setItem(memory[cls], now ? "1" : "0"); } catch {}
  }
  void nav.offsetWidth; // apply the starting state without animating
  requestAnimationFrame(() => requestAnimationFrame(() => {
    nav.classList.remove("no-anim");
    for (const [cls, now] of Object.entries(states)) nav.classList.toggle(cls, now);
  }));
  // a folded-away Record tab can't be reached with the keyboard or a screen reader
  const rec = nav.querySelector(".nav-record");
  if (rec && states["no-record"]) { rec.tabIndex = -1; rec.setAttribute("aria-hidden", "true"); }
}


// Small body text: no word left alone on a paragraph's last line. Browsers that understand text-wrap: pretty (style.css)
// do it themselves; for the rest, the last two words of each paragraph are joined with a non-breaking space.
if (!CSS.supports?.("text-wrap", "pretty")) {
  const glue = (root = document) => root.querySelectorAll?.("p, li, dd, .note, .hint").forEach((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let last = null, n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim()) last = n;
    if (last && /\S \S+\s*$/.test(last.nodeValue)) last.nodeValue = last.nodeValue.replace(/ (\S+\s*)$/, "\u00a0$1");
  });
  glue(); addEventListener("load", () => glue()); setTimeout(() => glue(), 2000); // (and once more after the page fills in its text)
}
