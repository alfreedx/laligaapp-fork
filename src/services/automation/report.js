/**
 * Informe diario.
 *   buildReportModel  → cálculos (qué hacer hoy, once, ofertas, oportunidades…)
 *   renderMarkdown    → informe-fantasy.md (para Claude)
 *   renderReportHtml  → documento visual para el PDF (reportHtml.js)
 *   json              → plantilla.json con todos los datos
 * Funciones puras sobre los datos de dataLoader + el log del auto-mercado.
 */
import {
  buildSquadRows, buildMarketRows, buildRivalRows, buildMoneyRows,
} from '../analytics/rows';
import { bestLineup } from '../analytics/forecast';
import { buildBidStats, recentActivity, suggestedBid } from '../analytics/rivalIntel';
import { buildProtectionPlan } from '../analytics/protection';
import { VARIANTS, bestVariant } from '../analytics/backtest';
import { renderReportHtml } from './reportHtml';
import {
  isNum, M, SM, K, N, PCT, dt, STATUS_ICON, LINE_LABEL, trendArrow, venueIcon as venue,
} from './reportFormat';

const H48 = 48 * 3600 * 1000;

// ------------------------------------------------------------------ modelo
export const buildReportModel = (data, { settings = {}, autoMarketLog = [], leagueName = '', clauseSpend = null, backtests = {} } = {}) => {
  const days = settings.projectionDays || 5;
  const now = new Date();
  const common = { ledger: data.ledger, resolveTrend: data.resolveTrend, rateMode: 'avg3' };

  const squad = buildSquadRows({ ...common, team: data.myTeam });
  const market = buildMarketRows({ ...common, market: data.market, ownerByPlayer: data.ownerByPlayer })
    .filter((r) => r.sellerId !== data.myTeam?.managerId);
  const rivals = buildRivalRows({ ...common, teams: data.teams, myTeamId: data.myTeamId });
  const money = buildMoneyRows({ teams: data.teams, ledger: data.ledger, myTeam: data.myTeam, myMoney: data.myMoney, initialMoney: settings.initialMoney, clauseSpend });
  const bidStats = buildBidStats({ ledger: data.ledger, trendById: data.trendById || (() => null), now });
  const recent = recentActivity(data.ledger, { days: 7, now });

  const sum = (rows, k) => rows.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
  const ranking = [...data.teams].sort((a, b) => (b.teamPoints || 0) - (a.teamPoints || 0));
  const myRank = ranking.findIndex((t) => t.teamId === data.myTeamId) + 1;
  const myPts = data.myTeam?.teamPoints ?? 0;
  const closest = myRank === 1 ? ranking[1] : ranking[0];
  const gap = closest ? myPts - (closest.teamPoints || 0) : null;

  // Ofertas recibidas: mejor oferta por jugador y ganancia si se acepta
  const offerFrom = (o) => o?.buyerTeam?.manager?.managerName || o?.buyer?.managerName || o?.team?.manager?.managerName || 'LaLiga';
  const offers = squad.map((r) => {
    const best = [...(data.myOffers?.get(r.id) || [])].filter((o) => isNum(o.money)).sort((a, b) => b.money - a.money)[0];
    if (!best) return null;
    return { r, money: best.money, from: offerFrom(best), expires: best.expirationDate, gain: isNum(r.buyPrice) ? best.money - r.buyPrice : null };
  }).filter(Boolean).sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity));
  const goodOffers = offers.filter((o) => isNum(o.gain) && o.gain > 0);

  // Oportunidades: mercado de LaLiga + cláusulas de rivales abiertas o en ≤ 48 h
  const candidates = [
    // Mercado: para ganarlo hay que sobrepujar → la ganancia se calcula sobre el coste
    // esperado (precio + sobrepuja mediana de la liga), no sobre el precio de salida.
    ...market.filter((r) => !r.sellerId).map((r) => {
      const ov = bidStats.overall;
      const expectedCost = isNum(r.buyPrice) && ov?.n >= 5 && isNum(ov.median)
        ? r.buyPrice * (1 + Math.max(0, ov.median) / 100) : r.buyPrice;
      return {
        ...r, origin: 'Mercado', from: 'LaLiga', price: r.buyPrice, cost: expectedCost,
        available: `hasta ${dt(r.expiration)}`, bid: suggestedBid(r.buyPrice, ov),
        gainN: isNum(r.valueN) && isNum(expectedCost) ? r.valueN - expectedCost : null,
        gainNLaLiga: isNum(r.laLigaN) && isNum(expectedCost) ? r.laLigaN - expectedCost : null,
      };
    }),
    ...rivals
      .filter((r) => !r.isShielded && isNum(r.clause) && (r.clauseIsOpen || (r.clauseOpenAt && new Date(r.clauseOpenAt) - now <= H48)))
      .map((r) => ({
        ...r, origin: 'Cláusula', from: r.owner, price: r.clause, cost: r.clause,
        available: r.clauseIsOpen ? 'abierta' : `se abre ${dt(r.clauseOpenAt)}`,
        gainN: isNum(r.valueN) ? r.valueN - r.clause : null,
        gainNLaLiga: isNum(r.laLigaN) ? r.laLigaN - r.clause : null,
      })),
  ].map((r) => ({
    ...r,
    // Puja máxima rentable: lo máximo que puedes pagar sin perder dinero si lo vendes a
    // LaLiga (mejor oferta, +10 %) dentro de N días al ritmo actual.
    maxBid: isNum(r.laLigaN) ? Math.floor(r.laLigaN / 100_000) * 100_000 : null,
    roiN: isNum(r.gainNLaLiga) && isNum(r.cost) && r.cost > 0 ? (r.gainNLaLiga / r.cost) * 100 : null,
  })).map((r) => ({
    ...r,
    // La puja habitual para ganarlo ya no deja beneficio
    bidTooHigh: r.origin === 'Mercado' && isNum(r.bid) && isNum(r.maxBid) && r.bid > r.maxBid,
  }));
  const econ = candidates.filter((r) => isNum(r.gainNLaLiga) && r.gainNLaLiga >= 500_000).sort((a, b) => b.gainNLaLiga - a.gainNLaLiga).slice(0, 6);
  // Se ordena de nuevo más abajo, cuando se sabe a quién mejora cada uno
  const sport = candidates.filter((r) => r.status === 'ok' && r.positionId !== 5 && isNum(r.xp)).sort((a, b) => b.xp - a.xp).slice(0, 12);
  const clauseSoon = candidates.filter((r) => r.origin === 'Cláusula' && !r.clauseIsOpen).sort((a, b) => new Date(a.clauseOpenAt) - new Date(b.clauseOpenAt));

  // Once recomendado, banquillo (mejor suplente por línea) y fichajes que lo mejoran
  const lineup = bestLineup(squad);
  const benchByLine = [1, 2, 3, 4].map((pos) => lineup.bench.find((p) => p.positionId === pos)).filter(Boolean);
  const doubtful = lineup.starters.filter((p) => p.playProb < 0.6);
  // Referencia para "a quién mejora": tu alineación GUARDADA (si se pudo leer); si no, la recomendada
  const savedStarters = squad.filter((r) => data.currentLineupIds?.has(r.id) && r.positionId !== 5);
  const usingSaved = savedStarters.length >= 10;
  const reference = usingSaved ? savedStarters : lineup.starters;
  const worst = {};
  reference.filter((p) => isNum(p.xp)).forEach((p) => { if (!worst[p.positionId] || p.xp < worst[p.positionId].xp) worst[p.positionId] = p; });
  // Para cada candidato: a qué titular de tu alineación superaría y por cuántos puntos
  candidates.forEach((r) => {
    const w = worst[r.positionId];
    r.improves = r.positionId !== 5 && w && isNum(r.xp) && r.xp > w.xp + 0.3 ? { name: w.name, delta: r.xp - w.xp } : null;
  });
  // Deportivas: primero las que mejoran tu once (por puntos ganados), luego el resto por xP
  sport.sort((a, b) => ((b.improves?.delta ?? -1) - (a.improves?.delta ?? -1)) || (b.xp - a.xp));
  sport.splice(6);
  // Solo fichajes realistas: con tu saldo, o con tu saldo + aceptar las ofertas que te dan ganancia
  const cash = isNum(data.myMoney) ? Math.max(0, data.myMoney) : 0;
  const cashWithOffers = cash + goodOffers.reduce((s, o) => s + o.money, 0);
  const upgrades = candidates
    .filter((r) => r.positionId !== 5 && isNum(r.xp) && worst[r.positionId] && r.xp > worst[r.positionId].xp + 0.5)
    .filter((r) => isNum(r.price) && r.price <= cashWithOffers)
    .map((r) => ({ r, replaces: worst[r.positionId], delta: r.xp - worst[r.positionId].xp, affordable: r.price <= cash }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 4);

  // Protección de mi plantilla
  const protection = buildProtectionPlan({
    squad, money, starterIds: new Set(lineup.starters.map((p) => p.id)), costFactor: settings.clauseRaiseCostFactor ?? 0.5, now,
  });
  const mustProtect = protection.filter((p) => p.action === 'Proteger' || p.action === 'Valorar');
  const acceptable = protection.filter((p) => p.action === 'Asumible');

  // Rivales (ordenados por dinero estimado)
  const rivalsTable = [...money].sort((a, b) => (b.calibrated ?? -Infinity) - (a.calibrated ?? -Infinity)).map((m) => {
    const t = data.teams.find((x) => x.teamId === m.id);
    const b = bidStats.byManager.get(t?.managerId) || {};
    const act = recent.get(t?.managerId) || {};
    return { ...m, bids: b.n || 0, overbid: b.median ?? null, buys7: act.buys || 0, sells7: act.sells || 0 };
  });

  // Precisión de la previsión (última jornada evaluada)
  const evWeeks = Object.keys(backtests || {}).map(Number).sort((a, b) => b - a);
  const accuracy = evWeeks.length ? { week: evWeeks[0], last: backtests[evWeeks[0]], ranked: bestVariant(backtests), weeks: evWeeks.length } : null;

  // ---- 🎯 Qué hacer hoy (priorizado) ----
  const actions = [];
  const start = data.weekInfo?.openingWeekDate;
  if (isNum(data.myMoney) && data.myMoney < 0) {
    actions.push({ kind: 'risk', icon: '💸', text: `**Saldo negativo (${M(data.myMoney)})**: vende antes de ${dt(start)} o puntuarás 0.` });
  }
  goodOffers.slice(0, 3).forEach((o) => actions.push({
    kind: 'money', icon: '💰', text: `Acepta la oferta de ${o.from} por **${o.r.name}**: ${M(o.money)} (**${SM(o.gain)}** sobre lo que pagaste) · caduca ${dt(o.expires)}`,
  }));
  mustProtect.filter((p) => p.action === 'Proteger').slice(0, 2).forEach((p) => actions.push({
    kind: 'risk', icon: '🛡️', text: `Protege a **${p.name}**: cláusula ${p.clauseIsOpen ? 'abierta' : `se abre ${dt(p.clauseOpenAt)}`} (${M(p.clause)}) y ${p.canPay.length} rival(es) pueden pagarla → ${p.rivalsExcluded === p.canPay.length && p.targetClause ? `sube la cláusula a ${M(p.targetClause)}` : 'blíndalo'}.`,
  }));
  squad.filter((r) => r.status === 'injured' || r.status === 'suspended').slice(0, 2).forEach((r) => actions.push({
    kind: 'risk', icon: STATUS_ICON[r.status], text: `**${r.name}** ${r.status === 'injured' ? 'lesionado' : 'sancionado'}: no lo alinees${isNum(r.latentGainLaLiga) && r.latentGainLaLiga > 0 ? ' y valora venderlo' : ''}.`,
  }));
  upgrades.slice(0, 2).forEach(({ r, replaces, delta, affordable }) => actions.push({
    kind: 'buy', icon: '➕', text: `Ficha a **${r.name}** (${r.origin === 'Cláusula' ? `cláusula de ${r.from}, ${r.available}` : `mercado, ${r.available}`}) por ${M(r.price)}: **+${N(delta)} pts** por jornada frente a ${replaces.name}${affordable ? '' : ' (aceptando antes alguna oferta)'}.`,
  }));
  econ.filter((r) => !upgrades.some((u) => u.r.id === r.id) && r.price <= cashWithOffers && r.gainNLaLiga >= 1_000_000).slice(0, 2).forEach((r) => actions.push({
    kind: 'buy', icon: '📈', text: `Inversión: **${r.name}** (${r.origin === 'Cláusula' ? `cláusula de ${r.from}, ${r.available}` : `mercado${r.bid ? `, puja ~${M(r.bid)}` : ''}, no pases de ${M(r.maxBid)}`}) → **${SM(r.gainNLaLiga)}** (${PCT(r.roiN)}) en ${days} días vendiéndolo a LaLiga.`,
  }));
  actions.push({
    kind: 'lineup', icon: '🧠', text: `Alinea **${lineup.formation}** con **${lineup.captain?.name || '—'}** de capitán${lineup.coach ? ` y ${lineup.coach.name} de entrenador` : ''} (${N(lineup.total)} pts previstos). En la app: Mi Alineación → Cargar recomendada.${doubtful.length ? ` Ojo con ${doubtful.map((p) => p.name).join(', ')} (puede${doubtful.length > 1 ? 'n' : ''} no jugar).` : ''}`,
  });

  return {
    now, days, leagueName, settings, autoMarketLog,
    week: data.week, weekStart: start, trendsOk: data.trendsOk,
    kpis: {
      rank: myRank, points: myPts, gap, closest: closest?.managerName,
      money: data.myMoney, teamValue: sum(squad, 'value'),
      gainLaLiga: sum(squad, 'latentGainLaLiga'), gainLaLigaN: data.trendsOk ? sum(squad, 'gainNLaLiga') : null,
    },
    actions: actions.slice(0, 7),
    lineup, benchByLine, doubtful, usingSaved,
    offers, goodOffers,
    mustProtect, acceptable,
    econ, sport, clauseSoon, upgrades,
    squad: [...squad].sort((a, b) => (a.positionId - b.positionId) || (b.value - a.value)),
    rivalsTable, bidOverall: bidStats.overall,
    accuracy,
    // para JSON / trabajo diario
    _raw: { squad, rivals, money, bidStats, protection },
  };
};

