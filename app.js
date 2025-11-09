// ---------- Paths ----------
const STYLE_URL = "https://demotiles.maplibre.org/style.json";
const CSV_URL   = "./data/Ghost_Bikes_with_google_coords.csv";

// ---------- Helpers ----------
function ymFromDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^\s*(\d{4})[-\/](\d{1,2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (!y || !mo) return null;
  return y * 100 + mo; // e.g. 2020-03 -> 202003
}
function ymLabel(n) { return String(n).replace(/^(\d{4})(\d{2})$/, "$1-$2"); }
function fillSelect(sel, items) {
  sel.innerHTML = items.map((lab, i) => `<option value="${i}">${lab}</option>`).join("");
}

// ---------- Grab UI ----------
const range        = document.getElementById("range");
const fromYM       = document.getElementById("fromYM");
const toYM         = document.getElementById("toYM");
const minLabel     = document.getElementById("minLabel");
const curLabel     = document.getElementById("curLabel");
const maxLabel     = document.getElementById("maxLabel");
const boroughSel   = document.getElementById("boroughSel");
const labelsToggle = document.getElementById("labelsToggle");

// 基本防御：如果 UI 元素缺失就停止
if (!range || !fromYM || !toYM || !minLabel || !curLabel || !maxLabel || !boroughSel || !labelsToggle) {
  console.error("Missing one or more UI elements in index.html");
}

// ---------- Init ----------
(async function init() {
  // 1) 加载 style.json 并创建地图
  let map;
  try {
    const styleResp = await fetch(STYLE_URL);
    if (!styleResp.ok) throw new Error(`Failed to fetch style.json: ${styleResp.status} ${styleResp.statusText}`);
    const styleObj = await styleResp.json();

    map = new maplibregl.Map({
      container: "map",
      style: styleObj,
      center: [-73.9857, 40.7484], // NYC
      zoom: 8.5

    });
    map.addControl(new maplibregl.NavigationControl({ showZoom: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "imperial" }));
  } catch (err) {
    console.error("Error loading style.json or creating map:", err);
  }
  if (!map) return; // 早退：style.json 失败则不继续

  // 2) 加载 CSV → 解析为 GeoJSON
  const csvText = await fetch(CSV_URL).then(r => {
    if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.status} ${r.statusText}`);
    return r.text();
  });
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  const feats = [];
  const boroughSet = new Set();

  for (const row of parsed.data) {
    const lat = Number(row.latitude ?? row.Latitude);
    const lon = Number(row.longitude ?? row.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const ym = ymFromDate(row.date ?? row.Date);
    const borough = (row.borough ?? row.Borough ?? "").trim();
    if (borough) boroughSet.add(borough);

    feats.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        title: row.name ?? "Ghost Bike",
        date: row.date ?? "",
        age: row.age ?? "",
        borough,
        address: row.full_address ?? "",
        narrative: row.narrative ?? "",
        yearmonth: ym
      }
    });
  }
  const geojson = { type: "FeatureCollection", features: feats };

  // 3) Year-Month 轴 & UI 初始化
  const yms = Array.from(new Set(geojson.features
    .map(f => f.properties.yearmonth)
    .filter(v => Number.isFinite(v))))
    .sort((a, b) => a - b);

  const labels = yms.map(ymLabel);

  fillSelect(fromYM, labels);
  fillSelect(toYM, labels);
  range.min = 0;
  range.max = Math.max(0, labels.length - 1);
  range.value = range.max;
  fromYM.value = 0;
  toYM.value   = labels.length - 1;

  minLabel.textContent = labels[0] || "–";
  curLabel.textContent = labels[range.value] || "–";
  maxLabel.textContent = labels[range.max] || "–";

  // Borough 下拉
  const boroughs = Array.from(boroughSet).sort();
  boroughSel.innerHTML = `<option value="">All</option>` +
    boroughs.map(b => `<option value="${b}">${b}</option>`).join("");

  // 4) 地图加载后挂载源与图层
  map.on("load", () => {
    map.addSource("ghost_bikes", { type: "geojson", data: geojson });

    map.addLayer({
      id: "ghost_bikes_circles",
      type: "circle",
      source: "ghost_bikes",
      paint: {
        "circle-color": "#ffffff",
        "circle-opacity": 0.95,
        "circle-stroke-color": "#c1121f",
        "circle-stroke-width": 1.2,
        "circle-radius": 4.5
      }
    });

    map.addLayer({
      id: "ghost_bikes_labels",
      type: "symbol",
      source: "ghost_bikes",
      layout: {
        "text-field": ["coalesce", ["get", "title"], "Ghost Bike"],
        "text-size": 11,
        "text-offset": [0, 1.0],
        "text-allow-overlap": false,
        "visibility": labelsToggle.checked ? "visible" : "none"
      },
      paint: {
        "text-color": "#374151",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1
      },
      minzoom: 13.5
    });

    // 交互
    const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on("mousemove", "ghost_bikes_circles", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      const name = f.properties?.title || "Ghost Bike";
      hoverPopup.setLngLat(e.lngLat).setHTML(`<div style="font-weight:600">${name}</div>`).addTo(map);
    });
    map.on("mouseleave", "ghost_bikes_circles", () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });

    map.on("click", "ghost_bikes_circles", (e) => {
      const p = e.features?.[0]?.properties || {};
      const html = `
        <div style="font:14px/1.45 system-ui">
          <div style="font-weight:700;margin-bottom:4px;">${p.title || "Ghost Bike"}</div>
          <div><b>Date:</b> ${p.date || "N/A"}</div>
          ${p.age ? `<div><b>Age:</b> ${p.age}</div>` : ""}
          ${p.borough ? `<div><b>Borough:</b> ${p.borough}</div>` : ""}
          ${p.address ? `<div style="margin-top:4px;"><b>Address:</b> ${p.address}</div>` : ""}
          ${p.narrative ? `<div style="margin-top:6px;">${p.narrative}</div>` : ""}
        </div>`;
      new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    });

    // 过滤
    function applyFilter() {
      if (!yms.length) return;
      const iFrom = Math.min(+fromYM.value, +toYM.value);
      const iTo   = Math.max(+fromYM.value, +toYM.value);
      const lo = yms[iFrom], hi = yms[iTo];

      const curIdx = +range.value;
      curLabel.textContent = labels[curIdx] || "–";

      const timeFilter = [
        "all",
        [">=", ["to-number", ["get", "yearmonth"]], lo],
        ["<=", ["to-number", ["get", "yearmonth"]], hi]
      ];
      const selectedBorough = boroughSel.value;
      const fullFilter = selectedBorough
        ? ["all", ...timeFilter.slice(1), ["==", ["get", "borough"], selectedBorough]]
        : timeFilter;

      map.setFilter("ghost_bikes_circles", fullFilter);
      map.setFilter("ghost_bikes_labels",  fullFilter);
    }

    // 事件
    fromYM.addEventListener("change", applyFilter);
    toYM.addEventListener("change", applyFilter);
    boroughSel.addEventListener("change", applyFilter);
    range.addEventListener("input",  () => { curLabel.textContent = labels[+range.value] || "–"; });
    range.addEventListener("change", applyFilter);
    labelsToggle.addEventListener("change", () => {
      map.setLayoutProperty("ghost_bikes_labels", "visibility", labelsToggle.checked ? "visible" : "none");
    });

    // 初始过滤
    applyFilter();
  });
})();
