export function trainStyle(type = '') {
  const category = String(type).toUpperCase();
  if (/^(ICE|THA|TGV|EST|EC|EN|NJ|INT)/.test(category)) return { key: 'international', label: 'International', color: '#be3450' };
  if (/^IC/.test(category)) return { key: 'intercity', label: 'Intercity', color: '#b27900' };
  if (/^(SPR|SLT|SNG)/.test(category)) return { key: 'sprinter', label: 'Sprinter', color: '#1672bf' };
  return { key: 'regional', label: 'Other passenger', color: '#147c70' };
}
export function journeyGeometry(stops = [], stations = []) {
  const lookup = new Map(stations.map(s => [String(s.UICCode), s]));
  const points = [], segments = []; let current = [];
  for (const item of stops) {
    const station = lookup.get(String(item.stop?.uicCode));
    const valid = s => s && s.lat != null && s.lng != null && s.lat !== '' && s.lng !== '' && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)) && Math.abs(Number(s.lat)) <= 90 && Math.abs(Number(s.lng)) <= 180;
    const position = valid(item.stop) ? item.stop : valid(station) ? station : null;
    if (!position) { if (current.length > 1) segments.push(current); current = []; continue; }
    const pos = [Number(position.lat), Number(position.lng)];
    current.push(pos);
    points.push({ pos, name: item.stop?.name || station?.namen?.lang || 'Route point', passing: item.status === 'PASSING' });
  }
  if (current.length > 1) segments.push(current);
  return { points, segments };
}