// --------------------------------------------------------------- markdown
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`),
].join('\n');

export const renderMarkdown = (m) => {
  const md = [];
  const k = m.kpis;
  md.push(`# Informe Fantasy${m.leagueName ? ` — ${m.leagueName}` : ''} · ${m.now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`);
  md.push(`Jornada ${m.week ?? '?'}${m.weekStart ? ` · empieza ${dt(m.weekStart)}` : ''} · generado ${m.now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`);
  md.push('');
  md.push(`**${k.rank || '?'}º · ${k.points} pts**${isNum(k.gap) ? ` (${k.gap >= 0 ? '+' : ''}${k.gap} vs ${k.closest})` : ''} · Saldo **${M(k.money)}** · Equipo **${M(k.teamValue)}** · Si vendes a LaLiga hoy: **${SM(k.gainLaLiga)}**${isNum(k.gainLaLigaN) ? ` (en ${m.days}d: ${SM(k.gainLaLigaN)})` : ''}`);
  if (!m.trendsOk) md.push('\n⚠️ Sin datos de futbolfantasy hoy: no hay tendencias ni proyecciones.');
  md.push('');

  md.push('## 🎯 Qué hacer hoy');
  m.actions.forEach((a) => md.push(`- ${a.icon} ${a.text}`));
  md.push('');

  const L = m.lineup;
  md.push(`## 🧠 Tu once (${L.formation}) · ${N(L.total)} pts previstos`);
  [4, 3, 2, 1].forEach((pos) => {
    const line = L.starters.filter((p) => p.positionId === pos).sort((a, b) => b.xp - a.xp);
    if (line.length) md.push(`- **${LINE_LABEL[pos]}**: ${line.map((p) => `${L.captain?.id === p.id ? '© ' : ''}${p.name} ${N(p.xp)}${p.playProb < 0.6 ? ' ⚠️' : ''}`).join(' · ')}`);
  });
  md.push(`- **Entrenador**: ${L.coach?.name || '—'} · **Banquillo**: ${m.benchByLine.map((p) => p.name).join(', ') || '—'}`);
  md.push('');

  if (m.goodOffers.length) {
    md.push('## 📩 Ofertas que te dan ganancia');
    md.push(table(['Jugador', 'Oferta', 'Ganancia', 'De', 'Caduca'],
      m.goodOffers.map((o) => [o.r.name, M(o.money), SM(o.gain), o.from, dt(o.expires)])));
    const rest = m.offers.length - m.goodOffers.length;
    if (rest > 0) md.push(`\n${rest} oferta(s) más con pérdida (no compensa aceptarlas).`);
    md.push('');
  }

  if (m.mustProtect.length || m.acceptable.length) {
    md.push('## 🛡️ Protección frente a cláusulas');
    if (m.mustProtect.length) {
      md.push(table(['Jugador', 'Cláusula', 'Estado', 'Rivales que pueden', 'Qué hacer'],
        m.mustProtect.map((p) => [p.name, M(p.clause), p.clauseIsOpen ? 'abierta' : `se abre ${dt(p.clauseOpenAt)}`, p.canPay.length, p.reason.replace(/\*\*/g, '')])));
    }
    if (m.acceptable.length) md.push(`\nExpuestos pero asumibles (suplentes, no pierdes dinero): ${m.acceptable.map((p) => p.name).join(', ')}.`);
    md.push('');
  }

  md.push(`## 💰 Oportunidades económicas (vender a LaLiga en ${m.days} días)`);
  md.push('_En mercado, la ganancia ya descuenta la sobrepuja típica de la liga._');
  md.push(m.econ.length ? table(['Jugador', 'Origen', 'Precio', 'Puja máx. rentable', `Gana en ${m.days}d`, 'Rentab.', 'Tendencia/día', 'Disponible'],
    m.econ.map((r) => [`${r.name} (${r.position})`, r.origin === 'Mercado' ? 'Mercado' : `Cláusula ${r.from}`, `${M(r.price)}${r.bid ? ` · puja ~${M(r.bid)}` : ''}`, `${M(r.maxBid)}${r.bidTooHigh ? ' ⚠️' : ''}`, SM(r.gainNLaLiga), PCT(r.roiN), `${trendArrow(r.growthAvg3)} ${K(r.growthAvg3)}`, r.available]))
    : 'Ninguna con ganancia esperada.');
  md.push(`_Puja máx. rentable = lo máximo que puedes pagar sin perder dinero vendiéndolo a LaLiga en ${m.days} días. ⚠️ = la puja habitual de tu liga ya la supera._`);
  md.push('');

  md.push(`## ⚽ Oportunidades deportivas (más puntos esperados · comparado con tu alineación ${m.usingSaved ? 'actual' : 'recomendada'})`);
  md.push(m.sport.length ? table(['Jugador', 'Origen', 'Precio', 'xP', 'Mejora a', 'Próximo (juega)', 'Puja máx. rentable', `Rentab. ${m.days}d`, 'Disponible'],
    m.sport.map((r) => [
      `${r.name} (${r.position})`, r.origin === 'Mercado' ? 'Mercado' : `Cláusula ${r.from}`, M(r.price), N(r.xp),
      r.improves ? `${r.improves.name} (+${N(r.improves.delta)})` : 'no mejora',
      `${r.nextRival ? `${venue(r)} ${r.nextRival} ` : ''}(${Math.round((r.playProb ?? 0) * 100)} %)`,
      M(r.maxBid), PCT(r.roiN), r.available,
    ]))
    : '—');
  md.push('');

  if (m.clauseSoon.length) {
    md.push('## 🔓 Cláusulas que se abren en 48 h');
    md.push(table(['Se abre', 'Jugador', 'Dueño', 'Cláusula', `Gana en ${m.days}d`, 'xP'],
      m.clauseSoon.map((r) => [dt(r.clauseOpenAt), `${r.name} (${r.position})`, r.from, M(r.clause), SM(r.gainNLaLiga), N(r.xp)])));
    md.push('');
  }

  md.push('## 📋 Tu plantilla');
  md.push(table(['Jugador', 'Valor', 'Tendencia/día', 'Ganancia LaLiga hoy', `en ${m.days}d`, 'xP', 'Notas'],
    m.squad.map((r) => [
      `${r.name} (${r.position})`, M(r.value), `${trendArrow(r.growthAvg3)} ${K(r.growthAvg3)}`, SM(r.latentGainLaLiga), SM(r.gainNLaLiga), N(r.xp),
      [STATUS_ICON[r.status], r.inMarket ? '🏷️' : '', r.isShielded ? '🛡️' : r.clauseIsOpen ? '🔓' : ''].filter(Boolean).join(' '),
    ])));
  md.push('');

  md.push('## 🕵️ Rivales');
  if (m.bidOverall?.n) md.push(`Para ganar una puja en tu liga se suele pagar **${PCT(m.bidOverall.median)}** sobre el valor (agresivo: ${PCT(m.bidOverall.p75)}).\n`);
  md.push(table(['Manager', 'Puesto', 'Dinero estimado', 'Sobrepuja típica', 'Compras / ventas 7d'],
    m.rivalsTable.map((r) => [`${r.isMe ? '⭐ ' : ''}${r.name}`, `${r.position ?? '—'}º · ${r.points ?? '—'} pts`, M(r.calibrated), r.bids ? PCT(r.overbid) : '—', `${r.buys7} / ${r.sells7}`])));
  md.push('');

  if (m.accuracy) {
    const a = m.accuracy;
    const mae = a.last.variants?.modelo?.mae;
    md.push(`## 📏 ¿Acertó la previsión? (jornada ${a.week})`);
    if (a.last.lineup) md.push(`Tu once: previsto **${N(a.last.lineup.predicted)}** → real **${N(a.last.lineup.actual)}** pts.`);
    if (isNum(mae)) md.push(`Error medio por jugador: ${N(mae, 1)} pts. ${a.ranked[0] ? `Modelo más fiable hasta ahora: ${VARIANTS[a.ranked[0].variant]}.` : ''}`);
    md.push('');
  }

  const am = m.autoMarketLog;
  const listed = am.filter((l) => l.status === 'listed').length;
  const errors = am.filter((l) => l.status === 'error');
  md.push('---');
  md.push(`_Auto-mercado: ${!m.settings.autoMarketEnabled ? 'desactivado' : m.settings.autoMarketDryRun ? `simulación (${am.length} jugador/es)` : `${listed} puesto(s) en venta${errors.length ? `, ${errors.length} error(es)` : ''}`}. Importes en millones de €. "LaLiga" = mejor oferta posible de LaLiga (valor +10 %). xP = puntos esperados la próxima jornada. Dinero de rivales estimado a partir de la actividad._`);
  return md.join('\n');
};

