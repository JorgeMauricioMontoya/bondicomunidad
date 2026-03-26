/**
 * BONDI COMUNIDAD CBA - VERSIÓN FINAL DEFINITIVA (UX CELULAR MEJORADA)
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
        Papa.parse(text, { 
            header: true, skipEmptyLines: true, 
            transformHeader: header => header.trim().replace(/^\uFEFF/,''), 
            complete: r => resolve(r.data) 
        });
    });
}

function getValidServiceIds() {
    const ahora = new Date();
    const hoyStr = ahora.toISOString().split('T')[0].replace(/-/g, '');
    const dias = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const hoyNombre = dias[ahora.getDay()];

    let validos = data.calendar
        .filter(c => hoyStr >= c.start_date && hoyStr <= c.end_date && c[hoyNombre] === '1')
        .map(c => String(c.service_id).trim());

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
    const status = document.getElementById('status');
    try {
        status.innerText = "Sincronizando con GTFS...";
        const files = ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt', 'agency.txt', 'calendar.txt', 'calendar_dates.txt'];
        const res = await Promise.all(files.map(f => loadFile(f)));
        
        data.routes = res[0]; data.trips = res[1]; data.stops = res[2];
        data.stopTimes = res[3]; data.shapes = res[4]; data.agencies = res[5];
        data.calendar = res[6]; data.calendar_dates = res[7];

        status.innerText = "✅ Córdoba Online";
        fillSelector();
        setupEventListeners(); 
    } catch (e) {
        status.innerText = "❌ Error cargando datos.";
        console.error(e);
    }
}

function setupEventListeners() {
    const panel = document.getElementById('panel-interfaz');
    const btnColapsar = document.getElementById('btn-colapsar');
    const tituloPanel = document.querySelector('#panel-interfaz h1'); // Enganchamos el título

    // NUEVO: Función única para abrir/cerrar
    const togglePanel = () => {
        panel.classList.toggle('oculto');
    };

    // Ahora ambos elementos abren y cierran el menú en celular
    if (btnColapsar) btnColapsar.addEventListener('click', togglePanel);
    if (tituloPanel) tituloPanel.addEventListener('click', togglePanel);

    document.getElementById('route-selector').addEventListener('change', (e) => {
        currentRouteId = e.target.value;
        filterMap(currentRouteId);
        
        if (window.innerWidth <= 768) {
            panel.classList.add('oculto'); 
        }
    });

    document.getElementById('route-search').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const sel = document.getElementById('route-selector');
        Array.from(sel.options).forEach(opt => {
            opt.style.display = opt.text.toLowerCase().includes(term) ? 'block' : 'none';
        });
    });

    document.querySelectorAll('input[name="direction"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentDirection = e.target.value;
            if (currentRouteId) filterMap(currentRouteId);
        });
    });

    map.on('locationfound', (e) => {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker(e.latlng).addTo(map).bindPopup("📍 Estás aquí").openPopup();
    });

    document.getElementById('btn-ubicacion').addEventListener('click', () => {
        map.locate({setView: true, maxZoom: 16});
        if (window.innerWidth <= 768) {
            panel.classList.add('oculto'); 
        }
    });
}

function fillSelector() {
    const sel = document.getElementById('route-selector');
    sel.innerHTML = '<option value="">Elegí una línea</option>';
    data.routes.sort((a,b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true}))
               .forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.route_id;
                    opt.innerText = `${r.route_short_name} - ${r.route_long_name}`;
                    sel.appendChild(opt);
               });
}

async function filterMap(routeId) {
    if (!routeId) return;
    markersLayer.clearLayers(); routeLineLayer.clearLayers(); busLayer.clearLayers();
    if (intervaloBondi) clearInterval(intervaloBondi); 
    
    const serviciosHoy = getValidServiceIds();

    let tripsHoy = data.trips.filter(t => 
        String(t.route_id).trim() === String(routeId).trim() && 
        String(t.direction_id).trim() === currentDirection &&
        serviciosHoy.includes(String(t.service_id).trim())
    );

    if (tripsHoy.length === 0) {
        tripsHoy = data.trips.filter(t => 
            String(t.route_id).trim() === String(routeId).trim() && 
            String(t.direction_id).trim() === currentDirection
        );
    }

    if (tripsHoy.length === 0) {
        document.getElementById('status').innerText = "⚠️ No hay recorrido para este sentido.";
        return;
    }

    const route = data.routes.find(r => r.route_id === routeId);
    let color = '#2980b9';
    const aId = String(route.agency_id).trim();
    if (aId === '5') color = '#f39c12';
    if (aId === '6') color = '#c0392b';
    if (aId === '8') color = '#27ae60';

    const tripMolde = tripsHoy[0];

    const shapePoints = data.shapes
        .filter(sh => String(sh.shape_id).trim() === String(tripMolde.shape_id).trim())
        .sort((a,b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence))
        .map(sh => [parseFloat(sh.shape_pt_lat), parseFloat(sh.shape_pt_lon)]);
    
    if (shapePoints.length > 0) {
        L.polyline(shapePoints, { color: color, weight: 6, opacity: 0.8 }).addTo(routeLineLayer);
    }

    const stopTimesTrip = data.stopTimes
        .filter(st => String(st.trip_id).trim() === String(tripMolde.trip_id).trim())
        .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

    stopTimesTrip.forEach((st, index) => {
        const s = data.stops.find(stop => String(stop.stop_id).trim() === String(st.stop_id).trim());
        if (!s) return;

        const esInicio = (index === 0);
        const esFin = (index === stopTimesTrip.length - 1);
        
        let markerColor = color; let radio = 5; let etiqueta = "🚏 ";

        if (esInicio) { markerColor = "#27ae60"; radio = 9; etiqueta = "🟢 INICIO: "; } 
        else if (esFin) { markerColor = "#c0392b"; radio = 9; etiqueta = "🔴 FIN: "; }

        const m = L.circleMarker([parseFloat(s.stop_lat), parseFloat(s.stop_lon)], { 
            radius: radio, fillColor: markerColor, color: "#fff", weight: 2, fillOpacity: 0.9 
        }).addTo(markersLayer);

        m.bindPopup(`<strong>${etiqueta}${s.stop_name}</strong>`);
    });

    if (tripsHoy.length > 0) {
        actualizarFlota(tripsHoy); 
        intervaloBondi = setInterval(() => { actualizarFlota(tripsHoy); }, 5000); 
        
        if (shapePoints.length > 0) {
            map.fitBounds(L.polyline(shapePoints).getBounds(), { padding: [40, 40] });
        }
    }

    document.getElementById('status').innerText = `Línea ${route.route_short_name} cargada.`;
}

function actualizarFlota(tripsActivos) {
    busLayer.clearLayers(); 

    const ahora = new Date();
    const horaActual = ahora.getHours().toString().padStart(2, '0') + ':' + 
                       ahora.getMinutes().toString().padStart(2, '0') + ':' + 
                       ahora.getSeconds().toString().padStart(2, '0');

    let bondisDibujados = 0;
    const MAX_BONDIS = 6; 
    
    const tripIdsDeHoy = tripsActivos.map(t => String(t.trip_id).trim());

    const paradasPorViaje = {};
    data.stopTimes.forEach(st => {
        const tId = String(st.trip_id).trim();
        if (tripIdsDeHoy.includes(tId)) {
            if (!paradasPorViaje[tId]) paradasPorViaje[tId] = [];
            paradasPorViaje[tId].push(st);
        }
    });

    const indicesOcupados = [];

    for (const tId in paradasPorViaje) {
        if (bondisDibujados >= MAX_BONDIS) break; 

        const paradas = paradasPorViaje[tId].sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

        for (let i = 0; i < paradas.length - 1; i++) {
            const horaSalida = paradas[i].departure_time.trim();
            const horaLlegadaSiguiente = paradas[i+1].arrival_time.trim();

            if (horaActual >= horaSalida && horaActual <= horaLlegadaSiguiente) {
                
                let muyCerca = false;
                for (let j = 0; j < indicesOcupados.length; j++) {
                    if (Math.abs(indicesOcupados[j] - i) < 6) {
                        muyCerca = true;
                        break;
                    }
                }

                if (muyCerca) break; 

                const paradaOrigenId = String(paradas[i].stop_id).trim();
                const paradaDestinoId = String(paradas[i+1].stop_id).trim();

                const paradaOrigen = data.stops.find(s => String(s.stop_id).trim() === paradaOrigenId);
                const paradaDestino = data.stops.find(s => String(s.stop_id).trim() === paradaDestinoId);
                
                if (paradaOrigen && paradaDestino) {
                    indicesOcupados.push(i); 

                    const tiempoTotal = convertirAHora(horaLlegadaSiguiente) - convertirAHora(horaSalida);
                    const tiempoPasado = convertirAHora(horaActual) - convertirAHora(horaSalida);
                    const porcentajeViaje = tiempoTotal > 0 ? (tiempoPasado / tiempoTotal) : 0;

                    const lat1 = parseFloat(paradaOrigen.stop_lat);
                    const lon1 = parseFloat(paradaOrigen.stop_lon);
                    const lat2 = parseFloat(paradaDestino.stop_lat);
                    const lon2 = parseFloat(paradaDestino.stop_lon);

                    const latActual = lat1 + ((lat2 - lat1) * porcentajeViaje);
                    const lonActual = lon1 + ((lon2 - lon1) * porcentajeViaje);

                    const tieneRampa = tId.charCodeAt(tId.length - 1) % 2 === 0;
                    const htmlIcono = tieneRampa 
                        ? `<div style="position:relative; display:inline-block;">🚌<span style="position:absolute; bottom:-6px; right:-8px; font-size:12px; background:white; border-radius:50%; width:16px; height:16px; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.4);" title="Unidad Accesible">♿</span></div>`
                        : `🚌`;

                    const iconoBus = L.divIcon({ className: 'bus-marker', html: htmlIcono, iconSize: [28, 28] });
                    
                    L.marker([latActual, lonActual], { icon: iconoBus, zIndexOffset: 1000 })
                        .addTo(busLayer)
                        .bindPopup(`
                            <strong>${tieneRampa ? '♿ Unidad Accesible' : '🚌 Unidad Estándar'}</strong><br>
                            Ubicación Teórica<br>
                            Próxima: ${paradaDestino.stop_name}
                        `);
                    
                    bondisDibujados++;
                }
                break; 
            }
        }
    }
}

function convertirAHora(horaString) {
    if (!horaString) return 0;
    const partes = horaString.split(':').map(Number);
    return (partes[0] * 3600) + (partes[1] * 60) + (partes[2] || 0);
}

init();
/*const map = L.map('map').setView([-31.4167, -64.1833], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Variables globales para guardar los datos en memoria (Caché)
let data = {
    routes: [],
    trips: [],
    stops: [],
    stopTimes: []
};

let markersLayer = L.layerGroup().addTo(map);

// Función genérica para leer archivos locales con PapaParse
async function loadFile(fileName) {
    const response = await fetch(fileName);
    const text = await response.text();
    return new Promise(resolve => {
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: results => resolve(results.data)
        });
    });
}

async function init() {
    const status = document.getElementById('status');
    
    try {
        status.innerText = "Leyendo GTFS (esto puede tardar)...";
        
        // Cargamos los archivos en paralelo para ganar tiempo
        [data.routes, data.trips, data.stops, data.stopTimes] = await Promise.all([
            loadFile('routes.txt'),
            loadFile('trips.txt'),
            loadFile('stops.txt'),
            loadFile('stop_times.txt')
        ]);

        status.innerText = "¡Datos listos!";
        populateSelector();
        
    } catch (err) {
        status.innerText = "Error: Asegurate de usar Live Server.";
        console.error(err);
    }
}

function populateSelector() {
    const selector = document.getElementById('route-selector');
    selector.innerHTML = '<option value="">-- Elegí una Línea --</option>';
    
    // Ordenar rutas alfabéticamente
    data.routes.sort((a, b) => a.route_short_name.localeCompare(b.route_short_name));

    data.routes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.route_id;
        opt.innerText = `${r.route_short_name} - ${r.route_long_name}`;
        selector.appendChild(opt);
    });

    selector.addEventListener('change', (e) => filterLine(e.target.value));
}

function filterLine(routeId) {
    if (!routeId) return;
    document.getElementById('status').innerText = "Filtrando paradas...";
    markersLayer.clearLayers();

    // 1. Encontrar el primer viaje (trip) de esa ruta
    const trip = data.trips.find(t => t.route_id === routeId);
    if (!trip) return;

    // 2. Encontrar todos los stop_ids de ese viaje
    const stopIdsOnTrip = data.stopTimes
        .filter(st => st.trip_id === trip.trip_id)
        .map(st => st.stop_id);

    // 3. Buscar las coordenadas en la lista de paradas y dibujar
    const filteredStops = data.stops.filter(s => stopIdsOnTrip.includes(s.stop_id));

    filteredStops.forEach(stop => {
        const marker = L.circleMarker([stop.stop_lat, stop.stop_lon], {
            radius: 6,
            fillColor: "#e67e22",
            color: "#fff",
            weight: 2,
            fillOpacity: 0.9
        }).addTo(markersLayer);

        marker.bindPopup(`
            <strong>${stop.stop_name}</strong><br>
            <button class="report-btn">Informar Demora</button>
        `);
    });

    // Ajustar el zoom para que se vean todas las paradas
    if (filteredStops.length > 0) {
        const group = new L.featureGroup(markersLayer.getLayers());
        map.fitBounds(group.getBounds());
    }
    
    document.getElementById('status').innerText = `${filteredStops.length} paradas encontradas.`;
}

init();*/