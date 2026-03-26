// 1. CONFIGURACIÓN SUPABASE
const SUPABASE_URL = 'https://zalkomeeezqxvtbngvea.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9thMFetbvy1HD5Ck8u--OQ_BoOG-6NR';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. INICIAR MAPA
const map = L.map('map').setView([-31.4167, -64.1833], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let data = { routes: [], trips: [], stops: [], stopTimes: [] };
let markersLayer = L.layerGroup().addTo(map);
let currentRouteId = ""; 

// 3. CARGAR GTFS
async function loadFile(file) {
    const res = await fetch(file);
    const text = await res.text();
    return new Promise(resolve => {
        Papa.parse(text, { header: true, skipEmptyLines: true, complete: r => resolve(r.data) });
    });
}

async function init() {
    const status = document.getElementById('status');
    try {
        status.innerText = "Cargando Córdoba...";
        [data.routes, data.trips, data.stops, data.stopTimes] = await Promise.all([
            loadFile('routes.txt'), loadFile('trips.txt'), loadFile('stops.txt'), loadFile('stop_times.txt')
        ]);
        status.innerText = "¡Datos listos! Elegí una línea.";
        fillSelector();
    } catch (e) {
        status.innerText = "Error cargando .txt";
        console.error(e);
    }
}

function fillSelector() {
    const sel = document.getElementById('route-selector');
    data.routes.sort((a,b) => a.route_short_name.localeCompare(b.route_short_name)).forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.route_id;
        opt.innerText = `${r.route_short_name} - ${r.route_long_name}`;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
        currentRouteId = e.target.value;
        filterMap(currentRouteId);
    });
}

// 4. FILTRAR Y DIBUJAR
async function filterMap(routeId) {
    if (!routeId) return;
    markersLayer.clearLayers();
    document.getElementById('status').innerText = "Dibujando paradas...";

    const trip = data.trips.find(t => t.route_id === routeId);
    if (!trip) return;

    const stopIds = data.stopTimes.filter(st => st.trip_id === trip.trip_id).map(st => st.stop_id);
    const filtered = data.stops.filter(s => stopIds.includes(s.stop_id));

    filtered.forEach(s => {
        const marker = L.circleMarker([s.stop_lat, s.stop_lon], {
            radius: 7, fillColor: "#e67e22", color: "#fff", weight: 2, fillOpacity: 0.8
        }).addTo(markersLayer);
        
        marker.stop_id = s.stop_id; 

        marker.bindPopup(`
            <div style="text-align:center">
                <strong>${s.stop_name}</strong><br>
                <button class="report-btn" onclick="reportar('${s.stop_id}', '${routeId}', 'delay')">⏳ Está demorado</button>
                <button class="report-btn" style="background:#e74c3c" onclick="reportar('${s.stop_id}', '${routeId}', 'alert')">⚠️ Inseguro</button>
            </div>
        `);
    });

    if (filtered.length > 0) map.fitBounds(new L.featureGroup(markersLayer.getLayers()).getBounds());
    
    await pintarReportes(routeId);
    document.getElementById('status').innerText = `${filtered.length} paradas cargadas.`;
}

// 5. REPORTES
window.reportar = async (stopId, routeId, type) => {
    const { error } = await _supabase.from('reports').insert([{ stop_id: stopId, route_id: routeId, report_type: type }]);
    if (!error) {
        alert("¡Gracias por reportar!");
        await pintarReportes(routeId); // Repintamos sin recargar todo
    } else {
        console.error(error);
    }
};

async function pintarReportes(routeId) {
    const unaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: reports } = await _supabase
        .from('reports')
        .select('stop_id')
        .eq('route_id', routeId)
        .gt('created_at', unaHoraAtras);
    
    if (reports) {
        markersLayer.eachLayer(m => {
            if (reports.some(r => r.stop_id === m.stop_id)) {
                m.setStyle({ fillColor: '#c0392b', radius: 10, fillOpacity: 1, color: '#000' });
            }
        });
    }
}

// 6. UBICACIÓN
window.ubicarme = () => {
    map.locate({setView: true, maxZoom: 16});
    map.on('locationfound', (e) => {
        L.marker(e.latlng).addTo(map).bindPopup("Estás aquí").openPopup();
    });
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('PWA funcionando correctamente', reg))
      .catch(err => console.log('Error al registrar PWA', err));
  });
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