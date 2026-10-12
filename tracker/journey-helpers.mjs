export const eventTime = event => Date.parse(event?.actualTime || event?.plannedTime || '');
export function nextCall(stops = [], now = Date.now()) {
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    if (stop.status === 'PASSING') continue;
    const arrival = stop.arrivals?.find(e => !e.cancelled);
    const departure = stop.departures?.find(e => !e.cancelled);
    if (arrival && eventTime(arrival) >= now) return { index, stop, event: arrival, label: 'Next stop', action: 'Arrives' };
    if (departure && eventTime(departure) >= now) return { index, stop, event: departure, label: arrival && eventTime(arrival) < now ? 'At station · timetable estimate' : 'Upcoming departure', action: 'Departs' };
  }
  return null;
}
export function platform(event) {
  const actual = event?.actualTrack, planned = event?.plannedTrack;
  return { value: actual || planned || 'Not reported', changed: Boolean(actual && planned && actual !== planned), planned };
}
export function internationalDeparture(d) {
  return d.product?.type === 'TRAIN' && (/^(ICE|THA|TGV|EST|EC|EN|NJ|INT)/i.test(d.product?.categoryCode || '') || /NS\s*Int/i.test(d.product?.operatorCode || '') || d.routeStations?.some(s => /^\d{7}$/.test(String(s.uicCode)) && !String(s.uicCode).startsWith('84')));
}