// ------------------------------------------------------------------- JSON
const buildJson = (m) => {
  const pick = (r) => ({
    id: r.id, nombre: r.name, posicion: r.position, equipo: r.team, estado: r.status,
    precioCompra: r.buyPrice, valor: r.value, ofertaLaLigaMax: r.laLigaMax,
    gananciaLatente: r.latentGain, gananciaLatenteLaLiga: r.latentGainLaLiga,
    crecimientoDiario: r.dailyGrowth, crecimientoMedio3d: r.growthAvg3,
    [`valorEn${m.days}d`]: r.valueN, [`ganancia${m.days}dLaLiga`]: r.gainNLaLiga,
    puntos: r.points, media: r.averagePoints, xP: r.xp, probJugar: r.playProb, rival: r.nextRival,
    clausula: r.clause, clausulaAbierta: r.clauseIsOpen, clausulaSeAbre: r.clauseOpenAt, blindado: r.isShielded,
    enMercado: r.inMarket, viaCompra: r.acquiredVia, fechaCompra: r.acquiredAt,
  });
  const L = m.lineup;
  return {
    generado: m.now.toISOString(),
    liga: m.leagueName || null,
    jornada: m.week,
    inicioJornada: m.weekStart || null,
    posicion: m.kpis.rank || null,
    puntos: m.kpis.points,
    saldo: m.kpis.money,
    queHacerHoy: m.actions.map((a) => a.text.replace(/\*\*/g, '')),
    jugadores: m._raw.squad.filter((r) => r.positionId !== 5).map(pick),
    entrenadores: m._raw.squad.filter((r) => r.positionId === 5).map(pick),
    onceRecomendado: {
      formacion: L.formation, puntosPrevistos: L.total, capitan: L.captain?.name || null, entrenador: L.coach?.name || null,
      titulares: L.starters.map((p) => ({ nombre: p.name, posicion: p.position, xP: p.xp, probJugar: p.playProb, rival: p.nextRival, casa: p.nextIsHome })),
      banquillo: m.benchByLine.map((p) => ({ nombre: p.name, posicion: p.position, xP: p.xp })),
    },
    fichajesQueMejoranElOnce: m.upgrades.map(({ r, replaces, delta }) => ({ jugador: r.name, posicion: r.position, origen: r.origin, de: r.from, xP: r.xp, sustituyeA: replaces.name, mejora: delta, precio: r.price, disponible: r.available })),
    ofertasRecibidas: m.offers.map((o) => ({ jugador: o.r.name, precioCompra: o.r.buyPrice, valor: o.r.value, oferta: o.money, de: o.from, gananciaSiAceptas: o.gain, expira: o.expires })),
    oportunidadesEconomicas: m.econ.map((r) => ({ ...pick(r), origen: r.origin, de: r.from, precio: r.price, costeEsperado: r.cost, pujaSugerida: r.bid || null, pujaMaxRentable: r.maxBid, rentabilidadPct: r.roiN, disponible: r.available })),
    oportunidadesDeportivas: m.sport.map((r) => ({ ...pick(r), origen: r.origin, de: r.from, precio: r.price, mejoraA: r.improves?.name || null, mejoraPts: r.improves?.delta ?? null, pujaMaxRentable: r.maxBid, rentabilidadPct: r.roiN, disponible: r.available })),
    clausulasProximas48h: m.clauseSoon.map((r) => ({ ...pick(r), dueño: r.owner, seAbre: r.clauseOpenAt, precio: r.clause })),
    proteccion: m._raw.protection.map((p) => ({ jugador: p.name, titular: p.isStarter, xP: p.xp, clausula: p.clause, abierta: p.clauseIsOpen, seAbre: p.clauseOpenAt, puedenPagarla: p.canPay, recomendacion: p.action, motivo: p.reason, subirA: p.targetClause, costeEstimado: p.raiseCost })),
    rivales: m.rivalsTable.map((r) => ({ manager: r.name, yo: r.isMe, puesto: r.position, puntos: r.points, dineroEstimado: r.calibrated, valorEquipo: r.teamValue, sobrepujaMedianaPct: r.overbid, compras7d: r.buys7, ventas7d: r.sells7 })),
    sobrepujaLiga: { muestras: m.bidOverall?.n, medianaPct: m.bidOverall?.median, p75Pct: m.bidOverall?.p75 },
    autoMercado: m.autoMarketLog,
  };
};

