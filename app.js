/**
 * BONDI COMUNIDAD CBA - VERSIÓN ULTRA (BÚSQUEDA MEJORADA)
 * Analista/Dev: Mauricio
 */

const SUPABASE_URL = 'https://zalkomeeezqxvtbngvea.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9thMFetbvy1HD5Ck8u--OQ_BoOG-6NR';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const map = L.map('map', { zoomControl: false }).setView([-31.4167, -64.1833], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

let data = { routes: [], trips: [], stops: [], stopTimes: [], shapes: [], agencies: [], calendar: [], calendar_dates: [] };
let markersLayer = L.layerGroup().addTo(map);
let routeLineLayer = L.layerGroup().addTo(map);
let busLayer = L.layerGroup().addTo(map);

let currentRouteId = "";
let currentDirection = "0"; 
let userMarker = null; 
let intervaloBondi = null; 

async function loadFile(file) {
    const res = await fetch(file);
    const text = await res.text();
    return new Promise(resolve => {
        Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim().replace(/^\uFEFF/,''), complete: r => resolve(r.data) });
    });
}

function getValidServiceIds() {
    const fechaHoy = new Date();
    const hoyStr = fechaHoy.toISOString().split('T')[0].replace(/-/g, '');
    const dias = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const hoyNombre = dias[fechaHoy.getDay()];

    let validos = data.calendar.filter(c => hoyStr >= c.start_date && hoyStr <= c.end_date && c[hoyNombre] === '1').map(c => String(c.service_id).trim());
    data.calendar_dates.forEach(ex => {
        if (ex.date === hoyStr) {
            const sId = String(ex.service_id).trim();
            if (ex.exception_type === '1') validos.push(sId);
            else if (ex.exception_type === '2') validos = validos.filter(id => id !== sId);
        }
    });
    return [...new Set(validos)];
}

async function init() {
    document.getElementById('status').innerText = "Sincronizando con GTFS...";
    const files = ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt', 'agency.txt', 'calendar.txt', 'calendar_dates.txt'];
    const res = await Promise.all(files.map(f => loadFile(f)));
    data.routes = res[0]; data.trips = res[1]; data.stops = res[2]; data.stopTimes = res[3]; data.shapes = res[4]; data.agencies = res[5]; data.calendar = res[6]; data.calendar_dates = res[7];
    document.getElementById('status').innerText = "✅ Córdoba Online";
    fillSelector();
    setupEventListeners(); 
}

function setupEventListeners() {
    const panel = document.getElementById('panel-interfaz');
    
    document.getElementById('tab-lineas').addEventListener('click', () => {
        document.getElementById('tab-lineas').classList.add('active');
        document.getElementById('tab-viajar').classList.remove('active');
        document.getElementById('seccion-lineas').style.display = 'block';
        document.getElementById('seccion-viajar').style.display = 'none';
    });
    
    document.getElementById('tab-viajar').addEventListener('click', () => {
        document.getElementById('tab-viajar').classList.add('active');
        document.getElementById('tab-lineas').classList.remove('active');
        document.getElementById('seccion-viajar').style.display = 'block';
        document.getElementById('seccion-lineas').style.display = 'none';
    });

    document.getElementById('btn-colapsar').addEventListener('click', () => panel.classList.toggle('oculto'));
    document.querySelector('#panel-interfaz h1').addEventListener('click', () => panel.classList.toggle('oculto'));

    document.getElementById('route-search').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('.route-card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(term) ? 'block' : 'none');
    });

    document.querySelectorAll('input[name="direction"]').forEach(radio => {
        radio.addEventListener('change', (e) => { currentDirection = e.target.value; if (currentRouteId) filterMap(currentRouteId); });
    });

    document.getElementById('btn-ubicacion').addEventListener('click', () => {
        map.locate({setView: true, maxZoom: 16});
        if (window.innerWidth <= 768) panel.classList.add('oculto'); 
    });

    map.on('locationfound', (e) => {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker(e.latlng).addTo(map).bindPopup("📍 Estás aquí").openPopup();
        if(document.getElementById('seccion-viajar').style.display === 'block') {
            document.getElementById('origen-input').value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
        }
    });

    document.getElementById('btn-buscar-viaje').addEventListener('click', buscarViaje);
}

function fillSelector() {
    const lista = document.getElementById('route-list');
    lista.innerHTML = ''; 
    data.routes.sort((a,b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true})).forEach(r => {
        const div = document.createElement('div');
        div.className = 'route-card';
        div.innerText = `${r.route_short_name} - ${r.route_long_name}`;
        div.addEventListener('click', () => {
            document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
            div.classList.add('active');
            currentRouteId = r.route_id;
            filterMap(currentRouteId);
            if (window.innerWidth <= 768) document.getElementById('panel-interfaz').classList.add('oculto');
        });
        lista.appendChild(div);
    });
}

