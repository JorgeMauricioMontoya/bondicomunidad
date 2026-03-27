/**
 * BONDI COMUNIDAD CBA - MOTOR FINAL OPTIMIZADO
 * Dev: Mauricio | Córdoba, Argentina
 */

const SUPABASE_URL = 'https://zalkomeeezqxvtbngvea.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9thMFetbvy1HD5Ck8u--OQ_BoOG-6NR';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuración del Mapa con Canvas para mejor rendimiento en móviles
const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([-31.4167, -64.1833], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

// ÍNDICES DE ALTA VELOCIDAD
let data = { routes: [], trips: [], stops: [], calendar: [], calendar_dates: [] };
let stopsIndex = {};      
let stopTimesByTrip = {}; 
let shapesIndex = {};     
let routesIndex = {};     

let markersLayer = L.layerGroup().addTo(map);
let routeLineLayer = L.layerGroup().addTo(map);
let busLayer = L.layerGroup().addTo(map);

let currentRouteId = "";
let currentDirection = "0"; 
let userMarker = null; 
let intervaloBondi = null; 
let debounceTimer;

// CARGA DE ARCHIVOS
async function loadFile(file) {
    const res = await fetch(file);
    const text = await res.text();
    return new Promise(resolve => {
        Papa.parse(text, { 
            header: true, 
            skipEmptyLines: true, 
            transformHeader: h => h.trim().replace(/^\uFEFF/,''), 
            complete: r => resolve(r.data) 
        });
    });
}

// INICIALIZACIÓN Y OPTIMIZACIÓN DE DATOS
async function init() {
    const statusEl = document.getElementById('status');
    statusEl.innerText = "Sincronizando datos...";

    const files = ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt', 'agency.txt', 'calendar.txt', 'calendar_dates.txt'];
    const res = await Promise.all(files.map(f => loadFile(f)));
    
    statusEl.innerText = "Optimizando motor...";
    
    data.routes = res[0];
    data.trips = res[1];
    data.stops = res[2];
    data.calendar = res[6];
    data.calendar_dates = res[7];

    // 1. Indexar Paradas y Rutas para acceso instantáneo
    res[2].forEach(s => stopsIndex[s.stop_id.trim()] = s);
    res[0].forEach(r => routesIndex[r.route_id.trim()] = r);

    // 2. Indexar Horarios agrupados por Viaje y ORDENADOS por secuencia
    res[3].forEach(st => {
        const tid = st.trip_id.trim();
        if (!stopTimesByTrip[tid]) stopTimesByTrip[tid] = [];
        stopTimesByTrip[tid].push(st);
    });
    for (let tid in stopTimesByTrip) {
        stopTimesByTrip[tid].sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
    }

    // 3. Indexar Recorridos (Shapes)
    res[4].forEach(sh => {
        const sid = sh.shape_id.trim();
        if (!shapesIndex[sid]) shapesIndex[sid] = [];
        shapesIndex[sid].push([parseFloat(sh.shape_pt_lat), parseFloat(sh.shape_pt_lon)]);
    });

    statusEl.innerText = "✅ Córdoba Online";
    fillSelector();
    setupEventListeners(); 
}

// EVENTOS DE INTERFAZ
function setupEventListeners() {
    const panel = document.getElementById('panel-interfaz');
    
    document.getElementById('tab-lineas').onclick = () => toggleTab('lineas');
    document.getElementById('tab-viajar').onclick = () => toggleTab('viajar');
    document.getElementById('btn-colapsar').onclick = () => panel.classList.toggle('oculto');

    // Buscador con Debounce (espera a que termines de escribir)
    document.getElementById('route-search').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('.route-card').forEach(card => {
                card.style.display = card.innerText.toLowerCase().includes(term) ? 'block' : 'none';
            });
        }, 300);
    });

    document.querySelectorAll('input[name="direction"]').forEach(radio => {
        radio.onchange = (e) => { 
            currentDirection = e.target.value; 
            if (currentRouteId) filterMap(currentRouteId); 
        };
    });

    document.getElementById('btn-ubicacion').onclick = () => map.locate({setView: true, maxZoom: 16});
    document.getElementById('btn-buscar-viaje').onclick = buscarViaje;

    map.on('locationfound', (e) => {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker(e.latlng).addTo(map).bindPopup("📍 Estás aquí").openPopup();
        document.getElementById('origen-input').value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    });
}

