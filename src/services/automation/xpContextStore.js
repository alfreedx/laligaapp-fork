/**
 * Contexto del xP (medias por posición, fuerza de los equipos, próximos partidos)
 * guardado en disco por el informe, para que Rentabilidad, Mi Alineación y el
 * informe usen exactamente el mismo modelo aunque la app se haya reiniciado.
 */
import { readJson, writeJson } from './localStore';
import { getXpContext, setXpContext } from '../analytics/forecast';

export const XP_CONTEXT_FILE = 'xp-context.json';
export const XP_CONTEXT_MAX_AGE_DAYS = 7;

export const serializeXpContext = (ctx, { week = null, now = new Date() } = {}) => ({
  createdAt: now.toISOString(),
  week,
  priors: ctx?.priors || {},
  strength: ctx?.strength ? { avg: ctx.strength.avg, teams: [...ctx.strength.teams.entries()] } : null,
  fixtures: ctx?.fixtures ? [...ctx.fixtures.entries()] : [],
});

export const deserializeXpContext = (json) => {
  if (!json?.priors) return null;
  return {
    priors: json.priors,
    strength: json.strength ? { avg: json.strength.avg, teams: new Map(json.strength.teams || []) } : null,
    fixtures: new Map(json.fixtures || []),
    meta: { createdAt: json.createdAt || null, week: json.week ?? null },
  };
};

/** Días desde que se generó el contexto (null si no hay fecha). */
export const xpContextAgeDays = (meta, now = new Date()) => {
  const t = meta?.createdAt ? new Date(meta.createdAt).getTime() : NaN;
  return Number.isFinite(t) ? (now.getTime() - t) / 86400000 : null;
};

export const saveXpContext = async (ctx, week) => {
  const json = serializeXpContext(ctx, { week });
  await writeJson(XP_CONTEXT_FILE, json);
  setXpContext(deserializeXpContext(json));
};

/** Carga el contexto guardado si aún no hay uno en memoria. Devuelve su meta ({ createdAt, week }) o null. */
export const ensureXpContextLoaded = async () => {
  const current = getXpContext();
  if (current) return current.meta || null;
  const ctx = deserializeXpContext(await readJson(XP_CONTEXT_FILE, null));
  if (ctx) setXpContext(ctx);
  return ctx?.meta || null;
};
