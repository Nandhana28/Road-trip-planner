import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MapContainer, TileLayer, Polyline, Marker,
  Tooltip, Popup, useMap, useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { planTrip } from '../api/tripApi';
import { 
  CloudRain, CloudSun, Wind, Sun, Droplets,
  Phone, Globe, CreditCard, Clock, MapPin, 
  Zap, Mountain, Scale, Map, 
  Fuel, Thermometer,
  Utensils, PlusCircle
} from 'lucide-react';
import styles from './TripResult.module.css';
import {
  fmt, closestIdx, interpolate, fetchOverpass, fetchElevation,
  calcFuelCost, estimateToll, calcCarbon,
  riskScore, riskColor, riskLabel,
  departureAdvice, staySuggestion, getEmergencyContacts, buildChecklist,
  POI_CONFIG, TRAFFIC_COLORS,
} from './tripUtils';
import { generateItinerary } from './generateItinerary';
import { useNotifications } from '../components/useNotifications';
import NotificationToast from '../components/NotificationToast';

// ── Leaflet icon fix ──────────────────────────────────────────────────────────
import mi2x from 'leaflet/dist/images/marker-icon-2x.png';
import mi   from 'leaflet/dist/images/marker-icon.png';
import ms   from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: mi2x, iconUrl: mi, shadowUrl: ms });

// ── SVG icon paths ────────────────────────────────────────────────────────────
const PATHS = {
  fuel:       `<path d="M3 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v9"/><path d="M5 22V10h8v12"/><path d="M17 14v-3a2 2 0 0 1 4 0v3a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2z"/>`,
  restaurant: `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>`,
  hospital:   `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/>`,
  hotel:      `<path d="M3 22V11l9-9 9 9v11"/><path d="M9 22V12h6v10"/>`,
  atm:        `<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>`,
  pharmacy:   `<path d="M9 2H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 2v20m0 0h10a2 2 0 0 0 2-2v-4M9 22H5a2 2 0 0 1-2-2v-4m0 0h18"/><path d="M12 12h4"/><path d="M14 10v4"/>`,
  police:     `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  viewpoint:  `<circle cx="12" cy="12" r="2"/><path d="M12 19c-4 0-8-3.5-8-7s4-7 8-7 8 3.5 8 7-4 7-8 7z"/>`,
  ev:         `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  restarea:   `<path d="M3 11l19-9-9 19-2-8-8-2z"/>`,
};
const isvg = (key, size = 11, color = 'currentColor') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[key] || ''}</svg>`;

// ── Map icons ─────────────────────────────────────────────────────────────────
const makePOIIcon = (type, zoom) => {
  const cfg = POI_CONFIG[type], sz = zoom >= 11 ? 28 : zoom >= 10 ? 26 : 22;
  return L.divIcon({
    className: '',
    html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:#111;border:2px solid ${cfg.color};box-shadow:0 0 6px ${cfg.color}66, 0 2px 6px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;">${isvg(cfg.icon, sz >= 28 ? 13 : sz >= 26 ? 12 : 10, cfg.color)}</div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  });
};
const PULSE_ICON = L.divIcon({
  className: '',
  html: `<div style="position:relative;width:22px;height:22px"><div style="position:absolute;inset:0;border-radius:50%;background:#aa9371;opacity:.22;animation:pulseRing 2s ease-out infinite;"></div><div style="position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#aa9371;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(170,147,113,.6);"></div></div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
});
const DEST_ICON = L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:#6dbf8a;border:2.5px solid #fff;box-shadow:0 2px 10px rgba(109,191,138,.6);"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
const MID_ICON  = L.divIcon({ className: '', html: `<div style="width:10px;height:10px;border-radius:50%;background:#d6c6ac;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });
const makeTollIcon = () => L.divIcon({ className: '', html: `<div style="background:#e09a4a;color:#000;font-size:9px;font-weight:700;padding:3px 6px;border-radius:4px;border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);line-height:1.2;letter-spacing:.5px;">TOLL</div>`, iconSize: [38, 20], iconAnchor: [19, 10] });

// ── Map helpers ───────────────────────────────────────────────────────────────
function MapFitter({ poly }) {
  const map = useMap();
  useEffect(() => { if (poly?.length > 1) map.fitBounds(L.latLngBounds(poly), { padding: [40, 40] }); }, []);
  return null;
}
function ZoomTracker({ onZoom }) {
  useMapEvents({ zoom: e => onZoom(e.target.getZoom()) });
  return null;
}

// ── Elevation chart ───────────────────────────────────────────────────────────
function ElevationChart({ data }) {
  if (!data || data.length < 2) return (
    <div className={styles.elevEmpty}>
      <div className={styles.elevSkeleton} />
      <p>Fetching elevation data…</p>
    </div>
  );
  const elevs = data.map(d => d.elevation);
  const mn = Math.min(...elevs), mx = Math.max(...elevs), rng = mx - mn || 1;
  const W = 300, H = 72;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * W},${H - ((d.elevation - mn) / rng) * (H - 10)}`).join(' ');
  return (
    <div className={styles.elevWrap}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#aa9371" stopOpacity=".4" />
            <stop offset="100%" stopColor="#aa9371" stopOpacity=".02" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#eg)" />
        <polyline points={pts} fill="none" stroke="#aa9371" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className={styles.elevLabels}>
        <span>{mn}m</span>
        <span className={styles.elevMid}>Elevation Profile</span>
        <span>{mx}m</span>
      </div>
    </div>
  );
}

