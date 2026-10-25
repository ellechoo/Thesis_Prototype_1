// archive.js — every saved recording, newest first, shown by its voice portrait (the gallery).
// Clicking a portrait opens that person's voice ID card (archive.html?id=…), still on the Archive
// page; the card links on to the full portrait and breakdown. The card's X, Esc, or the Archive tab
// go back to the gallery.
// In the shared archive the list arrives without the detailed frames (to stay quick), so each card
// loads its own data when it scrolls into view, then draws its portrait.
import { listTakes, getTake, deleteLocalTake, archiveIsShared } from "./store.js";
import { formatDate, pct } from "./shared.js?v=2";
import { snapshot } from "./orb-snapshot.js?v=28";
import { renderIdCard } from "./id-card.js?v=33";

const $ = (id) => document.getElementById(id);
let takes = [];
// Coming back from an ID card (X, Esc, the Archive tab or the browser's back button) returns to the
// same spot in the gallery: the scroll position is remembered when a portrait is clicked.
const SPOT = "archiveSpot";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
const remember = (id) => { try { sessionStorage.setItem(SPOT, JSON.stringify({ y: window.scrollY, id })); } catch {} };
function restoreSpot() {
  let spot = null;
  try { spot = JSON.parse(sessionStorage.getItem(SPOT) || "null"); sessionStorage.removeItem(SPOT); } catch {}
  if (!spot) return;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (spot.y <= max + 1) window.scrollTo(0, spot.y);
    else document.querySelector(`.voice-card[data-id="${CSS.escape(spot.id || "")}"]`)?.scrollIntoView({ block: "center" });
  });
}


async function load() {
  const id = new URLSearchParams(location.search).get("id");
  if (id) return showCard(id);
  try { takes = await listTakes(); }
  catch (e) { $("status").textContent = `Couldn't open saved recordings in this browser: ${e.message}`; $("status").classList.add("error"); return; }
  render();
  restoreSpot();
}

function render() {
  const grid = $("grid");
  grid.innerHTML = "";
  $("empty").hidden = takes.length > 0;
  takes.forEach((t, n) => {
    const q = `?id=${encodeURIComponent(t.id)}`;
    const card = document.createElement("article");
    card.className = "voice-card";
    card.dataset.id = t.id;
    card.innerHTML = `
      <a class="voice-thumb" href="archive.html${q}" aria-label=""><span class="thumb-loading">Growing portrait…</span></a>
      <div class="voice-info">
        <h2 class="voice-name"></h2>
        <p class="voice-date"></p>
        <p class="voice-stats"></p>
        <div class="card-links">
          <button class="link-button delete" hidden>Delete</button>
        </div>
      </div>`;
    card.querySelector(".voice-thumb").setAttribute("aria-label", `Open ${t.name}'s voice ID card`);
    card.querySelector(".voice-thumb").addEventListener("click", () => remember(t.id));
    card.querySelector(".voice-name").textContent = t.name;
    card.querySelector(".voice-date").textContent = `${formatDate(t.createdAt)} · ${t.seconds.toFixed(1)} s`;
    const stats = [
      t.summary?.pitchHz ? `${t.summary.pitchHz} Hz · ${t.summary.note}` : null,
      t.rhythm?.speechRate != null ? `${t.rhythm.speechRate.toFixed(1)} syll/s` : null,
      t.accent ? `${t.accent.top.name} ${pct(t.accent.top.score)}` : null,
    ].filter(Boolean);
    card.querySelector(".voice-stats").textContent = stats.join(" · ");
    const del = card.querySelector(".delete");
    del.hidden = archiveIsShared; // the shared archive is managed from the Supabase dashboard
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${t.name}'s recording? This can't be undone.`)) return;
      await deleteLocalTake(t.id);
      takes = takes.filter((x) => x.id !== t.id);
      render();
    });
    card._take = t;
    card._n = n;
    grid.appendChild(card);
    watcher.observe(card);
  });
}

// draw each portrait when its card comes into view (loading its full data first if needed)
const watcher = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    watcher.unobserve(e.target);
    drawCard(e.target);
  }
}, { rootMargin: "300px" });

async function drawCard(card) {
  const thumb = card.querySelector(".voice-thumb");
  try {
    let t = card._take;
    if (!t.frames) t = card._take = { ...t, ...(await getTake(t.id)) };
    const { url } = snapshot(t);
    thumb.innerHTML = `<img src="${url}" alt="" draggable="false" />`;
  } catch (err) {
    thumb.innerHTML = `<span class="thumb-loading">Couldn't draw this portrait.</span>`;
  }
}

// ---------- one person's ID card ----------
async function showCard(id) {
  document.body.classList.add("showing-id");
  $("grid").hidden = true;
  const view = $("idView");
  view.hidden = false;
  view.innerHTML = `<p class="note id-loading">Opening the ID card…</p>`;
  let take = null;
  try { take = await getTake(id); } catch (e) { view.innerHTML = `<p class="status error">Couldn't open this voice: ${e.message}</p>`; return; }
  if (!take) { view.innerHTML = `<p class="status">That voice isn't in the archive any more. <a href="archive.html">Back to the archive</a></p>`; return; }
  document.title = `${take.name} · Voice ID · Voiceprint`;
  renderIdCard(view, take);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") location.href = "archive.html"; });
}

load();
