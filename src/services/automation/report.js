/**
 * Informe diario: genera `informe-fantasy.md` (para leer tú o Claude) y
 * `plantilla.json` (datos estructurados). Función pura sobre los datos de
 * dataLoader + el log del auto-mercado.
 */
import {
  buildSquadRows, buildMarketRows, buildRivalRows, buildMoneyRows, buildSalesRows,
} from '../analytics/rows';

const H48 = 48 * 3600 * 1000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const M = (v, d = 2) => (isNum(v) ? `${(v / 1e6).toFixed(d).replace('.', ',')}` : '—');
const SM = (v, d = 2) => (isNum(v) ? `${v >= 0 ? '+' : ''}${M(v, d)}` : '—');
const K = (v) => (isNum(v) ? `${v >= 0 ? '+' : ''}${Math.round(v / 1e3)}K` : '—');
const N = (v, d = 1) => (isNum(v) ? v.toFixed(d).replace('.', ',') : '—');
const dt = (v) => (v ? new Date(v).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS = { ok: '', injured: '🚑 lesionado', doubtful: '❓ duda', suspended: '🟥 sancionado', not_available: '⛔ no disponible' };
const esc = (s) => String(s ?? '').replace(/\|/g, '/');

const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
].join('\n');

const clauseText = (r) => (r.isShielded ? 'blindado' : r.clauseIsOpen ? 'ABIERTA' : `se abre ${dt(r.clauseOpenAt)}`);

/**
 * @param {object} data   salida de loadLeagueData
 * @param {object} opts   { settings, autoMarketLog, playerNames, leagueName }
 */
