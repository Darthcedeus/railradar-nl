export const HAGUE = [52.0705, 4.3007];
export const finite = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function normalizeVehicles(data) {
  if (!Array.isArray(data?.payload?.treinen)) throw new Error('Unexpected NS vehicle response');
  const seen = new Set();
  return data.payload.treinen.flatMap(t => {
    const number = String(t.treinNummer ?? t.ritId ?? '');
    if (!/^\d{1,8}$/.test(number) || seen.has(number) || !finite(t.lat) || !finite(t.lng)) return [];
    const pos = [Number(t.lat), Number(t.lng)];
    if (pos[0] < 50 || pos[0] > 54 || pos[1] < 3 || pos[1] > 8) return [];
    seen.add(number);
    return [{ id: number, number, type: String(t.type || 'Train'), name: `${t.type || 'Train'} ${number}`, speed: finite(t.snelheid) ? Number(t.snelheid) : null, pos, source: String(t.bron || 'NS') }];
  });
}
