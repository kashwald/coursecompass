// ===================================================================
// Cave Hill Room Locator — frontend logic
// Talks to Cloudflare Pages Functions (functions/api/*.js), which in
// turn talk to Supabase. See README.md for setup.
// ===================================================================

const API = {
  buildings: "/api/get-buildings",
  rooms: (buildingId) => `/api/get-rooms?buildingId=${encodeURIComponent(buildingId)}`,
  search: (q) => `/api/get-room?q=${encodeURIComponent(q)}`,
};

const grid = document.getElementById("building-grid");
const panel = document.getElementById("room-panel");
const scrim = document.getElementById("panel-scrim");
const panelClose = document.getElementById("panel-close");
const panelBuildingName = document.getElementById("panel-building-name");
const panelTitle = document.getElementById("panel-title");
const roomList = document.getElementById("room-list");
const roomVideo = document.getElementById("room-video");
const roomVideoIframe = document.getElementById("room-video-iframe");

const searchInput = document.getElementById("room-search-input");
const searchResults = document.getElementById("search-results");

// ------------------------------------------------------------------
// Buildings grid
// ------------------------------------------------------------------

async function loadBuildings() {
  renderBuildingSkeletons(8);

  try {
    const res = await fetch(API.buildings);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const { buildings } = await res.json();
    renderBuildings(buildings);
  } catch (err) {
    grid.innerHTML = `<p class="room-list__error">Couldn't load buildings right now. ${escapeHtml(err.message)}</p>`;
  }
}

function renderBuildingSkeletons(count) {
  grid.innerHTML = Array.from({ length: count })
    .map(() => `<div class="building-card building-card__skeleton" aria-hidden="true"></div>`)
    .join("");
}

function renderBuildings(buildings) {
  if (!buildings.length) {
    grid.innerHTML = `<p class="room-list__empty">No buildings have been added yet.</p>`;
    return;
  }

  grid.innerHTML = buildings
    .map(
      (b) => `
      <button class="building-card" data-building-id="${b.id}" data-building-name="${escapeHtml(b.short_name)}">
        <img src="images/${b.image_path}" alt="" loading="lazy" />
        <span class="building-card__count">${b.room_count} room${b.room_count === 1 ? "" : "s"}</span>
        <span class="building-card__body">
          <h3>${escapeHtml(b.name)}</h3>
          <span class="building-card__cta">View rooms →</span>
        </span>
      </button>`
    )
    .join("");

  grid.querySelectorAll(".building-card").forEach((card) => {
    card.addEventListener("click", () => openBuildingPanel(card.dataset.buildingId, card.dataset.buildingName));
  });
}

// ------------------------------------------------------------------
// Room panel (per building)
// ------------------------------------------------------------------

async function openBuildingPanel(buildingId, buildingName, highlightRoomName) {
  openPanel();
  panelBuildingName.textContent = buildingName || "Building";
  panelTitle.textContent = "Rooms";
  roomList.innerHTML = `<li class="room-list__loading">Loading rooms…</li>`;
  hideVideo();

  try {
    const res = await fetch(API.rooms(buildingId));
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const { building, rooms } = await res.json();

    panelBuildingName.textContent = building.short_name;
    panelTitle.textContent = `${rooms.length} room${rooms.length === 1 ? "" : "s"}`;
    renderRoomList(rooms, highlightRoomName);
  } catch (err) {
    roomList.innerHTML = `<li class="room-list__error">Couldn't load rooms. ${escapeHtml(err.message)}</li>`;
  }
}

function renderRoomList(rooms, highlightRoomName) {
  if (!rooms.length) {
    roomList.innerHTML = `<li class="room-list__empty">No rooms listed for this building yet.</li>`;
    return;
  }

  roomList.innerHTML = rooms
    .map((r) => {
      const isMatch = highlightRoomName && r.room_name.toLowerCase() === highlightRoomName.toLowerCase();
      return `
      <li data-room-name="${escapeHtml(r.room_name)}" class="${isMatch ? "is-selected" : ""}">
        <button data-video-url="${escapeHtml(r.video_url || "")}">
          <span class="room-name">${escapeHtml(r.room_name)}</span>
          ${r.video_url ? `<span class="room-play">▶ Watch</span>` : ""}
        </button>
      </li>`;
    })
    .join("");

  roomList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      roomList.querySelectorAll("li").forEach((li) => li.classList.remove("is-selected"));
      btn.closest("li").classList.add("is-selected");
      const url = btn.dataset.videoUrl;
      if (url) showVideo(url);
      else hideVideo();
    });
  });

  if (highlightRoomName) {
    const matchedLi = roomList.querySelector("li.is-selected");
    if (matchedLi) {
      matchedLi.scrollIntoView({ block: "center" });
      const matchedBtn = matchedLi.querySelector("button");
      const url = matchedBtn && matchedBtn.dataset.videoUrl;
      if (url) showVideo(url);
    }
  }
}

function showVideo(url) {
  roomVideoIframe.src = url;
  roomVideo.hidden = false;
}

function hideVideo() {
  roomVideo.hidden = true;
  roomVideoIframe.src = "";
}

function openPanel() {
  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
}

function closePanel() {
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  hideVideo();
}

panelClose.addEventListener("click", closePanel);
scrim.addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

// ------------------------------------------------------------------
// Search bar (debounced live lookup)
// ------------------------------------------------------------------

let searchTimer = null;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  clearTimeout(searchTimer);

  if (!q) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }

  searchTimer = setTimeout(() => runSearch(q), 220);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".searchbar")) {
    searchResults.hidden = true;
  }
});

async function runSearch(q) {
  try {
    const res = await fetch(API.search(q));
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const { rooms } = await res.json();
    renderSearchResults(rooms, q);
  } catch (err) {
    searchResults.hidden = false;
    searchResults.innerHTML = `<p class="searchbar__empty">Search is unavailable right now.</p>`;
  }
}

function renderSearchResults(rooms, q) {
  searchResults.hidden = false;

  if (!rooms.length) {
    searchResults.innerHTML = `<p class="searchbar__empty">No rooms match "${escapeHtml(q)}".</p>`;
    return;
  }

  searchResults.innerHTML = rooms
    .map(
      (r) => `
      <button data-building-id="${r.building_id}" data-building-name="${escapeHtml(r.buildings?.short_name || "")}" data-room-name="${escapeHtml(r.room_name)}">
        <span>
          <span class="room-code">${escapeHtml(r.room_name)}</span><br />
          <span class="room-building">${escapeHtml(r.buildings?.name || "")}</span>
        </span>
      </button>`
    )
    .join("");

  searchResults.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      searchResults.hidden = true;
      searchInput.value = "";
      openBuildingPanel(btn.dataset.buildingId, btn.dataset.buildingName, btn.dataset.roomName);
    });
  });
}

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

loadBuildings();