export const buildDailyReport = (data, { settings = {}, autoMarketLog = [], playerNames = new Map(), leagueName = '' } = {}) => {
  const days = settings.projectionDays || 5;
  const now = new Date();
  const common = { ledger: data.ledger, resolveTrend: data.resolveTrend, rateMode: 'avg3' };

  const squad = buildSquadRows({ ...common, team: data.myTeam });
  const market = buildMarketRows({ ...common, market: data.market, ownerByPlayer: data.ownerByPlayer })
    .filter((r) => r.sellerId !== data.myTeam?.managerId);
  const rivals = buildRivalRows({ ...common, teams: data.teams, myTeamId: data.myTeamId });
  const money = buildMoneyRows({ teams: data.teams, ledger: data.ledger, myTeam: data.myTeam, myMoney: data.myMoney, initialMoney: settings.initialMoney });
  const sales = buildSalesRows({ ledger: data.ledger, managerId: data.myTeam?.managerId, playerNames }).slice(0, 8);

  const sum = (rows, k) => rows.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
  const ranking = [...data.teams].sort((a, b) => (b.teamPoints || 0) - (a.teamPoints || 0));
  const myRank = ranking.findIndex((t) => t.teamId === data.myTeamId) + 1;
  const myPts = data.myTeam?.teamPoints ?? 0;
  const rival = myRank === 1 ? ranking[1] : ranking[0];
  const gap = rival ? myPts - (rival.teamPoints || 0) : null;

  // ---- avisos ----
  const alerts = [];
  if (isNum(data.myMoney) && data.myMoney < 0) {
    alerts.push(`💸 **Saldo negativo (${M(data.myMoney)} M)** — si empieza la jornada${data.weekInfo?.openingWeekDate ? ` (${dt(data.weekInfo.openingWeekDate)})` : ''} en negativo puntúas 0. Vende antes.`);
  }
  squad.filter((r) => r.status && r.status !== 'ok').forEach((r) => alerts.push(`${STATUS[r.status] || r.status}: **${r.name}**`));
  const richRivals = money.filter((m) => !m.isMe);
  const exposed = squad.filter((r) => r.clauseIsOpen && !r.isShielded && isNum(r.clause))
    .map((r) => ({ r, can: richRivals.filter((m) => isNum(m.calibrated) && m.calibrated >= r.clause).length }))
    .filter((x) => x.can > 0)
    .sort((a, b) => (b.r.averagePoints ?? 0) - (a.r.averagePoints ?? 0));
  if (exposed.length) {
    alerts.push(`🔓 Cláusula abierta en ${exposed.length} jugador(es) que algún rival podría pagar: ${exposed.map((x) => `**${x.r.name}** (${M(x.r.clause)} M, ${x.can} rival/es)`).join(', ')}. Valora blindar o subir la cláusula de los importantes.`);
  }

  // Ofertas recibidas (mejor oferta por jugador) con la ganancia si se acepta
  const offerName = (o) => o?.buyerTeam?.manager?.managerName || o?.buyer?.managerName || o?.team?.manager?.managerName || 'LaLiga';
  const offers = squad
    .map((r) => {
      const list = data.myOffers?.get(r.id) || [];
      const best = [...list].filter((o) => isNum(o.money)).sort((a, b) => b.money - a.money)[0];
      if (!best) return null;
      return {
        r, best, from: offerName(best),
        vsValue: isNum(r.value) && r.value > 0 ? ((best.money - r.value) / r.value) * 100 : null,
        gain: isNum(r.buyPrice) ? best.money - r.buyPrice : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity));
  const offersNoDetail = squad.filter((r) => r.inMarket && r.marketOffers > 0 && !data.myOffers?.has(r.id));

  // ---- sugerencias de venta: bajan y aún hay ganancia con la oferta de LaLiga ----
  const sellNow = squad
    .filter((r) => isNum(r.growthAvg3) && r.growthAvg3 < 0)
    .sort((a, b) => a.growthAvg3 - b.growthAvg3)
    .slice(0, 6);

  // ---- oportunidades ----
  const econ = market.filter((r) => isNum(r.gainNLaLiga) && r.gainNLaLiga > 0)
    .sort((a, b) => b.gainNLaLiga - a.gainNLaLiga).slice(0, 8);
  const sport = market.filter((r) => r.status === 'ok' && isNum(r.averagePoints))
    .sort((a, b) => b.averagePoints - a.averagePoints).slice(0, 8);
  const clauseSoon = rivals.filter((r) => !r.isShielded && !r.clauseIsOpen && r.clauseOpenAt && new Date(r.clauseOpenAt) - now <= H48)
    .sort((a, b) => ((b.clauseGainN ?? -Infinity) - (a.clauseGainN ?? -Infinity)) || (new Date(a.clauseOpenAt) - new Date(b.clauseOpenAt)))
    .slice(0, 12);
  const clauseOpen = rivals.filter((r) => !r.isShielded && r.clauseIsOpen && isNum(r.clauseGainN) && r.clauseGainN > 0)
    .sort((a, b) => b.clauseGainN - a.clauseGainN).slice(0, 8);
  const clauseSport = rivals.filter((r) => !r.isShielded && (r.clauseIsOpen || (r.clauseOpenAt && new Date(r.clauseOpenAt) - now <= H48)) && r.status === 'ok' && isNum(r.averagePoints))
    .sort((a, b) => b.averagePoints - a.averagePoints).slice(0, 6);

  const md = [];
  md.push(`# Informe LaLiga Fantasy${leagueName ? ` — ${leagueName}` : ''}`);
  md.push(`Generado: ${now.toLocaleString('es-ES')} · Jornada ${data.week ?? '?'}${data.weekInfo?.openingWeekDate ? ` (empieza ${dt(data.weekInfo.openingWeekDate)})` : ''}`);
  md.push('');
  md.push(`> Informe automático de la app (fork de LaLigaApp). Importes en **millones de €**. "LaLiga" = oferta máxima de LaLiga (valor +10 %). Proyecciones a ${days} días con la media de crecimiento de los últimos 3 días (futbolfantasy). Dinero de rivales: estimación desde la actividad (inicial ${M(settings.initialMoney ?? 100e6, 0)} M) ajustada con el desvío de mi saldo real.`);
  md.push('');
  md.push('## Resumen');
  md.push(`- Posición: **${myRank || '?'}º** con **${myPts} pts**${gap !== null ? ` (${gap >= 0 ? '+' : ''}${gap} sobre ${rival?.managerName})` : ''}`);
  md.push(`- Saldo: **${M(data.myMoney)} M** · Valor plantilla: **${M(sum(squad, 'value'))} M** · Jugadores: ${squad.length}`);
  md.push(`- Ganancia latente: ${SM(sum(squad, 'latentGain'))} M · con oferta LaLiga: ${SM(sum(squad, 'latentGainLaLiga'))} M · en ${days}d LaLiga: ${data.trendsOk ? `${SM(sum(squad, 'gainNLaLiga'))} M` : '—'}`);
  if (!data.trendsOk) md.push('- ⚠️ No se pudieron cargar las tendencias de futbolfantasy: sin proyecciones.');
  md.push('');

  md.push('## ⚠️ Avisos');
  md.push(alerts.length ? alerts.map((a) => `- ${a}`).join('\n') : '- Nada urgente.');
  md.push('');

  if (offers.length || offersNoDetail.length) {
    md.push('## 📩 Ofertas recibidas (mejor oferta por jugador)');
    if (offers.length) {
      md.push(table(['Jugador', 'Compra', 'Valor', 'Oferta', 'vs valor', 'Ganancia si aceptas', 'De', 'Expira'],
        offers.map((o) => [o.r.name, M(o.r.buyPrice), M(o.r.value), M(o.best.money), isNum(o.vsValue) ? `${o.vsValue >= 0 ? '+' : ''}${N(o.vsValue)} %` : '—', SM(o.gain), o.from, dt(o.best.expirationDate)])));
    }
    if (offersNoDetail.length) md.push(`\nCon oferta pero sin detalle disponible: ${offersNoDetail.map((r) => r.name).join(', ')}.`);
    md.push('');
  }

  md.push('## Mi plantilla');
  md.push(table(
    ['Jugador', 'Pos', 'Equipo', 'Estado', 'Compra', 'Valor', 'Δ1d', 'Δ3d/día', 'G.lat LaLiga', `G.${days}d LaLiga`, 'Pts', 'Media', 'Mercado', 'Cláusula'],
    [...squad].sort((a, b) => (a.positionId - b.positionId) || (b.value - a.value)).map((r) => [
      r.name, r.position, r.team, STATUS[r.status] || '', M(r.buyPrice), M(r.value), K(r.dailyGrowth), K(r.growthAvg3),
      SM(r.latentGainLaLiga), SM(r.gainNLaLiga), r.points ?? '—', N(r.averagePoints, 2),
      r.inMarket ? `sí (hasta ${dt(r.marketExpiration)})` : 'no', clauseText(r),
    ]),
  ));
  md.push('');

  if (sellNow.length) {
    md.push('## 📉 Bajando (valorar vender / aceptar oferta de LaLiga)');
    md.push(table(['Jugador', 'Valor', 'Δ3d/día', 'G.lat LaLiga', 'Media'],
      sellNow.map((r) => [r.name, M(r.value), K(r.growthAvg3), SM(r.latentGainLaLiga), N(r.averagePoints, 2)])));
    md.push('');
  }

  md.push(`## 💰 Mercado hoy — oportunidades económicas (top ${econ.length})`);
  md.push(econ.length ? table(['Jugador', 'Pos', 'Vende', 'Precio', 'Δ1d', 'Δ3d/día', `G.${days}d`, `G.${days}d LaLiga`, 'Media', 'Pujas', 'Expira'],
    econ.map((r) => [r.name, r.position, r.seller, M(r.buyPrice), K(r.dailyGrowth), K(r.growthAvg3), SM(r.gainN), SM(r.gainNLaLiga), N(r.averagePoints, 2), r.bids, dt(r.expiration)]))
    : 'Ninguna con ganancia esperada positiva.');
  md.push('');

  md.push(`## ⚽ Mercado hoy — oportunidades deportivas (top ${sport.length})`);
  md.push(sport.length ? table(['Jugador', 'Pos', 'Vende', 'Precio', 'Media', 'Pts', 'Pts/M', 'Δ3d/día'],
    sport.map((r) => [r.name, r.position, r.seller, M(r.buyPrice), N(r.averagePoints, 2), r.points ?? '—', N(r.pointsPerMillion, 2), K(r.growthAvg3)]))
    : '—');
  md.push('');

  md.push('## 🔓 Cláusulas que se abren en las próximas 48 h');
  md.push(clauseSoon.length ? table(['Jugador', 'Pos', 'Dueño', 'Se abre', 'Cláusula', 'Valor', `Tu g.${days}d LaLiga`, 'Media'],
    clauseSoon.map((r) => [r.name, r.position, r.owner, dt(r.clauseOpenAt), M(r.clause), M(r.value), SM(r.clauseGainN), N(r.averagePoints, 2)]))
    : 'Ninguna.');
  md.push('');

  md.push('## 🟢 Cláusulas ya abiertas y rentables');
  md.push(clauseOpen.length ? table(['Jugador', 'Pos', 'Dueño', 'Cláusula', 'Valor', `Tu g.${days}d LaLiga`, 'Media'],
    clauseOpen.map((r) => [r.name, r.position, r.owner, M(r.clause), M(r.value), SM(r.clauseGainN), N(r.averagePoints, 2)]))
    : 'Ninguna con ganancia esperada positiva.');
  md.push('');

  if (clauseSport.length) {
    md.push('## 🎯 Cláusulas (abiertas o en 48 h) con mejor media de puntos');
    md.push(table(['Jugador', 'Pos', 'Dueño', 'Cláusula', 'Estado cláusula', 'Media', 'Pts'],
      clauseSport.map((r) => [r.name, r.position, r.owner, M(r.clause), clauseText(r), N(r.averagePoints, 2), r.points ?? '—'])));
    md.push('');
  }

  md.push('## 🏦 Dinero estimado de los rivales');
  md.push(table(['Manager', 'Pos', 'Pts', 'Valor equipo', 'Dinero base', 'Dinero ajustado', 'Poder de compra'],
    [...money].sort((a, b) => (b.calibrated ?? -Infinity) - (a.calibrated ?? -Infinity)).map((m) => [
      `${m.isMe ? '⭐ ' : ''}${m.name}`, m.position ?? '—', m.points ?? '—', M(m.teamValue), M(m.estimated), M(m.calibrated), M(m.maxBuyingPower),
    ])));
  md.push('');

  md.push('## 🤖 Auto-mercado');
  if (!settings.autoMarketEnabled) md.push('Desactivado.');
  else if (!autoMarketLog.length) md.push('Todos los jugadores ya estaban en el mercado (o excluidos).');
  else {
    md.push(settings.autoMarketDryRun ? '_Modo simulación: no se ha hecho ninguna acción real._' : '');
    md.push(table(['Jugador', 'Precio', 'Resultado'],
      autoMarketLog.map((l) => [l.name, M(l.price), l.status === 'listed' ? '✅ puesto en venta' : l.status === 'simulated' ? '🧪 simulado' : `❌ ${l.error || 'error'}`])));
  }
  md.push('');

  if (sales.length) {
    md.push('## Mis últimas ventas');
    md.push(table(['Jugador', 'Compra', 'Venta', 'Ganancia', 'A quién', 'Fecha'],
      sales.map((s) => [s.name, M(s.buyPrice), M(s.sellPrice), SM(s.effectiveGain), s.soldTo === 'LaLiga' ? 'LaLiga' : (data.teams.find((t) => t.managerId === s.soldTo)?.managerName || s.soldTo), dt(s.sellDate)])));
    md.push('');
  }

  // ---- JSON estructurado ----
  const pick = (r) => ({
    id: r.id, nombre: r.name, posicion: r.position, equipo: r.team, estado: r.status,
    precioCompra: r.buyPrice, valor: r.value, ofertaLaLigaMax: r.laLigaMax,
    gananciaLatente: r.latentGain, gananciaLatenteLaLiga: r.latentGainLaLiga,
    crecimientoDiario: r.dailyGrowth, crecimientoMedio3d: r.growthAvg3,
    [`valorEn${days}d`]: r.valueN, [`ganancia${days}dLaLiga`]: r.gainNLaLiga,
    puntos: r.points, media: r.averagePoints,
    clausula: r.clause, clausulaAbierta: r.clauseIsOpen, clausulaSeAbre: r.clauseOpenAt, blindado: r.isShielded,
    enMercado: r.inMarket, viaCompra: r.acquiredVia, fechaCompra: r.acquiredAt,
  });

  const json = {
    generado: now.toISOString(),
    liga: leagueName || null,
    jornada: data.week,
    inicioJornada: data.weekInfo?.openingWeekDate || null,
    posicion: myRank || null,
    puntos: myPts,
    saldo: data.myMoney,
    jugadores: squad.filter((r) => r.positionId !== 5).map(pick),
    entrenadores: squad.filter((r) => r.positionId === 5).map(pick),
    avisos: alerts,
    ofertasRecibidas: offers.map((o) => ({ jugador: o.r.name, precioCompra: o.r.buyPrice, valor: o.r.value, oferta: o.best.money, de: o.from, gananciaSiAceptas: o.gain, expira: o.best.expirationDate })),
    mercadoEconomico: econ.map((r) => ({ ...pick(r), vende: r.seller, precio: r.buyPrice, expira: r.expiration })),
    mercadoDeportivo: sport.map((r) => ({ ...pick(r), vende: r.seller, precio: r.buyPrice })),
    clausulasProximas48h: clauseSoon.map((r) => ({ ...pick(r), dueño: r.owner, tuGananciaLaLiga: r.clauseGainN })),
    clausulasAbiertasRentables: clauseOpen.map((r) => ({ ...pick(r), dueño: r.owner, tuGananciaLaLiga: r.clauseGainN })),
    dineroRivales: money.map((m) => ({ manager: m.name, yo: m.isMe, dineroBase: m.estimated, dineroAjustado: m.calibrated, valorEquipo: m.teamValue, puntos: m.points })),
    autoMercado: autoMarketLog,
  };

  return { markdown: md.join('\n'), json, counts: { econ: econ.length, clauseSoon: clauseSoon.length, alerts: alerts.length } };
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
