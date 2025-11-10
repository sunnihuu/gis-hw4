// ---------- Paths ----------
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
  // Create Leaflet map with OpenStreetMap tiles
  const map = L.map('map').setView([40.7484, -73.9857], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  // 2) Load CSV → parse to GeoJSON-like features
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

  // Prepare UI lists and slider
  const yms = Array.from(new Set(feats.map(f => f.properties.yearmonth).filter(v => Number.isFinite(v)))).sort((a, b) => a - b);
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

  const boroughs = Array.from(boroughSet).sort();
  boroughSel.innerHTML = `<option value="">All</option>` + boroughs.map(b => `<option value="${b}">${b}</option>`).join("");

  // Create Leaflet markers and keep them for filtering
  const markers = feats.map(f => {
    const [lon, lat] = f.geometry.coordinates;
    const props = f.properties || {};
    const marker = L.circleMarker([lat, lon], {
      color: '#c1121f',
      fillColor: '#ffffff',
      weight: 1.2,
      radius: 6,
      fillOpacity: 0.95
    });

    const popupHtml = `
      <div style="font:14px/1.45 system-ui">
        <div style="font-weight:700;margin-bottom:4px;">${props.title || 'Ghost Bike'}</div>
        <div><b>Date:</b> ${props.date || 'N/A'}</div>
        ${props.age ? `<div><b>Age:</b> ${props.age}</div>` : ''}
        ${props.borough ? `<div><b>Borough:</b> ${props.borough}</div>` : ''}
        ${props.address ? `<div style="margin-top:4px;"><b>Address:</b> ${props.address}</div>` : ''}
        ${props.narrative ? `<div style="margin-top:6px;">${props.narrative}</div>` : ''}
      </div>`;

    marker.bindPopup(popupHtml, { maxWidth: 320 });
    marker.bindTooltip(props.title || 'Ghost Bike', { direction: 'top', offset: [0, -8] });

    // hover to open tooltip (unless labels are permanently shown)
    marker.on('mouseover', function () { this.openTooltip(); });
    marker.on('mouseout', function () { if (!labelsToggle.checked) this.closeTooltip(); });

    // store properties for filtering
    marker._props = props;
    return marker;
  });

  // Add all markers initially to the map
  markers.forEach(m => m.addTo(map));

  // Filtering logic
  function passesFilter(props, lo, hi, selectedBorough) {
    const ym = Number(props.yearmonth);
    if (!Number.isFinite(ym)) return false;
    if (ym < lo || ym > hi) return false;
    if (selectedBorough && props.borough !== selectedBorough) return false;
    return true;
  }

  function applyFilter() {
    if (!yms.length) return;
    const iFrom = Math.min(+fromYM.value, +toYM.value);
    const iTo   = Math.max(+fromYM.value, +toYM.value);
    const lo = yms[iFrom], hi = yms[iTo];

    const curIdx = +range.value;
    curLabel.textContent = labels[curIdx] || "–";

    const selectedBorough = boroughSel.value;

    markers.forEach(m => {
      const ok = passesFilter(m._props, lo, hi, selectedBorough);
      if (ok) {
        if (!map.hasLayer(m)) m.addTo(map);
      } else {
        if (map.hasLayer(m)) map.removeLayer(m);
      }
    });
  }

  // Events
  fromYM.addEventListener('change', applyFilter);
  toYM.addEventListener('change', applyFilter);
  boroughSel.addEventListener('change', applyFilter);
  range.addEventListener('input', () => { curLabel.textContent = labels[+range.value] || '–'; });
  range.addEventListener('change', applyFilter);

  labelsToggle.addEventListener('change', () => {
    if (labelsToggle.checked) {
      markers.forEach(m => m.openTooltip());
    } else {
      markers.forEach(m => m.closeTooltip());
    }
  });

  // initial filter
  applyFilter();
})();
