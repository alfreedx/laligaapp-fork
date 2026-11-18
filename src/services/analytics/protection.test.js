import { buildProtectionPlan } from './protection';

const now = new Date('2026-11-18T20:00:00Z');
const money = [
  { name: 'Yo', isMe: true, calibrated: 50e6 },
  { name: 'Rico', isMe: false, calibrated: 40e6 },
  { name: 'Medio', isMe: false, calibrated: 20e6 },
  { name: 'Pobre', isMe: false, calibrated: 1e6 },
];

test('clasifica jugadores expuestos', () => {
  const squad = [
    { id: 'a', name: 'Titular', clause: 15e6, clauseIsOpen: true, xp: 7, buyPrice: 10e6 },
    { id: 'b', name: 'Suplente gana', clause: 5e6, clauseIsOpen: true, xp: 1, buyPrice: 3e6 },
    { id: 'c', name: 'Caro', clause: 60e6, clauseIsOpen: true, xp: 8, buyPrice: 50e6 },
    { id: 'd', name: 'Blindado', clause: 5e6, clauseIsOpen: true, isShielded: true },
    { id: 'e', name: 'Lejos', clause: 5e6, clauseIsOpen: false, clauseOpenAt: '2026-11-25T20:00:00Z' },
  ];
  // valor 60 M → coste máximo razonable 30 M: subir a 42 M cuesta 13,5 M → deja fuera a todos
  squad[0].value = 60e6;
  const plan = buildProtectionPlan({ squad, money, starterIds: new Set(['a']), now });
  expect(plan.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  const a = plan[0];
  expect(a.action).toBe('Proteger');
  expect(a.canPay).toEqual(['Rico', 'Medio']);
  expect(a.targetClause).toBe(42e6);           // 40 M × 1,05
  expect(a.raiseCost).toBe((42e6 - 15e6) * 0.5);
  expect(a.rivalsExcluded).toBe(2);

  // valor 20 M → máx. 10 M: 21 M (Medio) cuesta 3 M ok; 42 M (Rico) cuesta 13,5 M no → blindar
  const plan2 = buildProtectionPlan({ squad: [{ ...squad[0], value: 20e6 }], money, starterIds: new Set(['a']), now });
  expect(plan2[0].targetClause).toBe(21e6);
  expect(plan2[0].rivalsExcluded).toBe(1);
  expect(plan2[0].reason).toMatch(/blindar/);
  expect(plan[1].action).toBe('Asumible');
  expect(plan[2].action).toBe('Sin riesgo');
});
