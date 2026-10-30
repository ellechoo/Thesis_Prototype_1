// headings.js — every heading on the site is set in Fraunces, one letter at a time: each letter gets its own softness,
// "wonk", optical size and weight, and now and then an italic. The mix is worked out from the heading's own words, so
// the same heading (or the same person's name) always starts out looking the same. Then, every STEP_MS, one letter in
// each visible heading changes to a new mix, so the headings shimmer gently. Capitals and sizes come from style.css.
// Headings that change later (a name filled in, an ID card opened) are picked up automatically.
// Screen readers get the plain text; people who ask for reduced motion get still letters.
// Headings on an ID card behave differently: when the card appears, their letters scramble for a moment, then settle
// one by one into a new random mix and stay put (no shimmer), so a downloaded card keeps the letters it settled on.
// While that's happening the heading carries data-settling (the download waits for it to go).
// A heading marked data-steady-width (the Join page's headline, which the speech bubble wraps around) is held at the
// width of its widest possible mix, so the letters changing never resize what's around it.
const SELECTOR = "h1, h2, .section-title, .review-title, .processing-title, .id-brand, .countdown > span"; // (also the Record page's 3, 2, 1, Go!)
const STEP_MS = 150;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

function rng(seed) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
// one letter's look
const letterStyle = (r) => `font-weight:${Math.round(320 + r() * 380)};font-style:${r() < 0.25 ? "italic" : "normal"};font-variation-settings:'SOFT' ${Math.round(r() * 100)},'WONK' ${r() < 0.5 ? 1 : 0},'opsz' ${Math.round(24 + r() * 120)}`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const mixed = new Set(), visible = new Set();
const seen = new IntersectionObserver((entries) => { for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target); });

function mix(el) {
  if (el.classList.contains("visually-hidden")) return;
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  const r = rng(text);
  // the plain words for screen readers, then the letters (hidden from them), each word kept together on its line
  el.innerHTML = `<span class="mx-sr">${esc(text)}</span><span class="mx" aria-hidden="true">${text.split(" ").map((w) =>
    `<span class="mx-w">${[...w].map((ch) => `<span class="mx-l" style="${letterStyle(r)}">${esc(ch)}</span>`).join("")}</span>`).join(" ")}</span>`;
  el.dataset.mixFull = el.textContent; // (if anything else changes the text later, it no longer matches, and it's mixed again)
  el._letters = [...el.querySelectorAll(".mx-l")];
  if (!mixed.has(el)) { mixed.add(el); seen.observe(el); }
  if (el.hasAttribute("data-steady-width")) holdWidth(el);
  if (el.hasAttribute("data-steady-words")) { holdWords(el); watchWidth(el); }
  el._settle = !!el.closest(".id-card");
  if (el._settle && !still) settle(el);
}
// ID cards: scramble (about 1.2 s), then each letter settles, left to right, into its final random look; then still
const SETTLE_TICK = 70, SCRAMBLE_TICKS = 17, SETTLE_TICKS = 12;
function settle(el) {
  clearInterval(el._settleTimer);
  const ls = el._letters, final = ls.map(() => letterStyle(Math.random));
  let tick = 0;
  el.setAttribute("data-settling", "");
  el._settleTimer = setInterval(() => {
    tick++;
    let left = 0;
    ls.forEach((l, i) => {
      const at = SCRAMBLE_TICKS + Math.round(i * (SETTLE_TICKS / Math.max(1, ls.length)));
      if (tick < at) { left++; if (Math.random() < 0.6) l.style.cssText = letterStyle(Math.random); }
      else l.style.cssText = final[i];
    });
    if (!left || !el.isConnected) { clearInterval(el._settleTimer); el.removeAttribute("data-settling"); }
  }, SETTLE_TICK);
}
// every letter at its widest (boldest, upright, smallest optical size), measured, then back to its own mix
const WIDEST = "font-weight:700;font-style:normal;font-variation-settings:'SOFT' 0,'WONK' 0,'opsz' 9";
function holdWidth(el) {
  const ls = el._letters, keep = ls.map((l) => l.style.cssText), inner = el.querySelector(".mx");
  el.style.minWidth = "";
  ls.forEach((l) => (l.style.cssText = WIDEST));
  const w = inner.getBoundingClientRect().width;
  ls.forEach((l, i) => (l.style.cssText = keep[i]));
  if (w) { el.style.minWidth = Math.ceil(w + 2) + "px"; el.style.width = el.style.minWidth; }
}
// A heading marked data-steady-words (the Voiceprint page's name) decides its line breaks as if every letter were at its
// widest possible mix, then fixes them with explicit breaks: a word near the right edge moves down to the next line
// and stays there, instead of jumping back and forth as its letters change. The words themselves keep their natural
// width, so words sharing a line keep the normal space between them.
// (and again whenever the heading's width changes: it may not be laid out yet when its text first arrives)
const widthSeen = new WeakMap(), widthWatch = new ResizeObserver((entries) => {
  for (const e of entries) { const w = Math.round(e.contentRect.width); if (w && w !== widthSeen.get(e.target)) { widthSeen.set(e.target, w); holdWords(e.target); } }
});
function watchWidth(el) { if (!widthSeen.has(el)) { widthSeen.set(el, 0); widthWatch.observe(el); } }
// the widest a letter can get in any mix the shimmer can give it (every combination of the extremes, measured once per
// letter and size)
const LETTER_W = new Map(), EXTREMES = [];
for (const wt of [320, 700]) for (const it of ["normal", "italic"]) for (const soft of [0, 100]) for (const wonk of [0, 1]) for (const op of [24, 144])
  EXTREMES.push(`font-weight:${wt};font-style:${it};font-variation-settings:'SOFT' ${soft},'WONK' ${wonk},'opsz' ${op}`);