// ------------------------------------------------------------- principal
export const buildDailyReport = (data, opts = {}) => {
  const model = buildReportModel(data, opts);
  return {
    model,
    markdown: renderMarkdown(model),
    html: renderReportHtml(model),
    json: buildJson(model),
    counts: { econ: model.econ.length, clauseSoon: model.clauseSoon.length, alerts: model.actions.filter((a) => a.kind === 'risk').length },
    // Para el trabajo diario: previsión a guardar y cláusulas a vigilar
    predictionRows: [...model._raw.squad, ...model._raw.rivals],
    lineupIds: model.lineup.starters.map((p) => p.id),
    captainId: model.lineup.captain?.id || null,
    clauseWatch: model.clauseSoon.map((r) => ({ id: r.id, name: r.name, owner: r.from, openAt: r.clauseOpenAt, clause: r.clause, xp: r.xp, gainNLaLiga: r.gainNLaLiga })),
  };
};

/** Captura compacta del día (histórico local, no se sube a Drive). */
export const buildSnapshot = (data) => ({
  date: new Date().toISOString(),
  week: data.week,
  myMoney: data.myMoney,
  teams: data.teams.map((t) => ({
    teamId: t.teamId, managerId: t.managerId, managerName: t.managerName, teamValue: t.teamValue, points: t.teamPoints,
    players: t.players.map((p) => ({
      id: String(p.playerMaster?.id), value: p.playerMaster?.marketValue, points: p.playerMaster?.points,
      clause: p.buyoutClause, clauseLockedUntil: p.buyoutClauseLockedEndTime, shielded: !!p.isShielded,
    })),
  })),
  market: data.market.map((m) => ({ id: String(m.playerMaster?.id), price: m.salePrice, value: m.playerMaster?.marketValue, expiration: m.expirationDate })),
});
