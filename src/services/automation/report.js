/**
 * Informe diario: genera `informe-fantasy.md` (para leer tú o Claude) y
 * `plantilla.json` (datos estructurados). Función pura sobre los datos de
 * dataLoader + el log del auto-mercado.
 */
import {
  buildSquadRows, buildMarketRows, buildRivalRows, buildMoneyRows, buildSalesRows,
} from '../analytics/rows';
import { bestLineup } from '../analytics/forecast';
import { buildBidStats, recentActivity, suggestedBid } from '../analytics/rivalIntel';

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
export const buildDailyReport = (data, { settings = {}, autoMarketLog = [], playerNames = new Map(), leagueName = '', clauseSpend = null } = {}) => {
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
  const P = (v) => (isNum(v) ? `${v >= 0 ? '+' : ''}${N(v)} %` : '—');
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

  // ---- oportunidades: mercado de LaLiga (sin jugadores puestos por otros
  // managers) + jugadores de rivales con cláusula abierta o que se abre en ≤ 48 h.
  // Precio de referencia: precio de salida (mercado) o cláusula.
  const candidates = [
    ...market.filter((r) => !r.sellerId).map((r) => ({
      ...r, origin: 'Mercado', from: 'LaLiga', price: r.buyPrice,
      available: `hasta ${dt(r.expiration)}`, availableAt: now.toISOString(),
      bid: suggestedBid(r.buyPrice, bidStats.overall),
    })),
    ...rivals
      .filter((r) => !r.isShielded && isNum(r.clause) && (r.clauseIsOpen || (r.clauseOpenAt && new Date(r.clauseOpenAt) - now <= H48)))
      .map((r) => ({
        ...r, origin: 'Cláusula', from: r.owner, price: r.clause,
        available: r.clauseIsOpen ? 'abierta' : `se abre ${dt(r.clauseOpenAt)}`,
        availableAt: r.clauseIsOpen ? now.toISOString() : r.clauseOpenAt,
        gainN: isNum(r.valueN) ? r.valueN - r.clause : null,
        gainNLaLiga: isNum(r.laLigaN) ? r.laLigaN - r.clause : null,
      })),
  ];
  const econ = candidates.filter((r) => isNum(r.gainNLaLiga) && r.gainNLaLiga > 0)
    .sort((a, b) => b.gainNLaLiga - a.gainNLaLiga).slice(0, 10);
  const sport = candidates.filter((r) => r.status === 'ok' && r.positionId !== 5 && isNum(r.xp))
    .sort((a, b) => b.xp - a.xp).slice(0, 10);
  const clauseSoon = candidates.filter((r) => r.origin === 'Cláusula' && !r.clauseIsOpen)
    .sort((a, b) => new Date(a.clauseOpenAt) - new Date(b.clauseOpenAt));

  // ---- once recomendado y fichajes que lo mejoran ----
  const lineup = bestLineup(squad);
  const venue = (r) => (r.nextIsHome === true ? 'casa' : r.nextIsHome === false ? 'fuera' : '');
  const doubtfulStarters = lineup.starters.filter((p) => p.playProb < 0.6);
  const worstStarter = {};
  lineup.starters.forEach((p) => {
    if (!worstStarter[p.positionId] || p.xp < worstStarter[p.positionId].xp) worstStarter[p.positionId] = p;
  });
  const upgrades = candidates
    .filter((r) => r.positionId !== 5 && isNum(r.xp) && worstStarter[r.positionId] && r.xp > worstStarter[r.positionId].xp + 0.5)
    .map((r) => ({ r, replaces: worstStarter[r.positionId], delta: r.xp - worstStarter[r.positionId].xp }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);

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

  md.push(`## 🧠 Once recomendado — jornada ${data.week ?? '?'} (${lineup.formation})`);
  md.push(`Previsión total: **${N(lineup.total)} pts** (incluye capitán ×2 y entrenador). xP = puntos esperados; Prob = probabilidad de jugar (futbolfantasy si existe).`);
  md.push('');
  md.push(table(['', 'Jugador', 'Pos', 'Rival', 'xP', 'Prob', 'Media', 'Forma 3j'],
    [...lineup.starters].sort((a, b) => a.positionId - b.positionId || b.xp - a.xp).map((p) => [
      lineup.captain?.id === p.id ? '©' : '', p.name, p.position, p.nextRival ? `${p.nextRival} (${venue(p)})` : '—',
      N(p.xp), `${Math.round(p.playProb * 100)} %${p.probSource !== 'futbolfantasy' ? '*' : ''}`, N(p.averagePoints, 2), N(p.form),
    ])));
  if (lineup.coach) md.push(`\nEntrenador: **${lineup.coach.name}** (xP ${N(lineup.coach.xp)}) · Capitán: **${lineup.captain?.name || '—'}**`);
  const altF = lineup.ranking.filter((r) => !r.missing).slice(1, 3).map((r) => `${r.formation} (${N(r.total)})`);
  if (altF.length) md.push(`Alternativas: ${altF.join(', ')}`);
  const benchTop = lineup.bench.slice(0, 4).map((p) => `${p.name} ${N(p.xp)}`);
  if (benchTop.length) md.push(`Mejores suplentes: ${benchTop.join(', ')}`);
  if (doubtfulStarters.length) md.push(`⚠️ Titulares con probabilidad < 60 %: ${doubtfulStarters.map((p) => `${p.name} (${Math.round(p.playProb * 100)} %)`).join(', ')} — revisa los onces probables antes del cierre.`);
  md.push('_* probabilidad estimada (futbolfantasy no da dato para ese jugador)._');
  md.push('');

  if (upgrades.length) {
    md.push('## ➕ Fichajes (mercado o cláusula) que mejorarían tu once');
    md.push(table(['Jugador', 'Pos', 'Origen', 'Rival', 'xP', 'Sustituye a', 'Mejora', 'Precio', '¿Te llega?', 'Disponible'],
      upgrades.map(({ r, replaces, delta }) => [
        r.name, r.position, r.origin, r.nextRival ? `${r.nextRival} (${venue(r)})` : '—', N(r.xp), `${replaces.name} (${N(replaces.xp)})`,
        `+${N(delta)}`, M(r.price), isNum(data.myMoney) && data.myMoney >= r.price ? 'sí' : 'vendiendo', r.available,
      ])));
    md.push('');
  }

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

  md.push('_Oportunidades = mercado de LaLiga (sin los jugadores que ponen a la venta otros managers) + jugadores de rivales con cláusula abierta o que se abre en ≤ 48 h (precio = cláusula)._');
  md.push('');
  md.push(`## 💰 Oportunidades económicas (top ${econ.length})`);
  md.push(econ.length ? table(['Jugador', 'Pos', 'Origen', 'De', 'Precio', 'Puja sug.', 'Valor', 'Δ1d', 'Δ3d/día', `G.${days}d`, `G.${days}d LaLiga`, 'xP', 'Disponible'],
    econ.map((r) => [r.name, r.position, r.origin, r.from, M(r.price), r.bid ? M(r.bid) : '—', M(r.value), K(r.dailyGrowth), K(r.growthAvg3), SM(r.gainN), SM(r.gainNLaLiga), N(r.xp), r.available]))
    : 'Ninguna con ganancia esperada positiva.');
  md.push('');

  md.push(`## ⚽ Oportunidades deportivas (top ${sport.length}, por puntos esperados)`);
  md.push(sport.length ? table(['Jugador', 'Pos', 'Origen', 'De', 'Precio', 'xP', 'Prob', 'Rival', 'Media', 'Pts/M', 'Δ3d/día', 'Disponible'],
    sport.map((r) => [r.name, r.position, r.origin, r.from, M(r.price), N(r.xp), `${Math.round((r.playProb ?? 0) * 100)} %`, r.nextRival ? `${r.nextRival} (${venue(r)})` : '—', N(r.averagePoints, 2), N(r.pointsPerMillion, 2), K(r.growthAvg3), r.available]))
    : '—');
  md.push('');

  md.push(`## 🔓 Calendario de cláusulas que se abren en las próximas 48 h (${clauseSoon.length})`);
  md.push(clauseSoon.length ? table(['Se abre', 'Jugador', 'Pos', 'Dueño', 'Cláusula', 'Valor', `G.${days}d LaLiga`, 'xP'],
    clauseSoon.map((r) => [dt(r.clauseOpenAt), r.name, r.position, r.from, M(r.clause), M(r.value), SM(r.gainNLaLiga), N(r.xp)]))
    : 'Ninguna.');
  md.push('');

  md.push('## 🕵️ Rivales: dinero, pujas y actividad');
  const ov = bidStats.overall;
  md.push(ov.n
    ? `En los fichajes de mercado de los últimos 30 días (${ov.n} con valor conocido), la liga paga de mediana **${P(ov.median)}** sobre el valor (percentil 75: ${P(ov.p75)}). La "puja sugerida" usa el percentil 75${ov.n < 5 ? ' (aún pocas muestras: sin sugerencia)' : ''}.`
    : 'Sin datos suficientes de pujas en los últimos 30 días.');
  md.push('');
  md.push(table(['Manager', 'Pos', 'Pts', 'Dinero ajustado', 'Poder de compra', 'Pujas 30d', 'Sobrepuja mediana', 'Máx', 'Compras 7d', 'Ventas 7d', 'Subidas cláusula'],
    [...money].sort((a, b) => (b.calibrated ?? -Infinity) - (a.calibrated ?? -Infinity)).map((m) => {
      const t = data.teams.find((x) => x.teamId === m.id);
      const b = bidStats.byManager.get(t?.managerId) || {};
      const a = recent.get(t?.managerId) || {};
      return [
        `${m.isMe ? '⭐ ' : ''}${m.name}`, m.position ?? '—', m.points ?? '—', M(m.calibrated), M(m.maxBuyingPower),
        b.n || 0, P(b.median), P(b.max),
        a.buys ? `${a.buys} (${M(a.buySpend, 1)})` : '0', a.sells ? `${a.sells} (${M(a.sellIncome, 1)})` : '0',
        m.clauseRaiseSpend ? `−${M(m.clauseRaiseSpend, 1)}` : '—',
      ];
    })));
  md.push(`_Dinero: inicial + ventas + premios − compras − subidas de cláusula detectadas (coste supuesto ${Math.round((settings.clauseRaiseCostFactor ?? 0.5) * 100)} % del aumento), ajustado con el desvío de mi saldo real._`);
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
    onceRecomendado: {
      formacion: lineup.formation,
      puntosPrevistos: lineup.total,
      capitan: lineup.captain?.name || null,
      entrenador: lineup.coach?.name || null,
      titulares: lineup.starters.map((p) => ({ nombre: p.name, posicion: p.position, xP: p.xp, probJugar: p.playProb, rival: p.nextRival, casa: p.nextIsHome })),
      suplentes: lineup.bench.map((p) => ({ nombre: p.name, posicion: p.position, xP: p.xp })),
      alternativas: lineup.ranking,
    },
    fichajesQueMejoranElOnce: upgrades.map(({ r, replaces, delta }) => ({ jugador: r.name, posicion: r.position, xP: r.xp, sustituyeA: replaces.name, mejora: delta, precio: r.buyPrice, vende: r.seller })),
    ofertasRecibidas: offers.map((o) => ({ jugador: o.r.name, precioCompra: o.r.buyPrice, valor: o.r.value, oferta: o.best.money, de: o.from, gananciaSiAceptas: o.gain, expira: o.best.expirationDate })),
    // Oportunidades: mercado de LaLiga + cláusulas abiertas o en ≤ 48 h. precio = salida o cláusula;
    // ganancia*dLaLiga ya está calculada respecto a ese precio.
    oportunidadesEconomicas: econ.map((r) => ({ ...pick(r), origen: r.origin, de: r.from, precio: r.price, xP: r.xp, disponible: r.available, disponibleDesde: r.availableAt })),
    oportunidadesDeportivas: sport.map((r) => ({ ...pick(r), origen: r.origin, de: r.from, precio: r.price, xP: r.xp, probJugar: r.playProb, rival: r.nextRival, disponible: r.available })),
    clausulasProximas48h: clauseSoon.map((r) => ({ ...pick(r), dueño: r.owner, seAbre: r.clauseOpenAt, precio: r.clause })),
    dineroRivales: money.map((m) => {
      const t = data.teams.find((x) => x.teamId === m.id);
      const b = bidStats.byManager.get(t?.managerId) || {};
      return { manager: m.name, yo: m.isMe, dineroBase: m.estimated, dineroAjustado: m.calibrated, valorEquipo: m.teamValue, puntos: m.points, pujas30d: b.n || 0, sobrepujaMedianaPct: b.median ?? null, gastoSubidasClausula: m.clauseRaiseSpend };
    }),
    sobrepujaLiga: { muestras: ov.n, medianaPct: ov.median, p75Pct: ov.p75 },
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