function toggleTab(tab) {
    const isL = tab === 'lineas';
    document.getElementById('seccion-lineas').style.display = isL ? 'block' : 'none';
    document.getElementById('seccion-viajar').style.display = isL ? 'none' : 'block';
    document.getElementById('tab-lineas').classList.toggle('active', isL);
    document.getElementById('tab-viajar').classList.toggle('active', !isL);
}

// LLENAR LISTA DE LÍNEAS
function fillSelector() {
    const lista = document.getElementById('route-list');
    const fragment = document.createDocumentFragment();
    data.routes.sort((a,b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true})).forEach(r => {
        const div = document.createElement('div');
        div.className = 'route-card';
        div.innerText = `${r.route_short_name} - ${r.route_long_name}`;
        div.onclick = () => {
            document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
            div.classList.add('active');
            currentRouteId = r.route_id;
            filterMap(currentRouteId);
            if (window.innerWidth <= 768) document.getElementById('panel-interfaz').classList.add('oculto');
        };
        fragment.appendChild(div);
    });
    lista.innerHTML = '';
    lista.appendChild(fragment);
}

// MOSTRAR RECORRIDO EN MAPA
async function filterMap(routeId) {
    if (!routeId) return;
    markersLayer.clearLayers(); routeLineLayer.clearLayers(); busLayer.clearLayers();
    if (intervaloBondi) clearInterval(intervaloBondi); 

    const route = routesIndex[routeId.trim()];
    const trips = data.trips.filter(t => t.route_id.trim() === routeId.trim() && t.direction_id.trim() === currentDirection);
    if(trips.length === 0) {
        document.getElementById('status').innerText = "Sin recorrido disponible.";
        return;
    }

    const tripMolde = trips[0];
    const color = route.agency_id === '5' ? '#f39c12' : (route.agency_id === '6' ? '#c0392b' : '#27ae60');
    
    // Dibujar Shape (La línea de la calle)
    const shPoints = shapesIndex[tripMolde.shape_id.trim()] || [];
    if(shPoints.length > 0) {
        L.polyline(shPoints, {color: color, weight: 5, opacity: 0.8}).addTo(routeLineLayer);
        map.fitBounds(L.polyline(shPoints).getBounds(), {padding: [30,30]});
    }

    // Dibujar Paradas
    const sts = stopTimesByTrip[tripMolde.trip_id.trim()] || [];
    sts.forEach((st, i) => {
        const s = stopsIndex[st.stop_id.trim()];
        if(s) {
            L.circleMarker([s.stop_lat, s.stop_lon], {
                radius: (i===0 || i===sts.length-1) ? 7 : 3, 
                fillColor: color, color: '#fff', weight: 1, fillOpacity: 1
            }).addTo(markersLayer).bindPopup(s.stop_name);
        }
    });

    actualizarFlota(trips);
    intervaloBondi = setInterval(() => actualizarFlota(trips), 5000);
}

