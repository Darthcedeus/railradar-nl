// Use the journey endpoint, not the nearest station or the next calling point.
export function destinationStop(data) {
  const stops = data?.payload?.stops;
  if (!Array.isArray(stops)) return null;
  const last = stops.findLast(s => s && s.status !== 'PASSING');
  if (!last || !Array.isArray(last.arrivals) || !last.arrivals.some(e => e && !e.cancelled)) return null;
  // An ongoing departure means the response does not establish the terminus.
  if (last.departures?.some(e => e && !e.cancelled)) return null;
  return last.stop || null;
}
export function destinationName(stop, stations = []) {
  const station = Array.isArray(stations) && stations.find(s => stop?.uicCode != null && String(s.UICCode) === String(stop.uicCode));
  const name = station?.namen?.lang || station?.namen?.middel || stop?.name;
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || null : null;
}
// One resolver per polling cycle: share lookups across devices without keeping
// stale destinations when a train number is reused or the route changes.
export function destinationResolver(ns, timeoutMs = 5000) {
  const journeys = new Map();
  let stations;
  const read = async path => {
    const response = await ns(new Request(`https://internal${path}`));
    if (!response.ok) throw Error('Destination unavailable');
    return response.json();
  };
  return train => {
    if (!journeys.has(train)) {
      const lookup = async () => {
        const stop = destinationStop(await read(`/api/journey?train=${encodeURIComponent(train)}`));
        if (!stop) return null;
        const name = destinationName(stop);
        if (name) return name;
        stations ??= read('/api/stations');
        return destinationName(stop, (await stations)?.payload);
      };
      journeys.set(train, (async () => {
        let timer;
        try {
          return await Promise.race([lookup(), new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
        } catch { return null; }
        finally { clearTimeout(timer); }
      })());
    }
    return journeys.get(train);
  };
}