function widestLetter(l, host = l.parentElement, ch = l.textContent) {
  const key = ch + "|" + getComputedStyle(host).fontSize; if (LETTER_W.has(key)) return LETTER_W.get(key);
  const probe = document.createElement("span"); probe.textContent = ch; probe.style.display = "inline-block"; host.appendChild(probe);
  let max = 0; for (const st of EXTREMES) { probe.style.cssText = st + ";display:inline-block"; max = Math.max(max, probe.getBoundingClientRect().width); }
  probe.remove(); LETTER_W.set(key, max); return max;
}
function holdWords(el) {
  const inner = el.querySelector(".mx"); if (!inner) return;
  inner.querySelectorAll("br.mx-br").forEach((b) => b.remove());
  const words = [...inner.querySelectorAll(".mx-w")]; if (words.length < 2) return;
  const cs = getComputedStyle(el), avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (!(avail > 0)) return;
  const widest = words.map((w) => [...w.querySelectorAll(".mx-l")].reduce((sum, l) => sum + widestLetter(l), 0));
  const space = widestLetter(null, inner, "\u00a0");
  let line = 0;
  words.forEach((w, i) => {
    const need = (line ? space : 0) + widest[i];
    if (line && line + need > avail) { const br = document.createElement("br"); br.className = "mx-br"; w.before(br); line = widest[i]; }
    else line += need;
  });
}
addEventListener("resize", () => { for (const el of mixed) { if (el.hasAttribute("data-steady-width")) holdWidth(el); if (el.hasAttribute("data-steady-words")) holdWords(el); } });
document.fonts?.ready.then(() => { for (const el of mixed) { if (el.hasAttribute("data-steady-width")) holdWidth(el); if (el.hasAttribute("data-steady-words")) holdWords(el); } }); // (once the font has loaded)
function scan(root = document) {
  const list = root.nodeType === 1 && root.matches?.(SELECTOR) ? [root] : [];
  for (const el of [...list, ...(root.querySelectorAll?.(SELECTOR) || [])]) if (el.dataset.mixFull !== el.textContent) mix(el);
}

scan();
// headings added or rewritten later
new MutationObserver((records) => {
  const touched = new Set();
  for (const rec of records) {
    let n = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
    const h = n?.closest?.(SELECTOR); if (h) touched.add(h);
    for (const a of rec.addedNodes) if (a.nodeType === 1) touched.add(a);
  }
  for (const n of touched) if (n.isConnected) scan(n);
  for (const el of mixed) if (!el.isConnected) { mixed.delete(el); visible.delete(el); seen.unobserve(el); }
}).observe(document.body, { childList: true, subtree: true, characterData: true });

// the shimmer: one letter per visible heading, every STEP_MS (paused while the tab is hidden)
if (!still) setInterval(() => {
  if (document.hidden) return;
  for (const el of visible) {
    const ls = el._letters; if (!ls?.length || el._settle) continue; // (ID card headings settle once and stay)
    ls[Math.floor(Math.random() * ls.length)].style.cssText = letterStyle(Math.random);
  }
}, STEP_MS);