function getDistanciaMts(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const p1 = lat1 * Math.PI/180; const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180; const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// BUSCADOR MEJORADO: Intenta varias combinaciones si falla
async function geocode(texto) {
    if(texto.includes(',')) {
        const partes = texto.split(',');
        if(!isNaN(partes[0])) return { lat: parseFloat(partes[0]), lon: parseFloat(partes[1]) };
    }

    const intentos = [
        `${texto}, Córdoba, Argentina`,
        `${texto}, Ciudad de Córdoba, Argentina`,
        texto
    ];

    for (let q of intentos) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&viewbox=-64.31,-31.32,-64.04,-31.52&bounded=1`);
            const json = await res.json();
            if(json.length > 0) return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
        } catch(e) { console.error(e); }
    }
    return null;
}

async function buscarViaje() {
    const btn = document.getElementById('btn-buscar-viaje');
    const panelResultados = document.getElementById('resultados-viaje');
    const txtOrigen = document.getElementById('origen-input').value;
    const txtDestino = document.getElementById('destino-input').value;

    if(!txtOrigen || !txtDestino) { alert("Ingresá puntos de referencia"); return; }
    
    btn.innerText = "⏳ Buscando en el mapa...";
    panelResultados.innerHTML = "";
    markersLayer.clearLayers(); routeLineLayer.clearLayers(); busLayer.clearLayers();

    const coordsOrigen = await geocode(txtOrigen);
    const coordsDestino = await geocode(txtDestino);

    if(!coordsOrigen || !coordsDestino) {
        btn.innerText = "🔍 Buscar Viaje";
        panelResultados.innerHTML = `<div style="padding:10px; text-align:center;">❌ No encontramos la dirección. Probá siendo más específico con el barrio.</div>`;
        return;
    }

    L.marker([coordsOrigen.lat, coordsOrigen.lon], {icon: L.divIcon({html: '🟢', className: 'bus-marker'})}).addTo(markersLayer);
    L.marker([coordsDestino.lat, coordsDestino.lon], {icon: L.divIcon({html: '🔴', className: 'bus-marker'})}).addTo(markersLayer);
    map.fitBounds([[coordsOrigen.lat, coordsOrigen.lon], [coordsDestino.lat, coordsDestino.lon]], {padding: [50, 50]});

    btn.innerText = "⏳ Calculando líneas...";

    // Rango de 800 metros para encontrar paradas
    const RADIO = 800;
    const pCercaA = data.stops.filter(s => getDistanciaMts(coordsOrigen.lat, coordsOrigen.lon, s.stop_lat, s.stop_lon) < RADIO).map(s => s.stop_id.trim());
    const pCercaB = data.stops.filter(s => getDistanciaMts(coordsDestino.lat, coordsDestino.lon, s.stop_lat, s.stop_lon) < RADIO).map(s => s.stop_id.trim());

    if(pCercaA.length === 0 || pCercaB.length === 0) {
        btn.innerText = "🔍 Buscar Viaje";
        panelResultados.innerHTML = `<div style="padding:10px; text-align:center;">No hay paradas de colectivo cerca de esos puntos.</div>`;
        return;
    }

    const serviciosHoy = getValidServiceIds();
    const tActual = new Date();
    const ahoraSeg = convertirAHora(tActual.getHours() + ':' + tActual.getMinutes() + ':' + tActual.getSeconds());

    let resultados = [];
    let lineasVistas = new Set();

    // Optimizamos la búsqueda recorriendo los stopTimes una sola vez
    const tripsValidos = data.trips.filter(t => serviciosHoy.includes(t.service_id.trim()) || serviciosHoy.length === 0);
    
    // Agrupar stopTimes por TripID
    const stGroup = {};
    data.stopTimes.forEach(st => {
        if(!stGroup[st.trip_id]) stGroup[st.trip_id] = [];
        stGroup[st.trip_id].push(st);
    });

    tripsValidos.forEach(trip => {
        if(lineasVistas.has(trip.route_id)) return;
        
        const paradas = stGroup[trip.trip_id];
        if(!paradas) return;
        paradas.sort((a,b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

        let idxA = -1, idxB = -1;
        for(let i=0; i<paradas.length; i++){
            const sid = paradas[i].stop_id.trim();
            if(idxA === -1 && pCercaA.includes(sid)) idxA = i;
            if(idxA !== -1 && pCercaB.includes(sid)) { idxB = i; break; }
        }

        if(idxA !== -1 && idxB !== -1 && idxA < idxB) {
            const hSalidaSeg = convertirAHora(paradas[idxA].departure_time);
            const diffMin = Math.round((hSalidaSeg - ahoraSeg) / 60);

            if(diffMin >= -5 && diffMin < 120) {
                const route = data.routes.find(r => r.route_id === trip.route_id);
                resultados.push({
                    id: route.route_id,
                    name: route.route_short_name,
                    min: diffMin < 0 ? 0 : diffMin,
                    parada: data.stops.find(s => s.stop_id.trim() === paradas[idxA].stop_id.trim()).stop_name,
                    dir: trip.direction_id,
                    h: paradas[idxA].departure_time.substring(0,5)
                });
                lineasVistas.add(trip.route_id);
            }
        }
    });

    btn.innerText = "🔍 Buscar Viaje";
    if(resultados.length === 0) {
        panelResultados.innerHTML = `<div style="padding:10px; text-align:center;">No encontramos colectivos directos pasando pronto.</div>`;
    } else {
        resultados.sort((a,b) => a.min - b.min).forEach(v => {
            const d = document.createElement('div');
            d.className = 'viaje-result-card';
            d.innerHTML = `<div class="viaje-badge">${v.name}</div><div class="viaje-info"><strong>Sube en:</strong> ${v.parada}<br>Hora: ${v.h}</div><div class="viaje-eta">${v.min}<small>min</small></div>`;
            d.addEventListener('click', () => {
                currentDirection = v.dir;
                filterMap(v.id);
                if(window.innerWidth <= 768) document.getElementById('panel-interfaz').classList.add('oculto');
            });
            panelResultados.appendChild(d);
        });
    }
}

// MOTOR DE MAPA Y FLOTA (MANTENIDO)
async function filterMap(routeId) {
    if (!routeId) return;
    markersLayer.clearLayers(); routeLineLayer.clearLayers(); busLayer.clearLayers();
    if (intervaloBondi) clearInterval(intervaloBondi); 
    const serviciosHoy = getValidServiceIds();
    let trips = data.trips.filter(t => t.route_id.trim() === routeId.trim() && t.direction_id.trim() === currentDirection);
    if(trips.length === 0) { document.getElementById('status').innerText = "Sin recorrido."; return; }
    const tripMolde = trips[0];
    const route = data.routes.find(r => r.route_id === routeId);
    const color = route.agency_id.trim() === '5' ? '#f39c12' : (route.agency_id.trim() === '6' ? '#c0392b' : '#27ae60');
    
    const shPoints = data.shapes.filter(sh => sh.shape_id.trim() === tripMolde.shape_id.trim()).sort((a,b) => a.shape_pt_sequence - b.shape_pt_sequence).map(sh => [parseFloat(sh.shape_pt_lat), parseFloat(sh.shape_pt_lon)]);
    if(shPoints.length > 0) L.polyline(shPoints, {color: color, weight: 6}).addTo(routeLineLayer);

    const sts = data.stopTimes.filter(st => st.trip_id.trim() === tripMolde.trip_id.trim()).sort((a,b) => a.stop_sequence - b.stop_sequence);
    sts.forEach((st, i) => {
        const s = data.stops.find(x => x.stop_id.trim() === st.stop_id.trim());
        if(s) L.circleMarker([s.stop_lat, s.stop_lon], {radius: (i===0||i===sts.length-1)?8:4, fillColor: color, color: '#fff', weight: 2, fillOpacity: 1}).addTo(markersLayer).bindPopup(s.stop_name);
    });

    actualizarFlota(trips);
    intervaloBondi = setInterval(() => actualizarFlota(trips), 5000);
    if(shPoints.length > 0) map.fitBounds(L.polyline(shPoints).getBounds(), {padding: [30,30]});
}

function actualizarFlota(trips) {
    busLayer.clearLayers();
    const t = new Date();
    const hAct = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0') + ':' + t.getSeconds().toString().padStart(2, '0');
    const hActSeg = convertirAHora(hAct);
    let dibujados = 0;

    const tIds = trips.map(x => x.trip_id.trim());
    const sts = data.stopTimes.filter(x => tIds.includes(x.trip_id.trim()));
    const stsByTrip = {};
    sts.forEach(x => { if(!stsByTrip[x.trip_id]) stsByTrip[x.trip_id] = []; stsByTrip[x.trip_id].push(x); });

    for(const tid in stsByTrip) {
        if(dibujados >= 6) break;
        const paradas = stsByTrip[tid].sort((a,b) => a.stop_sequence - b.stop_sequence);
        for(let i=0; i<paradas.length-1; i++){
            const hS = paradas[i].departure_time.trim();
            const hL = paradas[i+1].arrival_time.trim();
            if(hAct >= hS && hAct <= hL){
                const p1 = data.stops.find(x => x.stop_id.trim() === paradas[i].stop_id.trim());
                const p2 = data.stops.find(x => x.stop_id.trim() === paradas[i+1].stop_id.trim());
                const pct = (hActSeg - convertirAHora(hS)) / (convertirAHora(hL) - convertirAHora(hS));
                const lat = parseFloat(p1.stop_lat) + (parseFloat(p2.stop_lat) - parseFloat(p1.stop_lat)) * pct;
                const lon = parseFloat(p1.stop_lon) + (parseFloat(p2.stop_lon) - parseFloat(p1.stop_lon)) * pct;
                L.marker([lat, lon], {icon: L.divIcon({html: '🚌', className: 'bus-marker', iconSize:[30,30]})}).addTo(busLayer);
                dibujados++; break;
            }
        }
    }
}

function convertirAHora(h) {
    const p = h.split(':').map(Number);
    return (p[0] * 3600) + (p[1] * 60) + (p[2] || 0);
}

init();