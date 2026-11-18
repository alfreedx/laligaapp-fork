import { lastSlot, isRunDue, currentEdition, scheduleTimes, editionForTime } from './schedule';

const settings = { dailyReportEnabled: true, runTimes: ['19:10', '18:50'] };
const at = (s) => new Date(`2026-11-19T${s}:00`);

test('ediciones según el reseteo de las 19:00', () => {
  expect(editionForTime({ h: 18, m: 50 })).toBe('cierre');
  expect(editionForTime({ h: 19, m: 10 })).toBe('apertura');
});

test('última hora programada pasada', () => {
  expect(lastSlot(at('18:55'), settings)).toMatchObject({ time: '18:50', edition: 'cierre' });
  expect(lastSlot(at('19:30'), settings)).toMatchObject({ time: '19:10', edition: 'apertura' });
  // a las 10:00 la más reciente es la de ayer a las 19:10
  const s = lastSlot(at('10:00'), settings);
  expect(s.time).toBe('19:10');
  expect(s.at.getDate()).toBe(18);
});

test('toca ejecutar en cada hora, una sola vez', () => {
  expect(isRunDue({ lastSuccessAt: at('18:51').toISOString() }, settings, at('18:59'))).toBe(false);
  expect(isRunDue({ lastSuccessAt: at('18:51').toISOString() }, settings, at('19:11'))).toBe(true);
  expect(isRunDue({ lastSuccessAt: at('19:12').toISOString() }, settings, at('23:00'))).toBe(false);
  expect(isRunDue({}, { ...settings, dailyReportEnabled: false }, at('19:11'))).toBe(false);
});

test('edición actual y compatibilidad con el ajuste antiguo', () => {
  expect(currentEdition(at('18:52'), settings)).toBe('cierre');
  expect(scheduleTimes({ runHour: 19, runMinute: 5 })).toEqual(['19:05']);
});
