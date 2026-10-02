// ===================================================================
// Room Availability — reads the static JSON produced by
// build_room_data.py (data/rooms.json, schedule.json, meta.json)
// and shows live free/occupied status + a weekly timetable per room.
// ===================================================================

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MINUTES = 1440;
const TIMETABLE_WINDOW = { start: 420, end: 1320 }; // 7:00am–10:00pm display window

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------

const dataFreshness = document.getElementById("data-freshness");
const daySelect = document.getElementById("day-select");
const timeSelect = document.getElementById("time-select");
const nowBtn = document.getElementById("now-btn");
const buildingSelect = document.getElementById("building-select");
const roomFilter = document.getElementById("room-filter");
const freeOnlyCheckbox = document.getElementById("free-only");
const resultsSummary = document.getElementById("results-summary");
const roomGrid = document.getElementById("room-grid");

const courseSearchInput = document.getElementById("course-search-input");
const courseSearchResults = document.getElementById("course-search-results");

const ttScrim = document.getElementById("tt-scrim");
const ttPanel = document.getElementById("tt-panel");
const ttClose = document.getElementById("tt-close");
const ttBuildingName = document.getElementById("tt-building-name");
const ttRoomName = document.getElementById("tt-room-name");
const timetableBody = document.getElementById("timetable-body");

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

let rooms = [];
let buildings = [];
let scheduleByKey = new Map(); // "building|room|day" -> sorted [{start_min,end_min,courses}]
let courseIndex = new Map(); // course_number -> { course, course_number, sessions: [{building,room,day,start_min,end_min}] }

// ------------------------------------------------------------------
// Time helpers (Barbados = UTC-4, fixed, no DST)
// ------------------------------------------------------------------

function getBarbadosNow() {
  const nowUtcMs = Date.now();
  const barbadosMs = nowUtcMs - 4 * 60 * 60 * 1000;
  const d = new Date(barbadosMs);
  const dayIndex = d.getUTCDay(); // 0=Sun..6=Sat, in shifted "UTC" which now represents Barbados time
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = dayNames[dayIndex];
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { day, minutes };
}