// SIMULACIÓN DE FLOTA (GPS TEÓRICO)
function actualizarFlota(trips) {
    busLayer.clearLayers();
    const ahora = new Date();
    const hActSeg = (ahora.getHours() * 3600) + (ahora.getMinutes() * 60) + ahora.getSeconds();
    let dibujados = 0;

    for(const trip of trips) {
        if (dibujados >= 15) break; 
        const paradas = stopTimesByTrip[trip.trip_id.trim()];
        if(!paradas) continue;

        for(let i=0; i < paradas.length - 1; i++){
            const tS = convertirAHora(paradas[i].departure_time);
            const tL = convertirAHora(paradas[i+1].arrival_time);

            if(hActSeg >= tS && hActSeg <= tL){
                const p1 = stopsIndex[paradas[i].stop_id.trim()];
                const p2 = stopsIndex[paradas[i+1].stop_id.trim()];
                if(!p1 || !p2) continue;

                const pct = (hActSeg - tS) / (tL - tS);
                const lat = parseFloat(p1.stop_lat) + (parseFloat(p2.stop_lat) - parseFloat(p1.stop_lat)) * pct;
                const lon = parseFloat(p1.stop_lon) + (parseFloat(p2.stop_lon) - parseFloat(p1.stop_lon)) * pct;

                L.marker([lat, lon], {
                    icon: L.divIcon({html: '🚌', className: 'bus-marker', iconSize:[30,30]})
                }).addTo(busLayer);
                dibujados++; break;
            }
        }
    }
}

