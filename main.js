import CONFIG from './config.js';

(async function () {
  // ---------------------------
  // Get configuration from config.js
  // ---------------------------
  const { ORS_API_KEY, OWM_API_KEY, INCIDENT_RADIUS_METERS, SAMPLE_SPACING_METERS } = CONFIG;

  // ---------------------------
  // Nominatim Autocomplete setup
  // ---------------------------
  async function fetchSuggestions(query, limit = 5) {
    if (!query || query.length < 2) return [];
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=IN&limit=${limit}&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      return data.map(d => ({ name: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) }));
    } catch (e) { console.error("Autocomplete fetch error", e); return []; }
  }

  function setupAutocomplete(inputId, suggestionsId) {
    const inputEl = document.getElementById(inputId);
    const suggEl = document.getElementById(suggestionsId);
    let selectedCoords = null;
    let debounceTimeout = null;

    inputEl.addEventListener('input', async () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(async () => {
        const q = inputEl.value.trim();
        const results = await fetchSuggestions(q, 5);
        suggEl.innerHTML = '';
        results.forEach(r => {
          const div = document.createElement('div');
          div.className = 'suggestion-item';
          div.textContent = r.name;
          div.onclick = () => {
            inputEl.value = r.name;
            selectedCoords = { lat: r.lat, lon: r.lon };
            suggEl.innerHTML = '';
          };
          suggEl.appendChild(div);
        });
      }, 300); // Debounce delay
    });

    inputEl.addEventListener('blur', () => {
      setTimeout(() => { suggEl.innerHTML = ''; }, 150);
    });

    return () => selectedCoords; // function to get last selected coordinates
  }

  const getStartCoords = setupAutocomplete('startInput', 'startSuggestions');
  const getEndCoords = setupAutocomplete('endInput', 'endSuggestions');

  // ---------------------------
  // Helper functions
  // ---------------------------
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Haversine distance (meters)
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Decode ORS polyline (encoded polyline) helper
  // ORS returns geometry as encoded polyline; if geojson is requested it returns coords.
  // We'll request geojson to simplify.

  // Sample points along a polyline (array of [lat,lon]) approx every spacing meters
  function samplePolyline(coords, spacingMeters) {
    const samples = [];
    if (!coords || coords.length === 0) return samples;
    let last = coords[0];
    samples.push(last);
    let accDist = 0;
    for (let i = 1; i < coords.length; i++) {
      const cur = coords[i];
      const segDist = haversineMeters(last[0], last[1], cur[0], cur[1]);
      if (segDist + accDist >= spacingMeters) {
        // place sample on this segment proportionally
        const remain = spacingMeters - accDist;
        const t = remain / segDist;
        const lat = last[0] + (cur[0] - last[0]) * t;
        const lon = last[1] + (cur[1] - last[1]) * t;
        samples.push([lat, lon]);
        // reset
        accDist = 0;
        last = [lat, lon];
        // re-evaluate the same segment remainder
        i--; continue;
      } else {
        accDist += segDist;
        last = cur;
      }
    }
    return samples;
  }

  // Compute safety score for route: lower counts -> higher score
  // incidents: array of {latitude,longitude,severity,type,...}
  function computeSafetyScore(routeCoords, incidents) {
    const samples = samplePolyline(routeCoords, SAMPLE_SPACING_METERS);
    if (samples.length === 0) return 0;
    let totalRisk = 0;
    for (const s of samples) {
      const [lat, lon] = s;
      // count incidents within INCIDENT_RADIUS_METERS
      let cellRisk = 0;
      for (const inc of incidents) {
        const d = haversineMeters(lat, lon, inc.latitude, inc.longitude);
        if (d <= INCIDENT_RADIUS_METERS) {
          // weight by severity and inverse distance
          const distFactor = 1 - (d / INCIDENT_RADIUS_METERS); // 1..0
          cellRisk += (inc.severity || 1) * (0.5 + 0.5 * distFactor);
        }
      }
      totalRisk += cellRisk;
    }
    // Normalize: risk per sample
    const avgRisk = totalRisk / samples.length;
    // Convert to safety score [0,1] where higher = safer:
    // safety = 1 / (1 + avgRisk*alpha), choose alpha to scale
    const alpha = 0.25;
    const safety = 1 / (1 + alpha * avgRisk);
    return Math.max(0, Math.min(1, safety));
  }

  // Simple weather risk multiplier from OpenWeatherMap hourly data
  // Returns multiplier in (0.2 .. 1) to multiply safety score.
  function weatherRiskMultiplier(weather) {
    if (!weather) return 1;
    // weather: object containing precipitation, wind_speed, visibility, etc.
    const rain = weather.rain ? (weather.rain["1h"] || 0) : 0;
    const snow = weather.snow ? (weather.snow["1h"] || 0) : 0;
    const wind = weather.wind_speed || 0;
    const visibility = weather.visibility || 10000;
    let risk = 0;
    if (rain > 5) risk += 0.5;
    else if (rain > 0) risk += 0.15;
    if (snow > 0) risk += 0.6;
    if (wind > 10) risk += 0.2;
    if (visibility < 2000) risk += 0.3;
    // map risk to multiplier
    const mult = Math.max(0.2, 1 - risk);
    return mult;
  }

  // ---------------------------
  // Map init
  // ---------------------------
  const map = L.map('map').setView([10.85, 76.27], 7); // center Kerala
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // control markers & layers
  const startMarker = L.marker([0, 0], { draggable: true }).addTo(map).bindPopup('Start').closePopup();
  const endMarker = L.marker([0, 0], { draggable: true }).addTo(map).bindPopup('End').closePopup();
  startMarker.setOpacity(0); endMarker.setOpacity(0);
  let heatLayer = null;

  // Polyline layers
  let fastestLayer = null;
  let safestLayer = null;
  const candidateLayers = [];

  // store incidents
  let incidents = []; // combined crimes+accidents with fields: latitude,longitude,severity,type,source

  // load CSVs
  async function loadCSV(path) {
    return new Promise((res, rej) => {
      Papa.parse(path, {
        download: true, header: true, dynamicTyping: true,
        complete: results => res(results.data),
        error: err => rej(err)
      });
    });
  }

  // Try to load both CSVs from /data/
  try {
    const crimeData = await loadCSV('data/kerala_crime_2022_2023.csv');
    const accData = await loadCSV('data/kerala_accidents_2022_2023.csv');
    // normalize fields
    incidents = [];
    crimeData.forEach(r => {
      if (!r || !r.latitude || !r.longitude) return;
      incidents.push({
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
        severity: Number(r.severity) || 1,
        type: r.type || 'crime',
        source: r.source || 'crime_csv',
        date: r.date || null
      });
    });
    accData.forEach(r => {
      if (!r || !r.latitude || !r.longitude) return;
      incidents.push({
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
        severity: Number(r.severity) || 1,
        type: r.type || 'accident',
        source: r.source || 'acc_csv',
        date: r.date || null
      });
    });
    console.log('Loaded incidents:', incidents.length);
  } catch (e) {
    console.warn('Failed to load CSVs (are they in /data/?)', e);
    alert('Warning: could not load CSVs from /data/. Make sure both CSV files are present.');
  }

  // build heatmap points
  function showHeatmap(toggle) {
    if (!toggle) {
      if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
      return;
    }
    const points = incidents.map(i => [i.latitude, i.longitude, (i.severity || 1)]);
    heatLayer = L.heatLayer(points, { radius: 25, blur: 20, maxZoom: 12 });
    heatLayer.addTo(map);
  }

  // click map to set start/end (shift-click for end)
  map.on('click', function (e) {
    const latlng = e.latlng;
    // if start not set or both set, set start
    if (startMarker.getOpacity() === 0 || (startMarker.getOpacity() === 1 && endMarker.getOpacity() === 1)) {
      startMarker.setLatLng(latlng).setOpacity(1).bindPopup('Start').openPopup();
      document.getElementById('startInput').value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    } else {
      endMarker.setLatLng(latlng).setOpacity(1).bindPopup('End').openPopup();
      document.getElementById('endInput').value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    }
  });

  // simple Nominatim geocode
  async function geocode(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=in`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const arr = await res.json();
    if (arr && arr.length) return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display_name: arr[0].display_name };
    return null;
  }

  // ORS directions (geojson coords in lat lon order)
  async function orsDirections(coordsArray) {
    // coordsArray: array of [lon,lat] pairs in ORS format
    // request geojson geometry
    if (!ORS_API_KEY || ORS_API_KEY === "PUT_YOUR_ORS_KEY_HERE") {
      throw new Error('Please set ORS_API_KEY in the script to get routing.');
    }
    const body = {
      coordinates: coordsArray,
      format: "geojson",
      instructions: false,
      geometry_simplify: true
    };
    const resp = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('ORS error: ' + txt);
    }
    const data = await resp.json();
    // data.features[0].properties.summary contains distance (m) and duration (s)
    if (!data.features || data.features.length === 0) return null;
    const feat = data.features[0];
    // geojson geometry coordinates are [lon, lat]
    const coords = feat.geometry.coordinates.map(c => [c[1], c[0]]); // convert to [lat,lon]
    const summary = feat.properties && feat.properties.summary ? feat.properties.summary : null;
    return { coords, summary };
  }

  // request OWM hourly forecast at latlon and timestamp (UNIX)
  async function getWeatherForecast(lat, lon, unixTs) {
    if (!OWM_API_KEY || OWM_API_KEY === "PUT_YOUR_OWM_KEY_HERE") return null;
    // One Call 3.0 requires different endpoints; One Call 2.5 hourly is accessible via /data/2.5/onecall? but current free usage: use hourly forecast endpoint
    // We'll call "onecall" (legacy) which is widely available for prototype
    const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=minutely,daily,alerts&appid=${OWM_API_KEY}&units=metric`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    if (!json.hourly) return null;
    // find the hourly bucket closest to unixTs
    let best = json.hourly.reduce((a, b) => {
      return (Math.abs(b.dt - unixTs) < Math.abs(a.dt - unixTs)) ? b : a;
    });
    return best;
  }

  // create candidate via-points to nudge route away from incidents: take midpoint and move perpendicular
  function generateViaCandidates(startLatLon, endLatLon, count = 3, offsetKm = 3) {
    const [sLat, sLon] = startLatLon;
    const [eLat, eLon] = endLatLon;
    // midpoint
    const mLat = (sLat + eLat) / 2;
    const mLon = (sLon + eLon) / 2;
    // vector
    const vx = eLat - sLat;
    const vy = eLon - sLon;
    // perpendiculars
    const perp1 = [-vy, vx];
    const perp2 = [vy, -vx];
    const cands = [];
    for (let i = 0; i < count; i++) {
      const side = (i % 2 === 0) ? perp1 : perp2;
      const factor = (0.5 + (i / (count))) * offsetKm; // km approx
      // approximate lat/km: 1 deg lat ~111 km ; lon ~ cos(lat)*111 km
      const latOffset = (side[0] / Math.hypot(...side)) * (factor / 111);
      const lonOffset = (side[1] / Math.hypot(...side)) * (factor / (111 * Math.cos(mLat * Math.PI / 180)));
      cands.push([mLat + latOffset, mLon + lonOffset]);
    }
    return cands;
  }

  // compute incidents count near route
  function incidentsNearRoute(routeCoords) {
    // count incidents within INCIDENT_RADIUS_METERS of any sampled point
    const samples = samplePolyline(routeCoords, SAMPLE_SPACING_METERS);
    let near = [];
    for (const inc of incidents) {
      for (const s of samples) {
        const d = haversineMeters(inc.latitude, inc.longitude, s[0], s[1]);
        if (d <= INCIDENT_RADIUS_METERS) {
          near.push(inc);
          break;
        }
      }
    }
    return near;
  }

  // ---------------------------
  // UI handlers
  // ---------------------------
  document.getElementById('toggleHeat').onclick = () => {
    if (heatLayer) { showHeatmap(false); } else { showHeatmap(true); }
  };

  // Validate date input
  const whenInput = document.getElementById('whenInput');
  whenInput.addEventListener('change', () => {
    const date = new Date(whenInput.value);
    const year = date.getFullYear();
    if (year < 2020 || year > 2030) {
      alert('Please select a valid year between 2020 and 2030.');
      whenInput.value = '';
    }
  });

  // when user clicks find
  document.getElementById('findBtn').onclick = async () => {
    try {
      // clear existing layers
      if (fastestLayer) map.removeLayer(fastestLayer);
      if (safestLayer) map.removeLayer(safestLayer);
      candidateLayers.forEach(l => map.removeLayer(l));
      candidateLayers.length = 0;

      const startText = document.getElementById('startInput').value.trim();
      const endText = document.getElementById('endInput').value.trim();
      const whenText = document.getElementById('whenInput').value;
      if (!startText || !endText) return alert('Please enter start and destination.');

      // 1️⃣ Try to use selected autocomplete coords first
      let start = getStartCoords();
      let end = getEndCoords();

      // 2️⃣ If no autocomplete coords, try parsing lat,lng or geocoding
      const parseIfLatLng = txt => {
        const m = txt.match(/^\s*([+-]?\d+(\.\d+)?)[,\s]+([+-]?\d+(\.\d+)?)\s*$/);
        if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[3]) };
        return null;
      };
      if (!start) start = parseIfLatLng(startText);

      if (!start) {
        const g = await geocode(startText);
        if (!g) return alert('Start address not found.');
        start = { lat: g.lat, lon: g.lon };
      }
      if (!end) {
        const g = await geocode(endText);
        if (!g) return alert('Destination not found.');
        end = { lat: g.lat, lon: g.lon };
      }

      startMarker.setLatLng([start.lat, start.lon]).setOpacity(1).openPopup();
      endMarker.setLatLng([end.lat, end.lon]).setOpacity(1).openPopup();
      map.flyTo([(start.lat + end.lat) / 2, (start.lon + end.lon) / 2], 10);

      // Get fastest route (no via)
      const coordsForORS = [[start.lon, start.lat], [end.lon, end.lat]];
      const fastest = await orsDirections(coordsForORS); // {coords, summary}
      if (!fastest) return alert('Could not fetch fastest route from ORS.');
      fastestLayer = L.polyline(fastest.coords, { color: '#e63946', weight: 6, opacity: 0.8 }).addTo(map);
      candidateLayers.push(fastestLayer);

      // Generate candidate via-points and request routes
      const viaCandidates = generateViaCandidates([start.lat, start.lon], [end.lat, end.lon], 4, 3); // 3km offsets
      // Build candidate routes: each candidate is start -> via -> end
      const candidates = [];
      for (const via of viaCandidates) {
        try {
          const orsc = await orsDirections([[start.lon, start.lat], [via[1], via[0]], [end.lon, end.lat]]);
          if (orsc) {
            candidates.push({ coords: orsc.coords, summary: orsc.summary, via });
            // small delay to be polite to ORS
            await sleep(300);
          }
        } catch (e) {
          console.warn('candidate route failed', e);
        }
      }

      // Also include the fastest as candidate 0
      candidates.unshift({ coords: fastest.coords, summary: fastest.summary, via: null });

      // For each candidate compute safety score and weather multiplier
      const whenUnix = whenText ? Math.floor(new Date(whenText).getTime() / 1000) : Math.floor(Date.now() / 1000);
      // Use midpoint for weather query
      const getMidpoint = (coords) => {
        // average lat/lon of coords
        let sumLat = 0, sumLon = 0, c = 0;
        for (const p of coords) { sumLat += p[0]; sumLon += p[1]; c++; }
        return [sumLat / c, sumLon / c];
      };

      const results = [];
      for (const c of candidates) {
        // compute base safety score
        const baseSafety = computeSafetyScore(c.coords, incidents);
        const midpoint = getMidpoint(c.coords);
        let weather = null;
        if (OWM_API_KEY && OWM_API_KEY !== "PUT_YOUR_OWM_KEY_HERE") {
          try {
            weather = await getWeatherForecast(midpoint[0], midpoint[1], whenUnix);
          } catch (e) {
            console.warn('weather fetch failed', e);
            weather = null;
          }
        }
        const weatherMult = weather ? weatherRiskMultiplier(weather) : 1;
        const finalSafety = baseSafety * weatherMult;
        // gather nearby incidents and counts
        const nearby = incidentsNearRoute(c.coords);
        results.push({
          coords: c.coords,
          summary: c.summary,
          via: c.via,
          baseSafety,
          weather,
          weatherMult,
          finalSafety,
          nearbyCount: nearby.length
        });
      }

      // choose fastest by ORS summary.duration and safest by finalSafety
      const fastestRes = results.reduce((a, b) => ((a.summary && b.summary && b.summary.duration < a.summary.duration) ? b : a));
      const safestRes = results.reduce((a, b) => ((b.finalSafety > a.finalSafety) ? b : a));

      // Draw candidate routes lightly and highlight safest
      results.forEach((r, idx) => {
        const color = (r === safestRes) ? '#2a9d8f' : (r === fastestRes ? '#e63946' : '#8d99ae');
        const weight = (r === safestRes || r === fastestRes) ? 6 : 3;
        const opacity = (r === safestRes || r === fastestRes) ? 0.9 : 0.5;
        const layer = L.polyline(r.coords, { color, weight, opacity }).addTo(map);
        candidateLayers.push(layer);
      });

      // store main layers
      if (safestLayer) map.removeLayer(safestLayer);
      safestLayer = L.polyline(safestRes.coords, { color: '#2a9d8f', weight: 8, opacity: 0.95 }).bringToFront().addTo(map);

      // Show panel info
      const container = document.getElementById('routesContainer');
      container.innerHTML = '';
      const makeCard = (label, r) => {
        const div = document.createElement('div');
        div.className = 'route-info ' + (label === 'Fastest' ? 'fastest' : 'safest');
        div.innerHTML = `<b>${label}</b>
          <div class="small">Distance: ${r.summary ? (r.summary.distance / 1000).toFixed(2) + ' km' : 'N/A'} · Duration: ${r.summary ? Math.round(r.summary.duration / 60) + ' min' : 'N/A'}</div>
          <div class="small">Safety score: ${(r.finalSafety || 0).toFixed(2)} · Incidents near route: ${r.nearbyCount}</div>
          <div class="small">${r.weather ? `Weather at travel time: ${r.weather.weather && r.weather.weather[0] ? r.weather.weather[0].description : ''}, temp ${r.weather.temp}°C` : 'Weather: n/a'}</div>
        `;
        return div;
      };
      container.appendChild(makeCard('Fastest', fastestRes));
      container.appendChild(makeCard('Safest', safestRes));
      if (safestRes !== fastestRes) {
        const note = document.createElement('div'); note.className = 'small muted'; note.style.marginTop = '8px';
        note.innerText = 'Tip: Safest route shown in green (may be longer).';
        container.appendChild(note);
      }

    } catch (err) {
      console.error(err);
      alert('Error: ' + err.message);
    }
  };

})();