function minutesToLabel(mins) {
  const clamped = ((mins % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  let h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const meridiem = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${meridiem}`;
}

function timeInputToMinutes(value) {
  // value like "14:05"
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTimeInput(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------

async function loadData() {
  try {
    const [roomsRes, buildingsRes, scheduleRes, metaRes] = await Promise.all([
      fetch("data/rooms.json"),
      fetch("data/buildings.json"),
      fetch("data/schedule.json"),
      fetch("data/meta.json"),
    ]);

    if (!roomsRes.ok || !buildingsRes.ok || !scheduleRes.ok) {
      throw new Error("One or more data files failed to load.");
    }

    rooms = await roomsRes.json();
    buildings = await buildingsRes.json();
    const schedule = await scheduleRes.json();
    const meta = metaRes.ok ? await metaRes.json() : null;

    scheduleByKey = new Map();
    for (const block of schedule) {
      const key = `${block.building}|${block.room}|${block.day}`;
      if (!scheduleByKey.has(key)) scheduleByKey.set(key, []);
      scheduleByKey.get(key).push(block);
    }
    for (const list of scheduleByKey.values()) {
      list.sort((a, b) => a.start_min - b.start_min);
    }

    courseIndex = buildCourseIndex(schedule);

    populateControls();

    if (meta && meta.generated_at) {
      const generated = new Date(meta.generated_at);
      dataFreshness.textContent = `Availability data last updated ${generated.toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })} · ${rooms.length} rooms across ${buildings.length} buildings.`;
    } else {
      dataFreshness.textContent = `${rooms.length} rooms across ${buildings.length} buildings.`;
    }

    setToCurrentTime();
    render();
  } catch (err) {
    dataFreshness.textContent = "Couldn't load availability data.";
    roomGrid.innerHTML = `<p class="avail-error">${escapeHtml(err.message)}</p>`;
  }
}

function populateControls() {
  daySelect.innerHTML = DAYS.map((d) => `<option value="${d}">${d}</option>`).join("");

  buildingSelect.innerHTML =
    `<option value="">All buildings</option>` +
    buildings.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
}

function setToCurrentTime() {
  const { day, minutes } = getBarbadosNow();
  daySelect.value = DAYS.includes(day) ? day : DAYS[0];
  timeSelect.value = minutesToTimeInput(minutes);
}

// ------------------------------------------------------------------
// Status lookup
// ------------------------------------------------------------------

function getStatus(building, room, day, minutes) {
  const blocks = scheduleByKey.get(`${building}|${room}|${day}`) || [];

  for (const block of blocks) {
    if (minutes >= block.start_min && minutes < block.end_min) {
      return { occupied: true, until: block.end_min, courses: block.courses };
    }
  }

  // free — find when the next block starts (if any) to report "free until"
  const nextBlock = blocks.find((b) => b.start_min > minutes);
  return { occupied: false, until: nextBlock ? nextBlock.start_min : DAY_MINUTES };
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------

function render() {
  const day = daySelect.value;
  const minutes = timeSelect.value ? timeInputToMinutes(timeSelect.value) : 0;
  const buildingFilter = buildingSelect.value;
  const roomQuery = roomFilter.value.trim().toUpperCase();
  const freeOnly = freeOnlyCheckbox.checked;

  let visibleRooms = rooms.filter((r) => {
    if (buildingFilter && r.building !== buildingFilter) return false;
    if (roomQuery && !r.room.includes(roomQuery)) return false;
    return true;
  });

  const withStatus = visibleRooms.map((r) => ({
    ...r,
    status: getStatus(r.building, r.room, day, minutes),
  }));

  const finalRooms = freeOnly ? withStatus.filter((r) => !r.status.occupied) : withStatus;

  const freeCount = withStatus.filter((r) => !r.status.occupied).length;
  resultsSummary.textContent = `${day} at ${minutesToLabel(minutes)} — ${freeCount} of ${withStatus.length} rooms free${
    buildingFilter ? ` in ${buildingFilter}` : ""
  }.`;

  if (!finalRooms.length) {
    roomGrid.innerHTML = `<p class="avail-empty">No rooms match your filters.</p>`;
    return;
  }

  // group by building for readability
  const grouped = new Map();
  for (const r of finalRooms) {
    if (!grouped.has(r.building)) grouped.set(r.building, []);
    grouped.get(r.building).push(r);
  }

  const sortedBuildings = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  roomGrid.innerHTML = sortedBuildings
    .map((building) => {
      const roomCards = grouped
        .get(building)
        .sort((a, b) => a.room.localeCompare(b.room))
        .map((r) => renderRoomCard(r))
        .join("");
      return `
        <div class="building-group">
          <h2>${escapeHtml(building)}</h2>
          <div class="building-group__rooms">${roomCards}</div>
        </div>`;
    })
    .join("");

  roomGrid.querySelectorAll(".room-card").forEach((card) => {
    card.addEventListener("click", () =>
      openTimetable(card.dataset.building, card.dataset.room)
    );
  });
}

function renderRoomCard(r) {
  const { occupied, until, courses } = r.status;
  const statusClass = occupied ? "room-card__status--occupied" : "room-card__status--free";
  const statusLabel = occupied ? "Occupied" : "Free";
  const detail = occupied
    ? `Until ${minutesToLabel(until)}`
    : until < DAY_MINUTES
      ? `Free until ${minutesToLabel(until)}`
      : `Free for the rest of the day`;
  const courseLine =
    occupied && courses && courses.length
      ? `<p class="room-card__course">${escapeHtml(courses.map((c) => c.course).join(", "))}</p>`
      : "";

  return `
    <button class="room-card" data-building="${escapeHtml(r.building)}" data-room="${escapeHtml(r.room)}">
      <div class="room-card__top">
        <span class="room-card__name">${escapeHtml(r.room)}</span>
        <span class="room-card__status ${statusClass}">${statusLabel}</span>
      </div>
      <p class="room-card__detail">${detail}</p>
      ${courseLine}
    </button>`;
}

// ------------------------------------------------------------------
// Course search (autocomplete, grouped by course with nested sessions)
// ------------------------------------------------------------------

function buildCourseIndex(schedule) {
  const index = new Map();

  for (const block of schedule) {
    for (const c of block.courses || []) {
      const key = c.course_number || c.course;
      if (!index.has(key)) {
        index.set(key, { course: c.course, course_number: c.course_number, sessions: [] });
      }
      index.get(key).sessions.push({
        building: block.building,
        room: block.room,
        day: block.day,
        start_min: block.start_min,
        end_min: block.end_min,
      });
    }
  }

  for (const entry of index.values()) {
    entry.sessions.sort(
      (a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start_min - b.start_min
    );
  }

  return index;
}

function searchCourses(query, limit = 15) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches = [];
  for (const entry of courseIndex.values()) {
    const nameMatch = entry.course && entry.course.toLowerCase().includes(q);
    const numberMatch = entry.course_number && String(entry.course_number).toLowerCase().includes(q);
    if (nameMatch || numberMatch) matches.push(entry);
  }

  matches.sort((a, b) => a.course.localeCompare(b.course));
  return matches.slice(0, limit);
}

let courseSearchTimer = null;

courseSearchInput.addEventListener("input", () => {
  const q = courseSearchInput.value;
  clearTimeout(courseSearchTimer);

  if (!q.trim()) {
    courseSearchResults.hidden = true;
    courseSearchResults.innerHTML = "";
    return;
  }

  courseSearchTimer = setTimeout(() => renderCourseResults(searchCourses(q), q), 180);
});

courseSearchInput.addEventListener("focus", () => {
  if (courseSearchInput.value.trim() && courseSearchResults.innerHTML) {
    courseSearchResults.hidden = false;
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".course-search")) {
    courseSearchResults.hidden = true;
  }
});

function renderCourseResults(matches, query) {
  courseSearchResults.hidden = false;

  if (!matches.length) {
    courseSearchResults.innerHTML = `<p class="course-search-results__empty">No courses match "${escapeHtml(
      query.trim()
    )}".</p>`;
    return;
  }

  courseSearchResults.innerHTML = matches
    .map((entry) => {
      const sessions = entry.sessions
        .map(
          (s) => `
          <button class="course-session-btn" data-building="${escapeHtml(s.building)}" data-room="${escapeHtml(
            s.room
          )}">
            <span class="course-session-btn__where">${escapeHtml(s.day)} · ${escapeHtml(s.room)}, ${escapeHtml(
            s.building
          )}</span>
            <span class="course-session-btn__when">${minutesToLabel(s.start_min)}–${minutesToLabel(s.end_min)}</span>
          </button>`
        )
        .join("");

      return `
        <div class="course-result">
          <div class="course-result__head">
            <span class="course-result__name">${escapeHtml(entry.course)}</span>
            <span class="course-result__number">${escapeHtml(entry.course_number || "")}</span>
          </div>
          <div class="course-result__sessions">${sessions}</div>
        </div>`;
    })
    .join("");

  courseSearchResults.querySelectorAll(".course-session-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      courseSearchResults.hidden = true;
      openTimetable(btn.dataset.building, btn.dataset.room);
    });
  });
}

