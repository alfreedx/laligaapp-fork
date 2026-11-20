/**
 * Resumen de inicio de jornada (1 h antes del primer partido): expectativas de
 * la alineación GUARDADA comparada con la recomendada. Funciones puras.
 */
import { tgEscape } from './telegramMessage';
import { N, dt, isNum, LINE_LABEL, STATUS_ICON } from './reportFormat';

const xpOf = (p) => (isNum(p?.xp) ? p.xp : 0);

/**
 * @param {object} model  buildReportModel(...)
 * @param {object} saved  { ids:Set, formation, captainId, coachId }
 */
export const buildMatchdaySummary = (model, saved) => {
  const squad = model._raw.squad;
  const byId = new Map(squad.map((p) => [String(p.id), p]));
  const starters = [...(saved?.ids || [])].map((id) => byId.get(String(id))).filter((p) => p && p.positionId !== 5);
  const captain = saved?.captainId ? byId.get(String(saved.captainId)) : null;
  const coach = saved?.coachId ? byId.get(String(saved.coachId)) : null;
  const total = starters.reduce((s, p) => s + xpOf(p), 0) + (captain ? xpOf(captain) : 0) + (coach ? xpOf(coach) : 0);
  const rec = model.lineup;
  const recIds = new Set(rec.starters.map((p) => String(p.id)));
  const savedIds = new Set(starters.map((p) => String(p.id)));
  const swaps = {
    in: rec.starters.filter((p) => !savedIds.has(String(p.id))),
    out: starters.filter((p) => !recIds.has(String(p.id))),
  };
  const problems = starters.filter((p) => ['injured', 'suspended', 'not_available'].includes(p.status));
  const doubtful = starters.filter((p) => !problems.includes(p) && isNum(p.playProb) && p.playProb < 0.6);
  return {
    week: model.week,
    kickoff: model.weekStart,
    formation: saved?.formation || '—',
    starters,
    captain,
    coach,
    total,
    recommended: { formation: rec.formation, total: rec.total, captain: rec.captain, coach: rec.coach },
    delta: rec.total - total,
    swaps,
    problems,
    doubtful,
    missing: Math.max(0, 11 - starters.length),
    kpis: model.kpis,
  };
};

export const renderMatchdayTelegram = (s) => {
  const lines = [];
  lines.push(`⚽ <b>Jornada ${tgEscape(s.week ?? '?')}: empieza ${tgEscape(dt(s.kickoff))}</b>`);
  const k = s.kpis || {};
  if (k.rank) lines.push(`🏆 Vas ${tgEscape(k.rank)}º con ${tgEscape(k.points)} pts${isNum(k.gap) ? ` (${k.gap >= 0 ? '+' : ''}${tgEscape(k.gap)} vs ${tgEscape(k.closest)})` : ''}`);
  lines.push('');
  lines.push(`🧠 <b>Tu alineación (${tgEscape(s.formation)}): ${tgEscape(N(s.total))} pts previstos</b>`);
  [4, 3, 2, 1].forEach((pos) => {
    const line = s.starters.filter((p) => p.positionId === pos).sort((a, b) => xpOf(b) - xpOf(a));
    if (!line.length) return;
    lines.push(`<b>${tgEscape(LINE_LABEL[pos])}</b>: ${line.map((p) => `${s.captain?.id === p.id ? '©' : ''}${tgEscape(p.name)} ${tgEscape(N(p.xp))}${STATUS_ICON[p.status] ? ` ${STATUS_ICON[p.status]}` : ''}`).join(' · ')}`);
  });
  lines.push(`Capitán: <b>${tgEscape(s.captain?.name || '⚠️ sin capitán')}</b> · Entrenador: ${tgEscape(s.coach?.name || '—')}`);
  lines.push('');

  const alerts = [];
  if (s.missing) alerts.push(`🚨 Te faltan <b>${s.missing}</b> titular(es): puntuarán 0.`);
  s.problems.forEach((p) => alerts.push(`🚨 <b>${tgEscape(p.name)}</b> ${p.status === 'injured' ? 'está lesionado' : p.status === 'suspended' ? 'está sancionado' : 'no está disponible'} y lo tienes alineado.`));
  s.doubtful.forEach((p) => alerts.push(`⚠️ ${tgEscape(p.name)}: ${Math.round(p.playProb * 100)} % de jugar.`));
  if (!s.captain) alerts.push('⚠️ Sin capitán pierdes el ×2.');
  if (alerts.length) lines.push(...alerts, '');

  if (s.delta > 0.5) {
    lines.push(`💡 La recomendada (${tgEscape(s.recommended.formation)}) da <b>${tgEscape(N(s.recommended.total))}</b> pts (+${tgEscape(N(s.delta))}).`);
    if (s.swaps.in.length) lines.push(`Entran: ${s.swaps.in.map((p) => `${tgEscape(p.name)} ${tgEscape(N(p.xp))}`).join(', ')}`);
    if (s.swaps.out.length) lines.push(`Salen: ${s.swaps.out.map((p) => `${tgEscape(p.name)} ${tgEscape(N(p.xp))}`).join(', ')}`);
    if (s.recommended.captain && s.recommended.captain.id !== s.captain?.id) lines.push(`Capitán recomendado: ${tgEscape(s.recommended.captain.name)}`);
    lines.push('Tienes 1 hora: Mi Alineación → Cargar recomendada.');
  } else {
    lines.push('✅ Tu alineación coincide con la recomendada (o casi). ¡Suerte!');
  }
  return lines.join('\n');
};