// BUSCADOR DE VIAJES (CÓMO IR)
async function buscarViaje() {
    const btn = document.getElementById('btn-buscar-viaje');
    const panelResultados = document.getElementById('resultados-viaje');
    const txtOrigen = document.getElementById('origen-input').value;
    const txtDestino = document.getElementById('destino-input').value;

    if(!txtOrigen || !txtDestino) {
        alert("Ingresá puntos de referencia (ej: Patio Olmos)");
        return;
    }
    
    btn.innerText = "⏳ Buscando en el mapa...";
    panelResultados.innerHTML = "";
    
    // Limpiamos capas previas para que no se amontonen marcadores
    markersLayer.clearLayers(); 
    routeLineLayer.clearLayers(); 
    busLayer.clearLayers();

    // 1. Convertir direcciones a coordenadas reales
    const coordsOrigen = await geocode(txtOrigen);
    const coordsDestino = await geocode(txtDestino);

    if(!coordsOrigen || !coordsDestino) {
        btn.innerText = "🔍 Buscar Viaje";
        panelResultados.innerHTML = `<div style="padding:10px; text-align:center;">❌ No encontramos la dirección. Probá siendo más específico con el barrio.</div>`;
        return;
    }

    // --- NUEVO: MARCADORES DE ORIGEN Y DESTINO EN EL MAPA ---
    const iconOrigen = L.divIcon({ html: '🟢', className: 'bus-marker', iconSize: [30, 30] });
    const iconDestino = L.divIcon({ html: '🔴', className: 'bus-marker', iconSize: [30, 30] });

    L.marker([coordsOrigen.lat, coordsOrigen.lon], { icon: iconOrigen }).addTo(markersLayer).bindPopup("Tu Origen: " + txtOrigen);
    L.marker([coordsDestino.lat, coordsDestino.lon], { icon: iconDestino }).addTo(markersLayer).bindPopup("Tu Destino: " + txtDestino);

    // Encuadrar el mapa para que se vean ambos puntos con un margen
    map.fitBounds([
        [coordsOrigen.lat, coordsOrigen.lon],
        [coordsDestino.lat, coordsDestino.lon]
    ], { padding: [50, 50] });
    // -------------------------------------------------------

    btn.innerText = "⏳ Calculando líneas...";

    // Radio de 750 metros para buscar paradas
    const RADIO = 750;
    const pCercaOrigen = data.stops.filter(s => getDistanciaMts(coordsOrigen.lat, coordsOrigen.lon, s.stop_lat, s.stop_lon) < RADIO).map(s => s.stop_id.trim());
    const pCercaDestino = data.stops.filter(s => getDistanciaMts(coordsDestino.lat, coordsDestino.lon, s.stop_lat, s.stop_lon) < RADIO).map(s => s.stop_id.trim());

    if(pCercaOrigen.length === 0 || pCercaDestino.length === 0) {
        btn.innerText = "🔍 Buscar Viaje";
        panelResultados.innerHTML = `<div style="padding:10px; text-align:center;">No hay paradas cerca de esos puntos (Radio 750m).</div>`;
        return;
    }

    const serviciosHoy = getValidServiceIds();
    const ahoraSeg = (new Date().getHours() * 3600) + (new Date().getMinutes() * 60);
    let resultados = [];
    let rutasVistas = new Set();

    for (const trip of data.trips) {
        if (!serviciosHoy.includes(trip.service_id.trim()) && serviciosHoy.length > 0) continue;
        if (rutasVistas.has(trip.route_id)) continue;

        const tiempos = stopTimesByTrip[trip.trip_id.trim()];
        if (!tiempos) continue;

        let idxA = -1, idxB = -1;
        for (let i = 0; i < tiempos.length; i++) {
            const sid = tiempos[i].stop_id.trim();
            if (idxA === -1 && pCercaOrigen.includes(sid)) idxA = i;
            if (idxA !== -1 && pCercaDestino.includes(sid)) { idxB = i; break; }
        }

        if (idxA !== -1 && idxB !== -1) {
            const hSalidaSeg = convertirAHora(tiempos[idxA].departure_time);
            const diffMin = Math.round((hSalidaSeg - ahoraSeg) / 60);

            if (diffMin >= -10 && diffMin < 120) {
                const rInfo = routesIndex[trip.route_id.trim()];
                resultados.push({
                    id: trip.route_id,
                    name: rInfo ? rInfo.route_short_name : "S/N",
                    min: diffMin < 0 ? 0 : diffMin,
                    parada: stopsIndex[tiempos[idxA].stop_id.trim()].stop_name,
                    dir: trip.direction_id,
                    hora: tiempos[idxA].departure_time.substring(0,5)
                });
                rutasVistas.add(trip.route_id);
            }
        }
    }

    btn.innerText = "🔍 Buscar Viaje";
    if(resultados.length === 0) {
        panelResultados.innerHTML = `<div style="padding:10px; text-align:center;">No encontramos colectivos directos pasando pronto.</div>`;
    } else {
        resultados.sort((a,b) => a.min - b.min).forEach(v => {
            const d = document.createElement('div');
            d.className = 'viaje-result-card';
            d.style.cursor = "pointer";
            d.innerHTML = `
                <div class="viaje-badge">${v.name}</div>
                <div class="viaje-info"><strong>Sube en:</strong> ${v.parada}<br>Hora: ${v.hora}</div>
                <div class="viaje-eta">${v.min}<small>min</small></div>
            `;
            d.onclick = () => {
                currentDirection = v.dir;
                filterMap(v.id);
                if(window.innerWidth <= 768) document.getElementById('panel-interfaz').classList.add('oculto');
            };
            panelResultados.appendChild(d);
        });
    }
}
// FUNCIONES AUXILIARES
function getDistanciaMts(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;
    const a = 0.5 - Math.cos((lat2 - lat1) * p)/2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))/2;
    return 12742000 * Math.asin(Math.sqrt(a));
}

function convertirAHora(h) {
    const p = h.split(':').map(Number);
    return (p[0] * 3600) + (p[1] * 60) + (p[2] || 0);
}

function getValidServiceIds() {
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0].replace(/-/g, '');
    const dias = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const hoyNombre = dias[hoy.getDay()];
    let v = data.calendar.filter(c => hoyStr >= c.start_date && hoyStr <= c.end_date && c[hoyNombre] === '1').map(c => c.service_id.trim());
    return [...new Set(v)];
}

async function geocode(texto) {
    if(texto.includes(',')) {
        const p = texto.split(',');
        if(!isNaN(p[0])) return { lat: parseFloat(p[0]), lon: parseFloat(p[1]) };
    }
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto + ', Cordoba, Argentina')}&limit=1`);
        const json = await res.json();
        return json.length > 0 ? { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) } : null;
    } catch(e) { return null; }
}

init();