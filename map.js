// Interactive Cave Hill campus map — Leaflet + a static GeoJSON of building footprints.

const map = L.map("campus-map", {
  scrollWheelZoom: true,
});

// ---- Basemaps: satellite imagery by default, with a control to switch ----
const imagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 20,
    attribution:
      "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }
);

const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
});

imagery.addTo(map);

L.control
  .layers(
    {
      "Satellite": imagery,
      "Streets": streets,
    },
    {},
    { collapsed: true, position: "topright" }
  )
  .addTo(map);

// ---- Shuttle routes: radio-style control, only one route visible at a time ----
// Each route = a main line (solid) + optional variant lines (dashed) that belong to it.
// "Field" values must match the names in uwishuttleroutes.json exactly.
const SHUTTLE_ROUTES = [
  {
    label: "Bridgetown to Campus",
    color: "#00e5ff", // vivid cyan
    main: "Bridgetown to Campus",
    variants: [],
  },
  {
    label: "Campus to Bridgetown",
    color: "#ff2bd6", // hot magenta
    main: "Campus to Bridgetown",
    variants: ["Campus to Bridgetown B"],
  },
  {
    label: "Warrens",
    color: "#ffe600", // bright yellow
    main: "Warrens",
    variants: ["Warrens B", "Warrens C", "Warrens D"],
  },
  {
    label: "NCF",
    color: "#76ff03", // electric lime
    main: "NCF",
    variants: [],
  },
];

const NO_SHUTTLE_LABEL = "No shuttle route";
const shuttleChoices = { [NO_SHUTTLE_LABEL]: L.layerGroup() };
shuttleChoices[NO_SHUTTLE_LABEL].addTo(map); // default: nothing shown

const shuttleControl = L.control
  .layers(shuttleChoices, {}, { collapsed: true, position: "topright" })
  .addTo(map);

// Give the shuttle control its own icon/title so it's distinguishable from the basemap control
shuttleControl.getContainer().classList.add("shuttle-control");
shuttleControl.getContainer().setAttribute("title", "Shuttle routes");

fetch("data/uwishuttleroutes.json")
  .then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  })
  .then((geojson) => {
    const byName = new Map();
    geojson.features.forEach((f) => {
      const name = f.properties && f.properties.Field;
      if (name) byName.set(name, f);
    });

    SHUTTLE_ROUTES.forEach((route) => {
      const group = L.layerGroup();

      const addLine = (name, isVariant) => {
        const feature = byName.get(name);
        if (!feature) {
          console.warn(`Shuttle route "${name}" not found in uwishuttleroutes.json`);
          return;
        }
        L.geoJSON(feature, {
          style: {
            color: route.color,
            weight: isVariant ? 5 : 6,
            opacity: 0.95,
            dashArray: isVariant ? "3 10" : null,
            lineCap: isVariant ? "round" : "round",
          },
          onEachFeature: (_f, lyr) => lyr.bindTooltip(name, { sticky: true }),
          interactive: true,
        }).addTo(group);
      };

      // Main first, variants on top so the dashes remain visible
      addLine(route.main, false);
      route.variants.forEach((v) => addLine(v, true));

      shuttleControl.addBaseLayer(group, route.label);
    });
  })
  .catch((err) => console.warn("Couldn't load shuttle routes:", err.message));

const BUILDING_STYLE = {
  color: "#ff1f3d",
  weight: 2,
  fillColor: "#ff1f3d",
  fillOpacity: 0.5,
};
const BUILDING_STYLE_HOVER = { ...BUILDING_STYLE, fillOpacity: 0.8, weight: 3 };

// ---- Search UI elements ----
const searchInput = document.getElementById("map-search-input");
const searchResults = document.getElementById("map-search-results");

// name -> array of Leaflet layers (some buildings are split into multiple polygons)
const buildingIndex = new Map();
let buildingNamesSorted = [];

fetch("data/campus-map.geojson")
  .then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  })
  .then((geojson) => {
    const layer = L.geoJSON(geojson, {
      style: BUILDING_STYLE,
      onEachFeature: (feature, featureLayer) => {
        const name = (feature.properties && feature.properties.name) || "Unnamed building";
        featureLayer.bindPopup(name);

        featureLayer.on("mouseover", () => featureLayer.setStyle(BUILDING_STYLE_HOVER));
        featureLayer.on("mouseout", () => featureLayer.setStyle(BUILDING_STYLE));
        featureLayer.on("click", () => selectBuilding(name));

        if (!buildingIndex.has(name)) buildingIndex.set(name, []);
        buildingIndex.get(name).push(featureLayer);
      },
    }).addTo(map);

    buildingNamesSorted = [...buildingIndex.keys()].sort((a, b) => a.localeCompare(b));
    map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  })
  .catch((err) => {
    const el = document.getElementById("campus-map");
    el.innerHTML = `<p style="padding:40px;text-align:center;color:#5c6a7a;">Couldn't load the campus map. ${err.message}</p>`;
  });

// Zoom/pan to a building (or group of polygons sharing a name) and pop its label open.
function selectBuilding(name) {
  const layers = buildingIndex.get(name);
  if (!layers || !layers.length) return;

  const group = L.featureGroup(layers);
  map.fitBounds(group.getBounds(), { padding: [80, 80], maxZoom: 19 });
  layers[0].openPopup();

  searchResults.hidden = true;
  searchInput.value = "";
}

function renderResults(names) {
  if (!names.length) {
    searchResults.innerHTML = `<p class="map-search__empty">No buildings match.</p>`;
    searchResults.hidden = false;
    return;
  }

  searchResults.innerHTML = names
    .map((name) => {
      const partCount = buildingIndex.get(name).length;
      return `
        <button data-name="${escapeHtml(name)}">
          <span>${escapeHtml(name)}</span>
          ${partCount > 1 ? `<span class="building-parts">${partCount} sections</span>` : ""}
        </button>`;
    })
    .join("");

  searchResults.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => selectBuilding(btn.dataset.name));
  });

  searchResults.hidden = false;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Type to filter; focus with an empty box to browse the full alphabetical list.
searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  const names = q
    ? buildingNamesSorted.filter((name) => name.toLowerCase().includes(q))
    : buildingNamesSorted;
  renderResults(names);
});

searchInput.addEventListener("focus", () => {
  if (!buildingNamesSorted.length) return;
  const q = searchInput.value.trim().toLowerCase();
  const names = q
    ? buildingNamesSorted.filter((name) => name.toLowerCase().includes(q))
    : buildingNamesSorted;
  renderResults(names);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#map-search")) {
    searchResults.hidden = true;
  }
});