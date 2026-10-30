#!/usr/bin/env python3
"""Idempotent: adds citizen-friendly label_ciudadano / que_significa (+ _en) and basic-mode flags
to public/gis/layers.json (2D map) and public/explorar/data/manifest.json (3D atlas).
Re-run after scripts/build_explorer_data.py regenerates the manifest."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
L = {
 # id: (label_ciudadano, que_significa, label_en, meaning_en)
 'energy_assets': ('Plantas y red eléctrica', 'Dónde se genera y distribuye la electricidad del estado.', 'Power plants and grid', 'Where the state\'s electricity is generated and distributed.'),
 'federal_projects': ('Obras del gobierno federal', 'Proyectos federales registrados en el inventario del portal.', 'Federal government projects', 'Federal projects recorded in the portal inventory.'),
 'stills': ('Fotos del territorio', 'Vistas aéreas de lugares del estado; pulsa un punto para ver la foto.', 'Territory photos', 'Aerial views of places in the state; tap a point to see the photo.'),
 'anp_federales': ('Áreas naturales protegidas', 'Zonas decretadas para conservar la naturaleza, con reglas de uso.', 'Protected natural areas', 'Zones decreed to conserve nature, with use rules.'),
 'osm_protected': ('Zonas protegidas (mapa comunitario)', 'Áreas protegidas según OpenStreetMap; puede estar incompleto.', 'Protected zones (community map)', 'Protected areas per OpenStreetMap; may be incomplete.'),
 'rtp_conabio': ('Regiones prioritarias para la biodiversidad', 'Zonas de gran valor natural según CONABIO; no son un decreto.', 'Priority biodiversity regions', 'High natural-value zones per CONABIO; not a decree.'),
 'poer_ugas': ('Zonas del ordenamiento ecológico', 'Cada zona tiene reglas sobre qué usos del suelo son compatibles.', 'Ecological zoning units', 'Each zone has rules on which land uses are compatible.'),
 'ran_nucleos': ('Ejidos y comunidades agrarias', 'Perímetros de tierras ejidales y comunales registrados por el RAN.', 'Ejidos and agrarian communities', 'Perimeters of ejido and communal land registered by RAN.'),
 'osm_municipalities': ('Municipios', 'Los límites de los cinco municipios del estado.', 'Municipalities', 'Boundaries of the state\'s five municipalities.'),
 'osm_highways': ('Carreteras', 'Las principales carreteras del estado.', 'Highways', 'The state\'s main highways.'),
 'highway_nodes': ('Cruces y puntos de carretera', 'Puntos de referencia sobre la red carretera.', 'Highway junctions and points', 'Reference points on the road network.'),
 'osm_transport_nodes': ('Aeropuertos y puertos', 'Dónde se llega y se sale por aire y por mar.', 'Airports and ports', 'Where people arrive and leave by air and sea.'),
 'osm_power_lines': ('Líneas eléctricas', 'Trazado de las líneas que llevan la electricidad.', 'Power lines', 'Routes of the lines that carry electricity.'),
 'osm_power_nodes': ('Subestaciones y plantas eléctricas', 'Instalaciones que generan o transforman electricidad.', 'Substations and power plants', 'Facilities that generate or transform electricity.'),
 'osm_waterways': ('Ríos y arroyos', 'Cauces por donde corre el agua, aunque muchos solo llevan agua cuando llueve.', 'Rivers and streams', 'Channels where water flows; many only carry water when it rains.'),
 'osm_coastline': ('Costa', 'La línea donde la tierra se encuentra con el mar.', 'Coastline', 'Where land meets the sea.'),
 'osm_beaches': ('Playas', 'Playas registradas en el mapa comunitario.', 'Beaches', 'Beaches recorded in the community map.'),
 'settlements': ('Poblados', 'Asentamientos humanos registrados.', 'Settlements', 'Recorded human settlements.'),
 'osm_towns': ('Ciudades y pueblos', 'Dónde vive la gente: ciudades, pueblos y rancherías.', 'Cities and towns', 'Where people live: cities, towns and hamlets.'),
 'focus_corridor_cabos_lapaz': ('Corredor Los Cabos – La Paz', 'Zona de análisis entre Los Cabos, Todos Santos y La Paz.', 'Los Cabos – La Paz corridor', 'Analysis zone between Los Cabos, Todos Santos and La Paz.'),
 'focus_east_cape': ('Cabo del Este', 'Zona de análisis del East Cape.', 'East Cape', 'East Cape analysis zone.'),
 'focus_water_dmas': ('Acuíferos con falta de agua', 'Acuíferos donde se extrae más agua de la disponible.', 'Aquifers short of water', 'Aquifers where more water is drawn than is available.'),
 'focus_ports_air': ('Puertos y aeropuertos (zona de análisis)', 'Puntos clave de conexión aérea y marítima.', 'Ports and airports (analysis)', 'Key air and sea connection points.'),
 'focus_places_loreto_constitucion': ('Loreto y Ciudad Constitución', 'Zona de análisis del centro del estado.', 'Loreto and Ciudad Constitución', 'Central-state analysis zone.'),
 'escorrentia_relieve': ('Relieve del terreno', 'Montañas y valles, para entender por dónde corre el agua.', 'Terrain relief', 'Mountains and valleys, to see where water flows.'),
 'escorrentia_concentracion': ('Dónde se junta el agua de lluvia', 'Modelo de las zonas donde se acumula el escurrimiento.', 'Where rainwater gathers', 'Model of the zones where runoff accumulates.'),
 'escorrentia_red': ('Red de arroyos (modelo)', 'Cauces calculados a partir del relieve.', 'Stream network (model)', 'Channels calculated from the terrain.'),
 'escorrentia_trayectorias': ('Recorridos del agua de lluvia (modelo)', 'Por dónde bajaría el agua de lluvia según el relieve; no es un mapa de inundación.', 'Rainwater paths (model)', 'Where rainwater would flow given the terrain; not a flood map.'),
 # 3D atlas manifest ids
 'cities': ('Ciudades y pueblos', 'Localidades del Censo 2020: dónde vive la gente.', 'Cities and towns', 'Census 2020 localities: where people live.'),
 'protected': ('Áreas naturales protegidas', 'Zonas decretadas para conservar la naturaleza, con reglas de uso.', 'Protected natural areas', 'Zones decreed to conserve nature, with use rules.'),
 'priority': ('Regiones prioritarias para la biodiversidad', 'Zonas de gran valor natural según CONABIO; no son un decreto.', 'Priority biodiversity regions', 'High natural-value zones per CONABIO; not a decree.'),
 'zoning': ('Zonas del ordenamiento ecológico', 'Cada zona tiene reglas sobre qué usos del suelo son compatibles.', 'Ecological zoning units', 'Each zone has rules on which land uses are compatible.'),
 'agrarian': ('Ejidos y comunidades agrarias', 'Perímetros de tierras ejidales y comunales registrados por el RAN.', 'Ejidos and agrarian communities', 'Perimeters of ejido and communal land registered by RAN.'),
 'roads': ('Carreteras', 'Las principales carreteras del estado.', 'Highways', 'The state\'s main highways.'),
 'rivers': ('Ríos y arroyos (modelo)', 'Cauces calculados por el relieve; muchos solo llevan agua cuando llueve.', 'Rivers and streams (model)', 'Channels from the terrain; many only carry water when it rains.'),
 'runoff': ('Recorridos del agua de lluvia (modelo)', 'Por dónde bajaría el agua de lluvia según el relieve; no es un mapa de inundación.', 'Rainwater paths (model)', 'Where rainwater would flow given the terrain; not a flood map.'),
 'plants': ('Plantas eléctricas', 'Dónde se genera la electricidad (datos comunitarios, parciales).', 'Power plants', 'Where electricity is generated (community data, partial).'),
 'substations': ('Subestaciones eléctricas', 'Instalaciones que transforman la electricidad para distribuirla.', 'Substations', 'Facilities that transform electricity for distribution.'),
 'transmission': ('Líneas eléctricas', 'Trazado de las líneas que llevan la electricidad.', 'Power lines', 'Routes of the lines that carry electricity.'),
 'generators': ('Generadores eléctricos', 'Equipos de generación registrados, como paneles o turbinas.', 'Generators', 'Recorded generation units, such as panels or turbines.'),
 'transport': ('Aeropuertos y puertos', 'Dónde se llega y se sale por aire y por mar.', 'Airports and ports', 'Where people arrive and leave by air and sea.'),
}
BASIC_2D = ['osm_municipalities', 'osm_towns', 'osm_highways', 'anp_federales', 'osm_waterways', 'stills']
BASIC_3D = ['cities', 'roads', 'rivers', 'protected', 'transport']

def apply(item):
    t = L.get(item['id'])
    if not t: return 0
    item['label_ciudadano'], item['que_significa'], item['label_ciudadano_en'], item['que_significa_en'] = t
    return 1

p = ROOT / 'public/gis/layers.json'
layers = json.loads(p.read_text(encoding='utf-8'))
n2 = sum(apply(x) for x in layers)
for x in layers: x['basico'] = x['id'] in BASIC_2D
p.write_text(json.dumps(layers, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

p = ROOT / 'public/explorar/data/manifest.json'
m = json.loads(p.read_text(encoding='utf-8'))
n3 = sum(apply(x) for x in m['layers'])
m['presets'] = {'basico': BASIC_3D, **{k: v for k, v in m['presets'].items() if k != 'basico'}}
p.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'citizen labels: 2D {n2}/{len(layers)} · 3D {n3}/{len(m["layers"])}')
