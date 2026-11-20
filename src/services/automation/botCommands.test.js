import {
  parseCommand, findPlayers, clauseReply, buildClauseIcs, icsFileName, remindersReply, ambiguousReply, statusReply,
} from './botCommands';

test('parsea comandos (con @bot, alias y sin acentos)', () => {
  expect(parseCommand('/clausula Raphinha')).toEqual({ command: 'clausula', args: 'Raphinha' });
  expect(parseCommand('/cláusula@MiBot  Iñaki Williams ')).toEqual({ command: 'clausula', args: 'Iñaki Williams' });
  expect(parseCommand('/start')).toEqual({ command: 'ayuda', args: '' });
  expect(parseCommand('hola')).toBeNull();
});

const rows = [
  { id: '1', name: 'Iñaki Williams', fullName: 'Iñaki Williams Arthuer' },
  { id: '2', name: 'Nico Williams', fullName: 'Nicholas Williams Arthuer' },
  { id: '3', name: 'Raphinha', fullName: 'Raphael Dias Belloli' },
];

test('busca jugadores sin acentos; exacto gana', () => {
  expect(findPlayers(rows, 'raphinha').map((r) => r.id)).toEqual(['3']);
  expect(findPlayers(rows, 'williams').map((r) => r.id)).toEqual(['1', '2']);
  expect(findPlayers(rows, 'inaki').map((r) => r.id)).toEqual(['1']);
  expect(findPlayers(rows, '')).toEqual([]);
  expect(ambiguousReply(findPlayers(rows, 'williams'), 'williams')).toContain('/clausula Nico Williams');
});

test('respuesta: estado de la cláusula y si te llega', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const r = { name: 'Raphinha', position: 'DEL', team: 'Barcelona', owner: 'Timaker<07>', value: 180e6, clause: 220.1e6, clauseOpenAt: '2026-11-21T18:22:00Z' };
  const t = clauseReply(r, { myMoney: 58e6, now, reminder: true });
  expect(t).toContain('Timaker&lt;07&gt;');
  expect(t).toContain('220,1 M');
  expect(t).toContain('en 1 d 6 h');
  expect(t).toContain('No te llega');
  expect(t).toContain('2 min antes');
  expect(clauseReply({ ...r, clauseIsOpen: true }, { now })).toContain('Abierta ahora');
  expect(clauseReply({ ...r, clauseLockedUntil: r.clauseOpenAt }, { now })).toContain('Bloqueada por la jornada');
  expect(clauseReply({ ...r, isShielded: true }, { now })).toContain('Blindado');
});

test('evento de calendario con dos alarmas', () => {
  const ics = buildClauseIcs({ id: '3', name: 'Raphinha', owner: 'Ana, B', clause: 220e6, openAt: '2026-11-21T18:22:00Z', now: new Date('2026-11-20T12:00:00Z') });
  expect(ics).toContain('DTSTART:20261121T182200Z');
  expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
  expect(ics).toContain('TRIGGER:-PT2M');
  expect(ics).toContain('Ana\\, B');
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  expect(icsFileName('Iñaki Williams')).toBe('clausula-inaki-williams.ics');
});

test('lista de avisos pendientes', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  expect(remindersReply([], now)).toContain('No tienes');
  expect(remindersReply([{ name: 'X', owner: 'Ana', openAt: '2026-11-21T10:00:00Z' }, { name: 'Y', openAt: '2026-11-19T10:00:00Z' }], now)).toContain('X (Ana)');
});

test('/estado: último informe, avisos y solo los problemas del registro', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const t = statusReply({
    state: { lastSuccessAt: '2026-11-20T10:00:00Z', lastEdition: 'apertura', nextKickoff: '2026-11-20T20:00:00Z' },
    reminders: [{ openAt: '2026-11-21T10:00:00Z' }, { openAt: '2026-11-19T10:00:00Z' }],
    logLines: ['2026-11-20T09:00:00Z INFO [informe] ok', '2026-11-20T09:01:00Z ERROR [bot] fallo <x>'],
    now,
  });
  expect(t).toContain('apertura');
  expect(t).toContain('pendientes: 1');
  expect(t).toContain('fallo &lt;x&gt;');
  expect(t).not.toContain('[informe] ok');
  expect(statusReply({ logLines: [] })).toContain('Sin errores');
});
