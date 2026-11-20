/**
 * Versión visual del informe para el PDF (A4 vertical, legible en móvil).
 * Todo el texto procedente de la API se escapa: nunca se interpreta como HTML.
 */
import {
  isNum, M, SM, K, N, PCT, PCT2, dt, STATUS_ICON, LINE_LABEL, trendArrow, venueIcon,
} from './reportFormat';
import { EDITIONS } from './schedule';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// **negrita** dentro de textos ya escapados
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const signCls = (v) => (!isNum(v) ? 'muted' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const trendHtml = (v, pct = null) => (isNum(v) ? `<span class="${v > 20_000 ? 'pos' : v < -20_000 ? 'neg' : 'muted'}">${trendArrow(v)} ${K(v)}${isNum(pct) ? `<br><span class="small">${PCT2(pct)}</span>` : ''}</span>` : '<span class="muted">—</span>');
const origin = (r) => (r.origin === 'Mercado'
  ? '<span class="pill pill-m">Mercado</span>'
  : `<span class="pill pill-c">Cláusula</span> <span class="small">${esc(r.from)}</span>`);
const pos = (r) => `<span class="pos-tag p${r.positionId}">${esc(r.position)}</span>`;

const table = (headers, rows, cls = '') => `
  <table class="${cls}"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const section = (title, body, note = '') => `
  <section><h2>${title}</h2>${body}${note ? `<p class="note">${note}</p>` : ''}</section>`;

const CSS = `
  @page { size: A4 portrait; margin: 9mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Segoe UI Emoji", Roboto, Arial, sans-serif; font-size: 10pt; color: #1f2937; margin: 0; line-height: 1.38; }
  .hero { background: linear-gradient(135deg, #312e81, #4f46e5); color: #fff; border-radius: 10px; padding: 12px 14px; }
  .hero h1 { margin: 0; font-size: 17pt; }
  .hero .sub { opacity: .85; font-size: 9pt; margin-top: 2px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
  .kpi { background: rgba(255,255,255,.14); border-radius: 8px; padding: 6px 8px; }
  .kpi .l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; opacity: .85; }
  .kpi .v { font-size: 14pt; font-weight: 700; }
  .kpi .s { font-size: 8pt; opacity: .9; }
  section { margin-top: 12px; page-break-inside: avoid; }
  h2 { font-size: 12.5pt; margin: 0 0 6px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 3px; }
  .actions { display: flex; flex-direction: column; gap: 5px; }
  .act { display: flex; gap: 8px; align-items: flex-start; padding: 6px 9px; border-radius: 7px; background: #f9fafb; border-left: 4px solid #9ca3af; }
  .act .i { font-size: 12pt; line-height: 1.1; }
  .act.risk { border-color: #dc2626; background: #fef2f2; }
  .act.money { border-color: #059669; background: #ecfdf5; }
  .act.buy { border-color: #2563eb; background: #eff6ff; }
  .act.lineup { border-color: #7c3aed; background: #f5f3ff; }
  .pitch { background: repeating-linear-gradient(0deg, #15803d 0 34px, #16a34a 34px 68px); border-radius: 10px; padding: 8px 6px; }
  .row { display: flex; justify-content: center; gap: 6px; margin: 5px 0; flex-wrap: wrap; }
  .chip { background: #fff; border-radius: 8px; padding: 3px 8px; min-width: 82px; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
  .chip .n { font-weight: 600; font-size: 9pt; }
  .chip .x { font-size: 8pt; color: #4b5563; }
  .chip.cap { outline: 2px solid #f59e0b; }
  .chip.warn { background: #fff7ed; }
  .badge { display: inline-block; background: #f59e0b; color: #fff; border-radius: 4px; padding: 0 4px; font-size: 7.5pt; font-weight: 700; margin-right: 3px; }
  .under { display: flex; gap: 10px; margin-top: 6px; font-size: 9pt; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
  th { text-align: left; background: #f3f4f6; font-weight: 600; padding: 4px 6px; white-space: nowrap; font-size: 8pt; color: #374151; }
  td { padding: 3.5px 6px; border-bottom: 1px solid #eef0f3; vertical-align: middle; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  tr { page-break-inside: avoid; }
  table.compact { font-size: 8.2pt; }
  table.compact td, table.compact th { padding: 3px 4px; }
  table.compact td:nth-child(3), table.compact td:nth-child(7) { white-space: nowrap; }
  .pos { color: #047857; font-weight: 600; }
  .neg { color: #b91c1c; font-weight: 600; }
  .muted { color: #9ca3af; }
  .small { font-size: 8pt; color: #6b7280; }
  .pill { display: inline-block; border-radius: 10px; padding: 0 7px; font-size: 7.8pt; font-weight: 600; }
  .pill-m { background: #dbeafe; color: #1d4ed8; }
  .pill-c { background: #ede9fe; color: #6d28d9; }
  .pos-tag { display: inline-block; min-width: 28px; text-align: center; border-radius: 4px; font-size: 7.5pt; font-weight: 700; color: #fff; padding: 0 3px; margin-right: 4px; }
  .p1 { background: #f59e0b; } .p2 { background: #2563eb; } .p3 { background: #059669; } .p4 { background: #dc2626; } .p5 { background: #6b7280; }
  .note { font-size: 8pt; color: #6b7280; margin: 4px 0 0; }
  .callout { background: #f3f4f6; border-radius: 7px; padding: 6px 9px; font-size: 9pt; margin-bottom: 6px; }
  footer { margin-top: 14px; font-size: 7.8pt; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 5px; }
`;

export const renderReportHtml = (m) => {
  const k = m.kpis;
  const L = m.lineup;
  const parts = [];

  // Cabecera + cifras clave
  parts.push(`<div class="hero">
    <h1>Informe Fantasy${m.leagueName ? ` · ${esc(m.leagueName)}` : ''}</h1>
    <div class="sub">${esc(EDITIONS[m.edition]?.icon || "")} <b>${esc(EDITIONS[m.edition]?.label || "")}</b> · ${esc(m.now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))} · Jornada ${esc(m.week ?? '?')}${m.weekStart ? ` · 1.er partido ${esc(dt(m.weekStart))}` : ''}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Clasificación</div><div class="v">${esc(k.rank || '?')}º · ${esc(k.points)}</div><div class="s">${isNum(k.gap) ? `${k.gap >= 0 ? '+' : ''}${esc(k.gap)} pts vs ${esc(k.closest)}` : ''}</div></div>
      <div class="kpi"><div class="l">Saldo</div><div class="v">${esc(M(k.money))}</div><div class="s">${isNum(k.money) && k.money < 0 ? '⚠️ negativo' : 'disponible'}</div></div>
      <div class="kpi"><div class="l">Valor del equipo</div><div class="v">${esc(M(k.teamValue, 0))}</div><div class="s">${m.squad.length} jugadores</div></div>
      <div class="kpi"><div class="l">Si vendes a LaLiga</div><div class="v">${esc(SM(k.gainLaLiga))}</div><div class="s">${isNum(k.gainLaLigaN) ? `en ${m.days} días: ${esc(SM(k.gainLaLigaN))}` : 'sobre lo pagado'}</div></div>
    </div>
  </div>`);
  parts.push(m.edition === 'cierre'
    ? '<p class="callout">⏳ <b>Antes del cierre</b>: las ofertas y pujas se resuelven a las 19:00. Actúa antes.</p>'
    : '<p class="callout">🆕 <b>Mercado nuevo</b>: los valores se actualizan de madrugada, así que las proyecciones usan los de hoy.</p>');
  if (m.clauseLock?.active) parts.push(`<p class="callout">🔒 <b>Cláusulas bloqueadas hasta ${esc(dt(m.clauseLock.end))}</b> (24 h antes del primer partido): nadie puede clausular; no hace falta blindar todavía.</p>`);
  else if (m.clauseLock) parts.push(`<p class="callout">🔒 Las cláusulas se bloquearán desde ${esc(dt(m.clauseLock.start))} hasta el primer partido (${esc(dt(m.clauseLock.end))}).</p>`);
  if (!m.trendsOk) parts.push('<p class="callout">⚠️ Sin datos de futbolfantasy hoy: no hay tendencias ni proyecciones.</p>');

  // Qué hacer hoy
  parts.push(section('🎯 Qué hacer hoy', `<div class="actions">${m.actions.map((a) => `<div class="act ${a.kind}"><span class="i">${esc(a.icon)}</span><span>${rich(a.text)}</span></div>`).join('')}</div>`));

  // Once en el campo
  const chip = (p) => `<div class="chip${L.captain?.id === p.id ? ' cap' : ''}${p.playProb < 0.6 ? ' warn' : ''}">
      <div class="n">${L.captain?.id === p.id ? '<span class="badge">C</span>' : ''}${esc(p.name)}${p.playProb < 0.6 ? ' ⚠️' : ''}</div>
      <div class="x">${esc(N(p.xp))} xP · ${p.nextRival ? `${venueIcon(p)} ${esc(p.nextRival)}` : '—'}</div></div>`;
  const rows = [4, 3, 2, 1].map((pp) => {
    const line = L.starters.filter((p) => p.positionId === pp).sort((a, b) => b.xp - a.xp);
    return line.length ? `<div class="row">${line.map(chip).join('')}</div>` : '';
  }).join('');
  parts.push(section(`🧠 Tu once · ${esc(L.formation)} · ${esc(N(L.total))} pts previstos`,
    `<div class="pitch">${rows}</div>
     <div class="under"><span>🧑‍💼 <b>Entrenador:</b> ${esc(L.coach?.name || '—')}</span>
     <span>🪑 <b>Banquillo:</b> ${esc(m.benchByLine.map((p) => `${p.name} (${LINE_LABEL[p.positionId]})`).join(', ') || '—')}</span></div>`,
    m.doubtful.length ? `⚠️ = probabilidad de jugar menor del 60 %: revisa los onces probables antes del cierre.` : ''));

  // Ofertas: buena = ≥ +5 % sobre el valor; fuerte si además hay motivo deportivo
  if (m.offers.length) {
    const minPct = Math.round(m.goodOfferPremium * 100);
    const rest = m.offers.length - m.goodOffers.length;
    const heads = ['', 'Jugador', 'Oferta', 'Sobre valor', 'Sobre lo pagado', 'xP', 'Motivo / caduca'];
    const row = (o) => [
      o.level === 'fuerte' ? '🔴' : '🟡', `${pos(o.r)}${esc(o.r.name)}`, esc(M(o.money)),
      `<span class="pos">${esc(PCT(o.premium * 100))}</span>`, `<span class="${signCls(o.gain)}">${esc(SM(o.gain))}</span>`, esc(N(o.r.xp)),
      `${o.reasons.length ? esc(o.reasons.join(', ')) : '<span class="muted">rinde bien</span>'}<br><span class="small">${esc(o.from)} · ${esc(dt(o.expires))}</span>`,
    ];
    const body = m.goodOffers.length
      ? table(heads, [...m.strongSells, ...m.offerOpportunities].map(row))
      : `<p class="small">Ninguna oferta llega al +${minPct} % sobre el valor: no compensa vender.</p>`;
    parts.push(section(`📩 Ofertas recibidas (buena ≥ +${minPct} % sobre el valor)`, body,
      `🔴 Venta fuerte: buena oferta y motivo deportivo (lesión, poca probabilidad de jugar, fuera del once, mala jornada). 🟡 Oportunidad: buena oferta pero el jugador rinde; véndelo solo si necesitas dinero.${rest > 0 ? ` ${rest} oferta(s) más por debajo del +${minPct} %.` : ''}`));
  }

  // Protección
  if (m.mustProtect.length || m.acceptable.length) {
    const body = m.mustProtect.length
      ? table(['Jugador', 'Cláusula', 'Estado', 'Rivales', 'Qué hacer'],
        m.mustProtect.map((p) => [`${pos(p)}${esc(p.name)}`, esc(M(p.clause)), p.clauseIsOpen ? '<span class="neg">abierta</span>' : p.clauseLockedUntil ? esc(`🔒 hasta ${dt(p.clauseLockedUntil)}`) : esc(`se abre ${dt(p.clauseOpenAt)}`), esc(p.canPay.length), rich(p.reason)]))
      : '<p class="small">Ningún jugador importante en riesgo.</p>';
    parts.push(section('🛡️ Protección frente a cláusulas', body,
      m.acceptable.length ? `Expuestos pero asumibles (suplentes; no pierdes dinero si te los clausulan): ${esc(m.acceptable.map((p) => p.name).join(', '))}.` : ''));
  }

  // Oportunidades
  parts.push(section(`💰 Oportunidades económicas · vender a LaLiga en ${m.days} días`,
    m.econ.length ? table(['Jugador', 'Origen', 'Precio', 'Puja máx. rentable', `Gana en ${m.days}d`, 'Rentab.', 'Tendencia', 'Disponible'],
      m.econ.map((r) => [
        `${pos(r)}${esc(r.name)}`, origin(r),
        `${esc(M(r.price))}${r.bid ? `<div class="small">puja ~${esc(M(r.bid))}</div>` : ''}`,
        `<b>${esc(M(r.maxBid))}</b>${r.bidTooHigh ? '<div class="small neg">la puja habitual la supera</div>' : ''}`,
        `<span class="${signCls(r.gainNLaLiga)}">${esc(SM(r.gainNLaLiga))}</span>`,
        `<span class="${signCls(r.roiN)}">${esc(PCT(r.roiN))}</span>`,
        trendHtml(r.growthAvg3, r.growthAvg3Pct), esc(r.available),
      ]))
      : '<p class="small">Hoy no hay ninguna con ganancia esperada.</p>',
    m.econ.length ? `<b>Puja máx. rentable</b>: lo máximo que puedes pagar sin perder dinero si lo vendes a LaLiga en ${m.days} días. En mercado, la ganancia ya descuenta la sobrepuja típica de tu liga.` : ''));

  parts.push(section(`⚽ Oportunidades deportivas · frente a tu alineación ${m.usingSaved ? 'actual' : 'recomendada'}`,
    m.sport.length ? table(['Jugador', 'Origen', 'Precio', 'xP', 'Mejora a', 'Próximo (juega)', 'Puja máx. rentable', `Rentab. ${m.days}d`, 'Disponible'],
      m.sport.map((r) => [
        `${pos(r)}${esc(r.name)}`, origin(r), esc(M(r.price)), `<b>${esc(N(r.xp))}</b>`,
        r.improves ? `${esc(r.improves.name)} <span class="pos">+${esc(N(r.improves.delta))}</span>` : '<span class="muted">no mejora</span>',
        `${r.nextRival ? `${venueIcon(r)} ${esc(r.nextRival)} ` : ''}<span class="small">${esc(Math.round((r.playProb ?? 0) * 100))} %</span>`,
        esc(M(r.maxBid)), `<span class="${signCls(r.roiN)}">${esc(PCT(r.roiN))}</span>`, esc(r.available),
      ]), 'compact')
      : '<p class="small">—</p>',
    m.sport.length ? '"Mejora a" = el titular más flojo de esa posición en tu alineación y cuántos puntos por jornada ganarías.' : ''));

  if (m.clauseSoon.length) {
    parts.push(section('🔓 Cláusulas que se abren en 48 h', table(['Se abre', 'Jugador', 'Dueño', 'Cláusula', `Gana en ${m.days}d`, 'xP'],
      m.clauseSoon.map((r) => [`<b>${esc(dt(r.clauseOpenAt))}</b>`, `${pos(r)}${esc(r.name)}`, esc(r.from), esc(M(r.clause)), `<span class="${signCls(r.gainNLaLiga)}">${esc(SM(r.gainNLaLiga))}</span>`, esc(N(r.xp))]))));
  }

  // Plantilla
  parts.push(section('📋 Tu plantilla', table(['Jugador', 'Valor', 'Tendencia/día', 'Ganancia LaLiga', `en ${m.days}d`, 'xP', ''],
    m.squad.map((r) => [
      `${pos(r)}${esc(r.name)}`, esc(M(r.value)), trendHtml(r.growthAvg3, r.growthAvg3Pct),
      `<span class="${signCls(r.latentGainLaLiga)}">${esc(SM(r.latentGainLaLiga))}</span>`,
      `<span class="${signCls(r.gainNLaLiga)}">${esc(SM(r.gainNLaLiga))}</span>`, esc(N(r.xp)),
      esc([STATUS_ICON[r.status], r.inMarket ? '🏷️' : '', r.isShielded ? '🛡️' : r.clauseIsOpen ? '🔓' : ''].filter(Boolean).join(' ')),
    ])), '🚑 lesionado · ❓ duda · 🏷️ en el mercado · 🔓 cláusula abierta · 🛡️ blindado'));

  // Rivales
  parts.push(section('🕵️ Rivales',
    `${m.bidOverall?.n ? `<p class="callout">Para ganar una puja en tu liga se suele pagar <b>${esc(PCT(m.bidOverall.median))}</b> sobre el valor (agresivo: ${esc(PCT(m.bidOverall.p75))}).</p>` : ''}
    ${table(['Manager', 'Puesto', 'Dinero estimado', 'Sobrepuja típica', 'Compras / ventas 7d'],
      m.rivalsTable.map((r) => [`${r.isMe ? '⭐ ' : ''}<b>${esc(r.name)}</b>`, esc(`${r.position ?? '—'}º · ${r.points ?? '—'} pts`), esc(M(r.calibrated)), r.bids ? esc(PCT(r.overbid)) : '<span class="muted">—</span>', esc(`${r.buys7} / ${r.sells7}`)]))}`,
    'Dinero estimado a partir de la actividad de la liga (aproximado).'));

  // Precisión
  if (m.accuracy) {
    const a = m.accuracy;
    const mae = a.last.variants?.modelo?.mae;
    parts.push(section(`📏 ¿Acertó la previsión? · jornada ${esc(a.week)}`,
      `<p>${a.last.lineup ? `Tu once: previsto <b>${esc(N(a.last.lineup.predicted))}</b> → real <b>${esc(N(a.last.lineup.actual))}</b> pts. ` : ''}${isNum(mae) ? `Error medio por jugador: ${esc(N(mae))} pts.` : ''}</p>`));
  }

  const am = m.autoMarketLog;
  const listed = am.filter((l) => l.status === 'listed').length;
  const errors = am.filter((l) => l.status === 'error').length;
  const amText = !m.settings.autoMarketEnabled ? 'desactivado' : m.settings.autoMarketDryRun ? `simulación (${am.length} jugador/es)` : `${listed} puesto(s) en venta${errors ? `, ${errors} error(es)` : ''}`;
  parts.push(`<footer>Auto-mercado: ${esc(amText)} · Importes en millones de € · "LaLiga" = mejor oferta posible de LaLiga (valor +10 %) · xP = puntos esperados la próxima jornada · Generado ${esc(m.now.toLocaleString('es-ES'))}</footer>`);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe Fantasy</title><style>${CSS}</style></head><body>${parts.join('\n')}</body></html>`;
};