// ── Risk dial ─────────────────────────────────────────────────────────────────
function RiskDial({ score }) {
  const color = riskColor(score), r = 34, cx = 44, cy = 44;
  const toXY = deg => { const rad = (deg * Math.PI) / 180; return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]; };
  const [sx, sy] = toXY(-180), [ex, ey] = toXY(0), [nx, ny] = toXY((score / 10) * 180 - 180);
  return (
    <svg viewBox="0 0 88 56" className={styles.riskDial}>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="#2a2a2a" strokeWidth="8" strokeLinecap="round" />
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${nx} ${ny}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3.5" fill={color} />
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>{score}/10</text>
    </svg>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function Panel({ icon, title, badge, children, noPad }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelIcon}>{icon}</span>
        <h3 className={styles.panelTitle}>{title}</h3>
        {badge && <span className={styles.panelBadge}>{badge}</span>}
      </div>
      <div className={`${styles.panelBody} ${noPad ? styles.panelBodyNoPad : ''}`}>{children}</div>
    </div>
  );
}

// ── Stat row ──────────────────────────────────────────────────────────────────
function StatRow({ label, value, accent }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${accent ? styles.statAccent : ''}`}>{value}</span>
    </div>
  );
}

// ── Checklist item ────────────────────────────────────────────────────────────
function CItem({ text }) {
  const [done, setDone] = useState(false);
  return (
    <div className={`${styles.cItem} ${done ? styles.cItemDone : ''}`} onClick={() => setDone(v => !v)}>
      <div className={`${styles.cBox} ${done ? styles.cBoxDone : ''}`}>
        {done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
      </div>
      <span className={styles.cText}>{text}</span>
    </div>
  );
}

function WeatherIcon({ rain, wind }) {
  if (rain > 60) return <CloudRain size={16} className={styles.wxEmoji} />;
  if (rain > 30) return <CloudSun size={16} className={styles.wxEmoji} />;
  if (wind > 40) return <Wind size={16} className={styles.wxEmoji} />;
  return <Sun size={16} className={styles.wxEmoji} />;
}

// ════════════════════════════════════════════════════════════════════════════
export default function TripResult() {
  const location = useLocation();
  const navigate = useNavigate();
  const fd = location.state?.formData;
  const savedTripData = location.state?.tripData;

  const [tripData, setTripData]       = useState(savedTripData || null);
  const [loading, setLoading]         = useState(!savedTripData);
  const [error, setError]             = useState(null);
  const [zoom, setZoom]               = useState(7);
  const [realPOIs, setRealPOIs]       = useState({});
  const [elevation, setElevation]     = useState([]);
  const [loadingPOIs, setLoadingPOIs] = useState(false);
  const [vehicle, setVehicle]         = useState('car');
  const [mileage, setMileage]         = useState(15);
  const [fuelPrice, setFuelPrice]     = useState(103);
  const [activeTab, setActiveTab]     = useState('overview');
  const [layers, setLayers]           = useState({ traffic: true, poi: true, tolls: true });
  const [poiFilter, setPoiFilter]     = useState({
    fuel: true, restaurants: true, hospitals: false, hotels: false,
    atm: false, pharmacy: false, police: false, viewpoint: true, ev: false, restarea: false,
  });
  const fetched = useRef(false);
  const notifFired = useRef(false);
  const { queue, notify, dismiss } = useNotifications();
  const [downloading, setDownloading] = useState(false);

  const fetchTrip = useCallback(async () => {
    if (!fd) { navigate('/dashboard'); return; }
    setLoading(true); setError(null);
    try {
      const data = await planTrip({ 
        source: fd.source, 
        destination: fd.destination, 
        date: fd.startDate, 
        passengers: fd.people,
        route: fd.route || 'balanced'
      });
      setTripData(data);
      const uid = JSON.parse(localStorage.getItem('user') || '{}').id;
      const tripsKey = uid ? `trips_${uid}` : 'trips';
      const existing = JSON.parse(localStorage.getItem(tripsKey) || '[]');
      const updated = existing.map(t =>
        t.id === fd.id ? { ...t, tripData: data, resolved: true } : t
      );
      localStorage.setItem(tripsKey, JSON.stringify(updated));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [fd, navigate]);

  useEffect(() => { if (!savedTripData) fetchTrip(); }, [fetchTrip, savedTripData]);

  useEffect(() => {
    if (!tripData || fetched.current) return;
    fetched.current = true;
    const cities = tripData.route.cities || [];
    const poly   = (tripData.route.polyline || []).map(([la, lo]) => [la, lo]);

    // ── Fire notifications once after data loads ──────────────────────────
    if (!notifFired.current) {
      notifFired.current = true;
      const segs = tripData.segments || [];

      // Weather alert
      const badWeather = (tripData.weather || []).filter(w =>
        w.rain_probability > 50 || w.wind_speed > 35
      );
      if (badWeather.length > 0) {
        const city = badWeather[0];
        notify('notifyWeather', {
          title: 'Weather alert on your route',
          desc: `${city.city || 'A city'} has ${city.rain_probability > 50
            ? `${city.rain_probability}% chance of rain`
            : `strong winds (${city.wind_speed} km/h)`}.`,
          type: 'weather',
        });
      }

      // Traffic update
      const highTraffic = segs.filter(s => (s.traffic_level || '').toUpperCase() === 'HIGH');
      if (highTraffic.length > 0) {
        setTimeout(() => {
          notify('notifyTraffic', {
            title: 'Heavy traffic detected',
            desc: `${highTraffic[0].start} → ${highTraffic[0].end} has high congestion. Consider an early departure.`,
            type: 'traffic',
          });
        }, 800);
      }

      // Road hazard
      const overallRisk = Math.round(
        segs.reduce((a, s) => a + riskScore(s.traffic_level, s.weather_risk), 0) / (segs.length || 1)
      );
      if (overallRisk >= 7) {
        setTimeout(() => {
          notify('notifyRoadHazard', {
            title: 'High risk route',
            desc: `Overall risk score is ${overallRisk}/10. Check the Safety tab before departing.`,
            type: 'hazard',
          });
        }, 1600);
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!cities.length) {
      setRealPOIs({});
      setLoadingPOIs(false);
      return;
    }
    
    setLoadingPOIs(true);
    (async () => {
      try {
        const result = {};
        
        // Fetch POIs from city centers only (simpler and more reliable)
        for (const city of cities) {
          result[city.name] = {};
          for (const [type, cfg] of Object.entries(POI_CONFIG)) {
            try {
              const pois = await fetchOverpass(city.lat, city.lon, 12, cfg.overpassTag);
              result[city.name][type] = pois.slice(0, 8); // Limit to 8 per type per city
            } catch (err) {
              console.warn(`Failed to fetch ${type} for ${city.name}:`, err);
              result[city.name][type] = [];
            }
          }
        }
        
        setRealPOIs(result);
      } catch (err) {
        console.error('POI fetching error:', err);
        setRealPOIs({});
      } finally {
        setLoadingPOIs(false);
      }
    })();
    
    fetchElevation(poly, 60).then(setElevation).catch(err => console.warn('Elevation fetch failed:', err));
  }, [tripData]);

  if (loading) return (
    <div className={styles.loadingPage}>
      <div className={styles.loadingInner}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Planning your route</p>
        <p className={styles.loadingHint}>Fetching route, weather &amp; places…</p>
        <div className={styles.loadingSteps}>
          {['Optimizing route', 'Checking traffic', 'Loading weather', 'Finding stops'].map((s, i) => (
            <div key={s} className={styles.loadingStep} style={{ animationDelay: `${i * 0.6}s` }}>
              <div className={styles.loadingDot} /> {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (error) return (
    <div className={styles.errorPage}>
      <div className={styles.errorCard}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e05c5c" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        <h2 className={styles.errorTitle}>Could not plan trip</h2>
        <p className={styles.errorMsg}>{error}</p>
        <div className={styles.errorActions}>
          <button className={styles.retryBtn} onClick={fetchTrip}>Try again</button>
          <button className={styles.backBtnError} onClick={() => navigate('/dashboard')}>← Dashboard</button>
        </div>
      </div>
    </div>
  );

  if (!tripData) return null;

  const { route, segments, summary, weather } = tripData;
  const poly = (route.polyline || []).map(([la, lo]) => [la, lo]);
  const centerCity = route.cities?.[Math.floor((route.cities?.length || 0) / 2)] ?? route.cities?.[0];
  const mapCenter  = centerCity ? [centerCity.lat, centerCity.lon] : [12.97, 77.59];
  const pax        = fd?.people || 1;

  const segPoly = segments.map(seg => {
    const s = route.cities?.find(c => c.name === seg.start);
    const e = route.cities?.find(c => c.name === seg.end);
    if (!s || !e || poly.length < 2) return null;
    const ai = closestIdx(poly, s.lat, s.lon), bi = closestIdx(poly, e.lat, e.lon);
    return {
      positions: poly.slice(Math.min(ai, bi), Math.max(ai, bi) + 1),
      color: TRAFFIC_COLORS[seg.traffic_level] || TRAFFIC_COLORS.MODERATE,
      traffic: seg.traffic_level, start: seg.start, end: seg.end,
      ai: Math.min(ai, bi), bi: Math.max(ai, bi),
    };
  }).filter(Boolean);

  const tollPos     = layers.tolls ? segPoly.map(sp => sp.positions[Math.floor(sp.positions.length / 2)]).filter(Boolean) : [];
  const trafficW    = zoom >= 12 ? 7 : zoom >= 10 ? 5 : zoom >= 8 ? 4 : 3;
  const showMarkers = layers.poi && zoom >= 9;

  const allMarkers = (() => {
    try {
      const hasReal = Object.keys(realPOIs).length > 0 && Object.values(realPOIs).some(types => Object.values(types).some(pois => pois.length > 0));
      
      if (hasReal) {
        // Show real POIs from Overpass API
        const markers = Object.entries(realPOIs).flatMap(([city, types]) =>
          Object.entries(types).flatMap(([type, pois]) =>
            poiFilter[type] ? pois.map(p => ({ 
              key: `r-${type}-${p.id}`, 
              type, 
              pos: [p.lat, p.lon], 
              name: p.name, 
              city, 
              brand: p.brand, 
              phone: p.phone, 
              fee: p.fee,
              website: p.website,
              hours: p.hours,
              email: p.email,
              isFb: false 
            })) : []
          )
        );
        
        // Spread out overlapping markers slightly
        const markerMap = new Map();
        markers.forEach(m => {
          const key = `${m.pos[0].toFixed(4)}-${m.pos[1].toFixed(4)}`;
          if (!markerMap.has(key)) markerMap.set(key, []);
          markerMap.get(key).push(m);
        });
        
        const spread = [];
        markerMap.forEach((group) => {
          if (group.length === 1) {
            spread.push(group[0]);
          } else {
            // Spread markers in a small circle around the location
            const [lat, lon] = group[0].pos;
            group.forEach((m, i) => {
              const angle = (i / group.length) * Math.PI * 2;
              const offset = 0.0003; // ~30 meters
              spread.push({
                ...m,
                pos: [lat + Math.cos(angle) * offset, lon + Math.sin(angle) * offset]
              });
            });
          }
        });
        
        return spread;
      }
      
      // Fallback: show interpolated POIs along the route
      const out = [];
      segments.forEach((seg, idx) => {
        const sp = segPoly[idx]; if (!sp) return;
        Object.entries({ fuel: 2, restaurants: 2, hospitals: 1, hotels: 1, viewpoint: 1 }).forEach(([type, max]) => {
          if (!poiFilter[type]) return;
          const n = Math.min(seg.stops?.[type] || 1, max);
          interpolate(poly, sp.ai, sp.bi, n).forEach((pos, i) =>
            out.push({ key: `fb-${type}-${idx}-${i}`, type, pos, name: `${POI_CONFIG[type].label} ${i + 1}`, city: seg.start, isFb: true })
          );
        });
      });
      return out;
    } catch (err) {
      console.error('Error calculating allMarkers:', err);
      return [];
    }
  })();

  const dist        = route.total_distance_km || 0;
  const fuel        = calcFuelCost(dist, mileage, fuelPrice);
  const toll        = estimateToll(dist, vehicle);
  const totalCost   = fuel.cost + toll;
  const perPerson   = Math.round(totalCost / pax);
  const carbon      = calcCarbon(dist, vehicle);
  const advice      = departureAdvice(segments);
  const stay        = staySuggestion(route.ordered_cities || [], summary.total_trip_time_min);
  const emergency   = getEmergencyContacts(route.ordered_cities || []);
  const checklist   = buildChecklist(segments);
  const overallRisk = Math.round(segments.reduce((a, s) => a + riskScore(s.traffic_level, s.weather_risk), 0) / (segments.length || 1));
  const physicsTime = Math.round(dist / 62 * 60);
  const mlActive    = segments.some(s => s.data_source?.includes('ml'));
  const fuelPct     = Math.min(100, (fuel.cost / totalCost) * 100);

  const toggleLayer = k => setLayers(p => ({ ...p, [k]: !p[k] }));
  const togglePOI   = k => setPoiFilter(p => ({ ...p, [k]: !p[k] }));

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'route',    label: 'Route' },
    { id: 'weather',  label: 'Weather' },
    { id: 'safety',   label: 'Safety' },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate('/dashboard')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <div className={styles.routeHeading}>
          <span className={styles.routePin} style={{ background: 'rgba(170,147,113,.15)', color: '#aa9371' }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="#aa9371"><circle cx="12" cy="12" r="8" /></svg>
            {route.source}
          </span>
          <span className={styles.routeArrow}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>
          </span>
          <span className={styles.routePin} style={{ background: 'rgba(109,191,138,.13)', color: '#6dbf8a' }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="#6dbf8a"><circle cx="12" cy="12" r="8" /></svg>
            {route.destination}
          </span>
        </div>
        <div className={styles.topBarRight}>
          <span className={styles.metaChip}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            {fd?.startDate}
          </span>
          <span className={styles.metaChip}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            {pax} {pax === 1 ? 'person' : 'people'}
          </span>
          <button
            className={styles.downloadBtn}
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await generateItinerary({ tripData, formData: fd, realPOIs });
              } catch (e) {
                console.error('PDF generation failed:', e);
              } finally {
                setDownloading(false);
              }
            }}
          >
            {downloading ? (
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:10, height:10, border:'2px solid rgba(0,0,0,0.3)', borderTopColor:'#000', borderRadius:'50%', animation:'spin 0.7s linear infinite', display:'inline-block' }}/>
                Generating…
              </span>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Itinerary PDF
              </>
            )}
          </button>
        </div>
      </header>

      <div className={styles.splitLayout}>
        <div className={styles.mapPane}>
          <MapContainer center={mapCenter} zoom={7} className={styles.leafletMap} zoomControl={false}>
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapFitter poly={poly} />
            <ZoomTracker onZoom={setZoom} />
            {!layers.traffic && poly.length > 1 && (
              <Polyline positions={poly} pathOptions={{ color: '#aa9371', weight: trafficW, opacity: .9 }} />
            )}
            {layers.traffic && segPoly.map((sp, i) => (
              <Polyline key={i} positions={sp.positions} pathOptions={{ color: sp.color, weight: trafficW, opacity: .92, lineCap: 'round', lineJoin: 'round' }}>
                <Tooltip sticky>
                  <div className={styles.ttWrap}>
                    <span className={styles.ttRoute}>{sp.start} → {sp.end}</span>
                    <span className={styles.ttStatus} style={{ color: sp.color }}>
                      {sp.traffic === 'HIGH' ? '● Heavy traffic' : sp.traffic === 'MODERATE' ? '● Moderate' : '● Clear road'}
                    </span>
                  </div>
                </Tooltip>
              </Polyline>
            ))}
            {tollPos.map((pos, i) => (
              <Marker key={`toll-${i}`} position={pos} icon={makeTollIcon()}>
                <Popup className={styles.tollPopup} maxWidth={160}>
                  <div className={styles.tollCard}>
                    <div className={styles.tollTitle}>Toll Booth</div>
                    {[['Car', 'car'], ['SUV', 'suv'], ['Bike', 'bike']].map(([label, v]) => (
                      <div key={v} className={styles.tollRow}><span>{label}</span><span>₹{estimateToll(dist / segments.length, v)}</span></div>
                    ))}
                  </div>
                </Popup>
              </Marker>
            ))}
            {route.cities?.map(city => {
              const w = weather?.find(w => w.city === city.name);
              const isSrc = city.role === 'source', isDest = city.role === 'destination';
              return (
                <Marker key={city.name} position={[city.lat, city.lon]} icon={isSrc ? PULSE_ICON : isDest ? DEST_ICON : MID_ICON}>
                  <Popup className={styles.cityPopup} maxWidth={240} minWidth={210}>
                    <div className={styles.cityCard}>
                      <div className={styles.cityTop}>
                        <span className={styles.cityCardName}>{city.name}</span>
                        <span className={styles.cityBadge} style={{
                          background: isSrc ? 'rgba(170,147,113,.2)' : isDest ? 'rgba(109,191,138,.18)' : 'rgba(214,198,172,.1)',
                          color: isSrc ? '#aa9371' : isDest ? '#6dbf8a' : '#d6c6ac',
                        }}>{isSrc ? 'Start' : isDest ? 'End' : 'Stop'}</span>
                      </div>
                      {w && (
                        <div className={styles.cityWeather}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /></svg>
                          {w.temperature}°C · {w.precipitation_probability}% rain · {w.windspeed} km/h
                        </div>
                      )}
                      <div className={styles.cityChips}>
                        {Object.entries(realPOIs[city.name] || {}).filter(([, ps]) => ps.length > 0).map(([type, ps]) => (
                          <span key={type} className={styles.cityChip} style={{ borderColor: POI_CONFIG[type].color, color: POI_CONFIG[type].color }}>
                            {ps.length} {POI_CONFIG[type].label}
                          </span>
                        ))}
                      </div>
                      <a className={styles.cityLink} href={`https://www.google.com/maps/search/${encodeURIComponent(city.name + ' India')}`} target="_blank" rel="noreferrer">Open in Google Maps →</a>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            {showMarkers && allMarkers.map(m => {
              const cfg = POI_CONFIG[m.type];
              return (
                <Marker key={m.key} position={m.pos} icon={makePOIIcon(m.type, zoom)}>
                  <Popup className={styles.poiPopup} maxWidth={280} minWidth={240} closeButton={true}>
                    <div className={styles.poiCard}>
                      <div className={styles.poiHead} style={{ borderColor: cfg.color }}>
                        <div className={styles.poiIconBox} style={{ background: cfg.bg, color: cfg.color }} dangerouslySetInnerHTML={{ __html: isvg(cfg.icon, 16, cfg.color) }} />
                        <div>
                          <div className={styles.poiName}>{m.name}</div>
                          {m.brand && <div className={styles.poiBrand}>{m.brand}</div>}
                          <div className={styles.poiType} style={{ color: cfg.color }}>{cfg.label}</div>
                        </div>
                      </div>
                      {m.phone && (
                        <div className={styles.poiContact}>
                          <Phone size={14} className={styles.poiContactLabel} />
                          <a href={`tel:${m.phone}`} className={styles.poiContactLink}>{m.phone}</a>
                        </div>
                      )}
                      {m.website && (
                        <div className={styles.poiContact}>
                          <Globe size={14} className={styles.poiContactLabel} />
                          <a href={m.website} target="_blank" rel="noreferrer" className={styles.poiContactLink}>{m.website}</a>
                        </div>
                      )}
                      {m.fee && <div className={styles.poiFee}><CreditCard size={14}/> Fee: {m.fee}</div>}
                      {m.hours && <div className={styles.poiHours}><Clock size={14}/> {m.hours}</div>}
                      <div className={styles.poiCity}><MapPin size={14}/> Near {m.city}</div>
                      <div className={styles.poiCoords}>Lat: {m.pos[0].toFixed(4)}, Lon: {m.pos[1].toFixed(4)}</div>
                      <div className={styles.poiActions}>
                        <a className={styles.poiBtnP} href={`https://www.google.com/maps/search/${encodeURIComponent(m.name)}/@${m.pos[0]},${m.pos[1]},15z`} target="_blank" rel="noreferrer">Search on Maps</a>
                        <a className={styles.poiBtnS} href={`https://www.google.com/maps/dir/?api=1&destination=${m.pos[0]},${m.pos[1]}`} target="_blank" rel="noreferrer">Get Directions</a>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          <div className={styles.mapControls}>
            <div className={styles.ctrlGroup}>
              <span className={styles.ctrlLabel}>Layers</span>
              {[['traffic', 'Traffic'], ['poi', 'Places'], ['tolls', 'Tolls']].map(([k, label]) => (
                <button key={k} className={`${styles.layerBtn} ${layers[k] ? styles.layerOn : ''}`} onClick={() => toggleLayer(k)}>
                  {label}{k === 'poi' && loadingPOIs && <span className={styles.spinDot} />}
                </button>
              ))}
            </div>
            {layers.poi && (
              <div className={styles.ctrlGroup}>
                <span className={styles.ctrlLabel}>Places</span>
                <div className={styles.poiGrid}>
                  {Object.entries(POI_CONFIG).map(([type, cfg]) => (
                    <button key={type} className={`${styles.poiBtn} ${poiFilter[type] ? styles.poiOn : ''}`} style={{ '--c': cfg.color }} onClick={() => togglePOI(type)}>
                      <span dangerouslySetInnerHTML={{ __html: isvg(cfg.icon, 10, poiFilter[type] ? '#000' : cfg.color) }} /> {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {layers.poi && zoom < 9 && <div className={styles.zoomHint}>Zoom in to see places</div>}
          </div>

          <div className={styles.mapLegend}>
            <span className={styles.lgItem}><span className={styles.dot} style={{ background: '#aa9371' }} /> Start</span>
            <span className={styles.lgItem}><span className={styles.dot} style={{ background: '#6dbf8a' }} /> End</span>
            {layers.traffic && <>
              <span className={styles.lgDivider} />
              <span className={styles.lgItem}><span className={styles.dot} style={{ background: '#6dbf8a' }} /> Low</span>
              <span className={styles.lgItem}><span className={styles.dot} style={{ background: '#e09a4a' }} /> Moderate</span>
              <span className={styles.lgItem}><span className={styles.dot} style={{ background: '#e05c5c' }} /> High</span>
            </>}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className={styles.detailPane}>
          <div className={styles.stickyHeader}>
            <div className={styles.stickyStats}>
              <div className={styles.stickyStat}>
                <span className={styles.stickyVal}>{dist} km</span>
                <span className={styles.stickyLbl}>Distance</span>
              </div>
              <div className={styles.stickySep} />
              <div className={styles.stickyStat}>
                <span className={styles.stickyVal}>{fmt(summary.total_trip_time_min)}</span>
                <span className={styles.stickyLbl}>Duration</span>
              </div>
              <div className={styles.stickySep} />
              <div className={styles.stickyStat}>
                <span className={styles.stickyVal}>₹{totalCost.toLocaleString()}</span>
                <span className={styles.stickyLbl}>Est. cost</span>
              </div>
              <div className={styles.stickySep} />
              <div className={styles.stickyStat}>
                <span className={styles.stickyVal} style={{ color: riskColor(overallRisk) }}>{overallRisk}/10</span>
                <span className={styles.stickyLbl}>Risk</span>
              </div>
            </div>
            <div className={styles.tabBar}>
              {TABS.map(tab => (
                <button key={tab.id} className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`} onClick={() => setActiveTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.detailScroll}>

            {activeTab === 'overview' && <>
              <Panel icon={<MapPinIcon />} title="Route Type Details">
                <div className={styles.routeTypeInfo}>
                  <div className={styles.routeTypeCard}>
                    <div className={styles.routeTypeLabel}>Selected Route Type</div>
                    <div className={styles.routeTypeValue}>{route.type?.charAt(0).toUpperCase() + route.type?.slice(1) || 'Balanced'}</div>
                    <div className={styles.routeTypeDesc}>
                      {route.type === 'quick' && <span style={{display:'flex',gap:4,alignItems:'center'}}><Zap size={14}/> Direct route with minimal stops. Fastest option.</span>}
                      {route.type === 'scenic' && <span style={{display:'flex',gap:4,alignItems:'center'}}><Mountain size={14}/> Scenic route with more stops. Enjoy the journey.</span>}
                      {route.type === 'balanced' && <span style={{display:'flex',gap:4,alignItems:'center'}}><Scale size={14}/> Balanced between speed and scenery.</span>}
                      {route.type === 'offroad' && <span style={{display:'flex',gap:4,alignItems:'center'}}><Map size={14}/> Off-road adventure route. Rough terrain.</span>}
                    </div>
                  </div>
                  <div className={styles.routeTypeStats}>
                    <div className={styles.routeTypeStat}>
                      <span className={styles.routeTypeStatLabel}>Cities on Route</span>
                      <span className={styles.routeTypeStatValue}>{route.ordered_cities?.length || 0}</span>
                    </div>
                    <div className={styles.routeTypeStat}>
                      <span className={styles.routeTypeStatLabel}>Total Distance</span>
                      <span className={styles.routeTypeStatValue}>{route.total_distance_km} km</span>
                    </div>
                    <div className={styles.routeTypeStat}>
                      <span className={styles.routeTypeStatLabel}>Estimated Time</span>
                      <span className={styles.routeTypeStatValue}>{fmt(summary.total_trip_time_min)}</span>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel icon={<MapPinIcon />} title={`Cities on Route · ${route.ordered_cities?.length || 0}`} noPad>
                <div className={styles.citiesList}>
                  {route.ordered_cities?.map((city, idx) => (
                    <div key={idx} className={styles.cityItem}>
                      <div className={styles.cityIndex}>{idx + 1}</div>
                      <div className={styles.cityName}>{city}</div>
                      {idx < (route.ordered_cities?.length || 0) - 1 && <div className={styles.cityArrow}>→</div>}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel icon={<CarIcon />} title="Vehicle & Fuel">
                <div className={styles.vRow}>
                  {[['car', 'Car'], ['suv', 'SUV'], ['bike', 'Bike'], ['bus', 'Bus']].map(([v, label]) => (
                    <button key={v} className={`${styles.vBtn} ${vehicle === v ? styles.vOn : ''}`} onClick={() => setVehicle(v)}>{label}</button>
                  ))}
                </div>
                <div className={styles.vInputRow}>
                  <label className={styles.vInputLabel}>
                    <span>Mileage</span>
                    <div className={styles.vInputGroup}>
                      <input type="number" value={mileage} min={5} max={50} className={styles.mInput} onChange={e => setMileage(+e.target.value)} />
                      <span className={styles.vUnit}>km/L</span>
                    </div>
                  </label>
                  <label className={styles.vInputLabel}>
                    <span>Fuel price</span>
                    <div className={styles.vInputGroup}>
                      <input type="number" value={fuelPrice} min={80} max={150} className={styles.mInput} onChange={e => setFuelPrice(+e.target.value)} />
                      <span className={styles.vUnit}>₹/L</span>
                    </div>
                  </label>
                </div>
              </Panel>

              <Panel icon={<CostIcon />} title="Trip Cost">
                <div className={styles.costGrid}>
                  <div className={styles.costBlock}>
                    <div className={styles.costEmoji}><Fuel size={24}/></div>
                    <div className={styles.costAmt}>₹{fuel.cost.toLocaleString()}</div>
                    <div className={styles.costLbl}>Fuel</div>
                    <div className={styles.costSub}>{fuel.litres}L</div>
                  </div>
                  <div className={styles.costBlock}>
                    <div className={styles.costEmoji}><Map size={24}/></div>
                    <div className={styles.costAmt}>₹{toll.toLocaleString()}</div>
                    <div className={styles.costLbl}>Tolls</div>
                    <div className={styles.costSub}>{vehicle.toUpperCase()}</div>
                  </div>
                  <div className={`${styles.costBlock} ${styles.costBlockTotal}`}>
                    <div className={styles.costEmoji}><CreditCard size={24}/></div>
                    <div className={styles.costTotalAmt}>₹{totalCost.toLocaleString()}</div>
                    <div className={styles.costLbl}>Total</div>
                    {pax > 1 && <div className={styles.costSub}>₹{perPerson.toLocaleString()} / person</div>}
                  </div>
                </div>
                <div className={styles.costBarWrap}>
                  <div className={styles.costBarTrack}>
                    <div className={styles.costBarFuel} style={{ width: `${fuelPct}%` }} />
                    <div className={styles.costBarToll} style={{ width: `${100 - fuelPct}%` }} />
                  </div>
                  <div className={styles.costBarLabels}>
                    <span style={{ color: '#aa9371' }}>Fuel {Math.round(fuelPct)}%</span>
                    <span style={{ color: '#e09a4a' }}>Tolls {Math.round(100 - fuelPct)}%</span>
                  </div>
                </div>
              </Panel>

              <Panel icon={<ClockIcon />} title="Time Breakdown">
                <StatRow label="Drive time" value={fmt(summary.travel_time_min)} />
                <StatRow label="Stop time"  value={fmt(summary.stop_time_min)} />
                <div className={styles.statDivider} />
                <StatRow label="Total trip time" value={fmt(summary.total_trip_time_min)} accent />
              </Panel>

              <Panel icon={<MLIcon />} title="ML Prediction" badge="Spark MLlib">
                <div className={styles.mlGrid}>
                  <div className={styles.mlBlock}>
                    <div className={styles.mlLbl}>ML predicted</div>
                    <div className={styles.mlVal}>{fmt(summary.travel_time_min)}</div>
                  </div>
                  <div className={styles.mlBlock}>
                    <div className={styles.mlLbl}>Physics baseline</div>
                    <div className={styles.mlBase}>{fmt(physicsTime)}</div>
                  </div>
                </div>
                <div className={styles.mlConfRow}>
                  <div className={styles.mlConfTrack}><div className={styles.mlConfFill} style={{ width: '82%' }} /></div>
                  <span className={styles.mlConfPct}>82% confidence</span>
                </div>
                <p className={styles.mlMeta}>RandomForest · {mlActive ? <span style={{ color: '#6dbf8a' }}>Live model active</span> : <span style={{ color: '#666' }}>Physics fallback</span>}</p>
              </Panel>

              <Panel icon={<LeafIcon />} title="Carbon Footprint">
                <div className={styles.carbonRow}>
                  <div>
                    <div className={styles.carbonVal}>{carbon}</div>
                    <div className={styles.carbonSub}>CO₂ · {vehicle.toUpperCase()} · {dist} km</div>
                  </div>
                  <div className={styles.carbonMeter}>
                    <div className={styles.carbonMeterBar}>
                      <div className={styles.carbonMeterFill} style={{ height: `${Math.min(100, (dist / 800) * 100)}%` }} />
                    </div>
                    <div className={styles.carbonScale}><span>High</span><span>Low</span></div>
                  </div>
                </div>
              </Panel>

              <Panel icon={<MtnIcon />} title="Elevation Profile">
                <ElevationChart data={elevation} />
              </Panel>
            </>}

            {activeTab === 'route' && <>
              <Panel icon={<ClockIcon />} title="When to Depart">
                <div className={styles.departBanner} style={{ borderColor: advice.color, background: `${advice.color}12` }}>
                  <div className={styles.departDot} style={{ background: advice.color }} />
                  <p className={styles.departMsg}>{advice.msg}</p>
                </div>
              </Panel>

              <Panel icon={<MapPinIcon />} title={`Route Segments · ${segments.length} legs`} noPad>
                {segments.map((seg, idx) => {
                  const tc = TRAFFIC_COLORS[seg.traffic_level] || '#d6c6ac';
                  return (
                    <div key={idx} className={styles.segment}>
                      <div className={styles.segColorBar} style={{ background: tc }} />
                      <div className={styles.segContent}>
                        <div className={styles.segTop}>
                          <span className={styles.segRoute}>
                            {seg.start}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>
                            {seg.end}
                          </span>
                          <span className={styles.segDist}>{seg.distance_km} km</span>
                        </div>
                        <div className={styles.segMeta}>
                          <span>{fmt(seg.travel_time_min)}</span>
                          <span className={styles.segDot}>·</span>
                          <span>{seg.avg_speed_kmh} km/h</span>
                          <span className={styles.segDot}>·</span>
                          <span className={styles.trafficTag} style={{ color: tc, borderColor: `${tc}55`, background: `${tc}14` }}>{seg.traffic_level}</span>
                          {seg.data_source?.includes('ml') && <span className={styles.tagML}>ML</span>}
                        </div>
                        <div className={styles.stopRow}>
                          <span className={styles.stopChip}><Fuel size={14}/> {seg.stops?.fuel || 0} fuel</span>
                          <span className={styles.stopChip}><Utensils size={14}/> {seg.stops?.restaurants || 0} food</span>
                          {(seg.stops?.hospitals || 0) > 0 && <span className={`${styles.stopChip} ${styles.stopHosp}`}><PlusCircle size={14}/> {seg.stops.hospitals}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Panel>

              {stay && (
                <Panel icon={<HotelIcon />} title="Overnight Stay Suggestion">
                  <div className={styles.stayCard}>
                    <div className={styles.stayCity}><MapPin size={14} style={{ marginRight: 4 }}/> {stay.city}</div>
                    <p className={styles.stayNote}>{stay.note}</p>
                    <a className={styles.stayLink} href={`https://www.google.com/maps/search/hotels+in+${encodeURIComponent(stay.city)}`} target="_blank" rel="noreferrer">Find hotels in {stay.city} →</a>
                  </div>
                </Panel>
              )}
            </>}

            {activeTab === 'weather' && <>
              {weather && weather.length > 0 ? (
                <>
                  <Panel icon={<WxIcon />} title={`Weather Report · ${summary.date}`}>
                    <div className={styles.weatherStack}>
                      {weather.map(w => (
                        <div key={w.city} className={styles.weatherCard}>
                          <div className={styles.weatherLeft}>
                            <WeatherIcon rain={w.precipitation_probability} wind={w.windspeed} />
                            <div className={styles.weatherInfo}>
                              <div className={styles.weatherCity}>{w.city}</div>
                              {w.note && <div className={styles.weatherNote}>{w.note}</div>}
                            </div>
                          </div>
                          <div className={styles.weatherRight}>
                            <div className={styles.weatherTemp}>{w.temperature}°C</div>
                            <div className={styles.weatherStats}>
                              <span className={styles.weatherStat}>
                                <Droplets size={14} className={styles.weatherStatIcon} />
                                <span>{w.precipitation_probability}%</span>
                              </span>
                              <span className={styles.weatherStat}>
                                <Wind size={14} className={styles.weatherStatIcon} />
                                <span>{w.windspeed} km/h</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel icon={<WxIcon />} title="Weather Alerts & Tips">
                    <div className={styles.weatherTips}>
                      {weather.map(w => {
                        const alerts = [];
                        if (w.precipitation_probability > 70) alerts.push({ type: 'rain', msg: 'Heavy rain expected - drive carefully' });
                        if (w.windspeed > 50) alerts.push({ type: 'wind', msg: 'Strong winds - be cautious' });
                        if (w.temperature < 5) alerts.push({ type: 'cold', msg: 'Cold weather - check tire pressure' });
                        if (w.temperature > 35) alerts.push({ type: 'heat', msg: 'High temperature - stay hydrated' });
                        
                        return (
                          <div key={w.city} className={styles.weatherTipCity}>
                            <div className={styles.weatherTipCityName}>{w.city}</div>
                            {alerts.length > 0 ? (
                              <div className={styles.weatherAlerts}>
                                {alerts.map((alert, i) => (
                                  <div key={i} className={`${styles.weatherAlert} ${styles[`alert${alert.type}`]}`}>
                                    <span className={styles.alertIcon}>
                                      {alert.type === 'rain' && <CloudRain size={16}/>}
                                      {alert.type === 'wind' && <Wind size={16}/>}
                                      {alert.type === 'cold' && <Thermometer size={16}/>}
                                      {alert.type === 'heat' && <Sun size={16}/>}
                                    </span>
                                    <span className={styles.alertMsg}>{alert.msg}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={styles.weatherGood}>✓ Good conditions for travel</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                </>
              ) : (
                <div className={styles.emptyTab}>
                  <WxIcon />
                  <p>No weather data available.</p>
                </div>
              )}
            </>}

            {activeTab === 'safety' && <>
              <Panel icon={<ShieldIcon />} title="Road Risk Score">
                <div className={styles.riskLayout}>
                  <div className={styles.riskLeft}>
                    <RiskDial score={overallRisk} />
                    <div className={styles.riskLabel} style={{ color: riskColor(overallRisk) }}>{riskLabel(overallRisk)}</div>
                  </div>
                  <div className={styles.riskBars}>
                    {segments.map((seg, i) => {
                      const rs = riskScore(seg.traffic_level, seg.weather_risk);
                      return (
                        <div key={i} className={styles.riskRow}>
                          <span className={styles.riskSeg}>{seg.start}→{seg.end}</span>
                          <div className={styles.riskBarOuter}><div className={styles.riskBarInner} style={{ width: `${rs * 10}%`, background: riskColor(rs) }} /></div>
                          <span className={styles.riskNum} style={{ color: riskColor(rs) }}>{rs}/10</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Panel>

              <Panel icon={<PhoneIcon />} title="Emergency Contacts">
                {emergency.length === 0
                  ? <p className={styles.emptyNote}>No contacts for this route.</p>
                  : emergency.map((e, i) => (
                    <div key={i} className={styles.emergItem}>
                      <div className={styles.emergState}>{e.state}</div>
                      <div className={styles.emergNums}>
                        <div className={styles.emergNum}><span className={styles.emergLbl}>Highway</span><a href={`tel:${e.highway}`}>{e.highway}</a></div>
                        <div className={styles.emergNum}><span className={styles.emergLbl}>Police</span><a href={`tel:${e.police}`}>{e.police}</a></div>
                        <div className={styles.emergNum}><span className={styles.emergLbl}>Ambulance</span><a href={`tel:${e.ambulance}`}>{e.ambulance}</a></div>
                      </div>
                    </div>
                  ))
                }
              </Panel>

              <Panel icon={<CheckIcon />} title="Pre-departure Checklist">
                {checklist.map((seg, i) => (
                  <div key={i} className={styles.clSeg}>
                    <div className={styles.clSegTitle}>{seg.segment}</div>
                    {seg.items.map((item, j) => <CItem key={j} text={item} />)}
                  </div>
                ))}
              </Panel>
            </>}

          </div>
        </div>
      </div>

      {/* ──────────── NOTIFICATIONS ──────────── */}
      <NotificationToast queue={queue} onDismiss={dismiss} />
    </div>
  );
}

// ── Panel icons ───────────────────────────────────────────────────────────────
const CarIcon    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>;
const ClockIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
const CostIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v12m-3-6h6" /></svg>;
const ShieldIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
const MLIcon     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M12 7v10M7 18l5-9 5 9" /></svg>;
const MtnIcon    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 20l5.5-10L13 16l3-5 5 9H3z" /></svg>;
const LeafIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 8C8 10 5.9 16.17 3.82 19.34a1 1 0 1 0 1.66 1.1C7.11 17.5 8.43 16 12 16c6 0 9-5 9-9a14 14 0 0 0-4-1z" /></svg>;
const MapPinIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
const WxIcon     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /></svg>;
const HotelIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 22V11l9-9 9 9v11" /><path d="M9 22V12h6v10" /></svg>;
const PhoneIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.65 2H6.7a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
const CheckIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
