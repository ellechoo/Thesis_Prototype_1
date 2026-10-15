// archive.js — every saved recording, newest first. Each card links to its breakdown.
import { listTakes, deleteLocalTake, archiveIsShared } from "./store.js";
import { drawPitchTrace, formatDate, pct } from "./shared.js";

const $ = (id) => document.getElementById(id);
let takes = [];

$("where").textContent = archiveIsShared
  ? "Voices from everyone who has used this site, as data. The recordings themselves are never kept."
  : "Recordings are saved in this browser, on this device.";

async function load() {
  try { takes = await listTakes(); }
  catch (e) { $("status").textContent = `Couldn't open saved recordings in this browser: ${e.message}`; $("status").classList.add("error"); return; }
  render();
}

function render() {
  const grid = $("grid");
  grid.innerHTML = "";
  $("empty").hidden = takes.length > 0;
  $("count").textContent = takes.length ? `${takes.length} voice${takes.length === 1 ? "" : "s"} so far.` : "Every voice recorded so far.";
  for (const t of takes) {
    const card = document.createElement("article");
    card.className = "voice-card";
    card.innerHTML = `
      <a class="voice-link" href="breakdown.html?id=${encodeURIComponent(t.id)}">
        <canvas class="mini-trace"></canvas>
        <h2 class="voice-name"></h2>
        <p class="note voice-date"></p>
        <dl class="voice-stats">
          <div><dt>Pitch</dt><dd class="s-pitch"></dd></div>
          <div><dt>Pace</dt><dd class="s-rate"></dd></div>
          <div><dt>Accent</dt><dd class="s-accent"></dd></div>
        </dl>
      </a>
      <button class="link-button delete" hidden>Delete</button>`;
    card.querySelector(".voice-name").textContent = t.name;
    card.querySelector(".voice-date").textContent = `${formatDate(t.createdAt)} · ${t.seconds.toFixed(1)} s`;
    card.querySelector(".s-pitch").textContent = t.summary?.pitchHz ? `${t.summary.pitchHz} Hz · ${t.summary.note}` : "–";
    card.querySelector(".s-rate").textContent = t.rhythm?.speechRate != null ? `${t.rhythm.speechRate.toFixed(1)} syll/s` : "–";
    card.querySelector(".s-accent").textContent = t.accent ? `${t.accent.top.name} (${pct(t.accent.top.score)})` : "–";
    const del = card.querySelector(".delete");
    del.hidden = archiveIsShared; // the shared archive is managed from the Supabase dashboard
    del.addEventListener("click", async () => {
      if (!confirm(`Delete ${t.name}'s recording? This can't be undone.`)) return;
      await deleteLocalTake(t.id);
      takes = takes.filter((x) => x.id !== t.id);
      render();
    });
    grid.appendChild(card);
    const line = (t.preview || []).map(([time, pitch]) => ({ t: time, pitch }));
    card._trace = () => drawPitchTrace(card.querySelector(".mini-trace"), line, { pauses: t.rhythm?.pauses ?? [], grid: false, lineWidth: 1.5 });
  }
  drawAll();
}

function drawAll() { document.querySelectorAll(".voice-card").forEach((c) => c._trace?.()); }
window.addEventListener("resize", drawAll);

load();