// ------------------------------------------------------------------
// Weekly timetable panel
// ------------------------------------------------------------------

function openTimetable(building, room) {
  ttBuildingName.textContent = building;
  ttRoomName.textContent = room;

  const { day: nowDay, minutes: nowMinutes } = getBarbadosNow();

  const rows = DAYS.map((day) => {
    const blocks = scheduleByKey.get(`${building}|${room}|${day}`) || [];
    const windowSpan = TIMETABLE_WINDOW.end - TIMETABLE_WINDOW.start;

    const blockEls = blocks
      .map((b) => {
        const start = Math.max(b.start_min, TIMETABLE_WINDOW.start);
        const end = Math.min(b.end_min, TIMETABLE_WINDOW.end);
        if (end <= start) return "";
        const left = ((start - TIMETABLE_WINDOW.start) / windowSpan) * 100;
        const width = ((end - start) / windowSpan) * 100;
        const title = b.courses.map((c) => `${c.course} (${c.course_number})`).join(", ");
        return `<div class="timetable__block" title="${escapeHtml(title)}" style="left:${left}%;width:${width}%;"></div>`;
      })
      .join("");

    const nowMarker =
      day === nowDay && nowMinutes >= TIMETABLE_WINDOW.start && nowMinutes <= TIMETABLE_WINDOW.end
        ? `<div class="timetable__now-marker" style="left:${
            ((nowMinutes - TIMETABLE_WINDOW.start) / windowSpan) * 100
          }%;" title="Now"></div>`
        : "";

    return `
      <div class="timetable__day">
        <div class="timetable__day-label">${day}</div>
        <div class="timetable__track">${blockEls}${nowMarker}</div>
      </div>`;
  }).join("");

  timetableBody.innerHTML = `
    <div class="timetable__legend"><span class="swatch"></span> Occupied &nbsp;·&nbsp; unshaded = free (7:00 AM–10:00 PM shown)</div>
    ${rows}
    <div class="timetable__scale">
      <span>7:00 AM</span><span>10:00 AM</span><span>1:00 PM</span><span>4:00 PM</span><span>7:00 PM</span><span>10:00 PM</span>
    </div>`;

  openPanel();
}

function openPanel() {
  ttPanel.classList.add("is-open");
  ttPanel.setAttribute("aria-hidden", "false");
  ttScrim.hidden = false;
}

function closePanel() {
  ttPanel.classList.remove("is-open");
  ttPanel.setAttribute("aria-hidden", "true");
  ttScrim.hidden = true;
}

ttClose.addEventListener("click", closePanel);
ttScrim.addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

// ------------------------------------------------------------------
// Events
// ------------------------------------------------------------------

daySelect.addEventListener("change", render);
timeSelect.addEventListener("change", render);
buildingSelect.addEventListener("change", render);
roomFilter.addEventListener("input", render);
freeOnlyCheckbox.addEventListener("change", render);
nowBtn.addEventListener("click", () => {
  setToCurrentTime();
  render();
});

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

loadData();