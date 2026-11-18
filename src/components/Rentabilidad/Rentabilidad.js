import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, RefreshCw, Download, Info } from 'lucide-react';
import useLeagueAnalytics from '../../hooks/useLeagueAnalytics';
import {
  buildSquadRows, buildMarketRows, buildRivalRows, buildMoneyRows, buildSalesRows,
} from '../../services/analytics/rows';
import { DEFAULT_INITIAL_MONEY } from '../../services/analytics/ledger';
import { bestLineup } from '../../services/analytics/forecast';
import { buildBidStats, recentActivity } from '../../services/analytics/rivalIntel';
import { loadState } from '../../services/automation/localStore';
import { getClauseTimeRemaining } from '../../utils/clauseUtils';
import LoadingState from '../Common/LoadingState';
import ErrorState from '../Common/ErrorState';

// ---------- formato ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtM = (v, digits = 2) => (isNum(v) ? `${(v / 1e6).toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits })} M` : '—');
const fmtK = (v) => (isNum(v) ? `${v >= 0 ? '+' : ''}${(v / 1e3).toLocaleString('es-ES', { maximumFractionDigits: 0 })} K` : '—');
const fmtPct = (v) => (isNum(v) ? `${v >= 0 ? '+' : ''}${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` : '—');
const fmtNum = (v, d = 1) => (isNum(v) ? v.toLocaleString('es-ES', { maximumFractionDigits: d }) : '—');
const fmtDate = (v) => (v ? new Date(v).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const signClass = (v) => (!isNum(v) ? 'text-gray-400' : v > 0 ? 'text-green-600 dark:text-green-400' : v < 0 ? 'text-red-600 dark:text-red-400' : '');
const STATUS_ICON = { ok: '', injured: '🚑', doubtful: '❓', suspended: '🟥', not_available: '⛔' };
const VIA_LABEL = { mercado: 'Mercado', manager: 'Manager', clausula: 'Cláusula', inicial: 'Inicial' };

const clauseCell = (r) => {
  if (r.isShielded) return '🛡️ Blindado';
  if (r.clauseIsOpen) return '🟢 Abierta';
  return `🔒 ${getClauseTimeRemaining(r.clauseOpenAt) || ''}`;
};

// ---------- columnas ----------
const col = (key, label, opts = {}) => ({ key, label, ...opts });
const money = (key, label, title) => col(key, label, { fmt: fmtM, num: true, title });
const gain = (key, label, title) => col(key, label, { fmt: fmtM, num: true, colored: true, title });

const playerCols = [
  col('name', 'Jugador', { render: (r) => <span className="font-medium">{STATUS_ICON[r.status] || ''} {r.name}</span> }),
  col('position', 'Pos'),
];

const profitCols = (n) => [
  money('buyPrice', 'P. compra'),
  money('value', 'Valor'),
  money('laLigaMax', 'Oferta LaLiga', 'Valor actual +10 %'),
  gain('latentGain', 'G. latente', 'Valor actual − precio de compra'),
  gain('latentGainLaLiga', 'G. latente LaLiga', 'Valor +10 % − precio de compra'),
  col('dailyGrowth', 'Crec. diario', { fmt: fmtK, num: true, colored: true }),
  col('growthAvg3', 'Media 3d', { fmt: fmtK, num: true, colored: true, title: 'Crecimiento medio diario de los últimos 3 días' }),
  money('valueN', `Valor en ${n}d`, 'Si sigue al mismo ritmo'),
  money('laLigaN', `LaLiga en ${n}d`, `Valor en ${n} días +10 %`),
  gain('gainN', `G. ${n}d`, `Valor en ${n} días − precio de compra`),
  gain('gainNLaLiga', `G. ${n}d LaLiga`, `Valor en ${n} días +10 % − precio de compra`),
  col('roiPct', 'ROI', { fmt: fmtPct, num: true, colored: true }),
];

const venueTxt = (r) => (r.nextRival ? `${r.nextRival} ${r.nextIsHome === true ? '🏠' : r.nextIsHome === false ? '✈️' : ''}` : '—');
const sportCols = [
  col('xp', 'xP', { fmt: (v) => fmtNum(v, 1), num: true, title: 'Puntos esperados próxima jornada (media, forma, casa/fuera, prob. de jugar)' }),
  col('playProb', 'Prob', { fmt: (v) => (isNum(v) ? `${Math.round(v * 100)} %` : '—'), num: true, title: 'Probabilidad de jugar (futbolfantasy; * = estimada)', render: (r) => (isNum(r.playProb) ? `${Math.round(r.playProb * 100)} %${r.probSource === 'estimada' ? '*' : ''}` : '—') }),
  col('nextRival', 'Rival', { render: venueTxt }),
  col('points', 'Pts', { fmt: (v) => fmtNum(v, 0), num: true }),
  col('averagePoints', 'Media', { fmt: (v) => fmtNum(v, 2), num: true }),
  col('pointsPerMillion', 'Pts/M', { fmt: (v) => fmtNum(v, 2), num: true, title: 'Puntos por millón de valor' }),
];

const TABS = {
  squad: { label: 'Mi equipo' },
  lineup: { label: 'Once' },
  market: { label: 'Mercado hoy' },
  rivals: { label: 'Rivales' },
  money: { label: 'Dinero rivales' },
  sales: { label: 'Mis ventas' },
};

const columnsFor = (tab, n) => {
  switch (tab) {
    case 'squad':
      return [
        ...playerCols,
        ...profitCols(n),
        ...sportCols,
        col('acquiredVia', 'Vía', { fmt: (v) => VIA_LABEL[v] || v }),
        col('inMarket', 'En mercado', { render: (r) => (r.inMarket ? `🏷️ hasta ${fmtDate(r.marketExpiration)}` : '—'), sortValue: (r) => (r.inMarket ? 1 : 0) }),
        col('clauseOpenAt', 'Cláusula', { render: clauseCell, sortValue: (r) => (r.clauseIsOpen ? 0 : new Date(r.clauseOpenAt).getTime()) }),
      ];
    case 'market':
      return [
        ...playerCols,
        col('seller', 'Vende'),
        money('buyPrice', 'Precio'),
        money('value', 'Valor'),
        col('dailyGrowth', 'Crec. diario', { fmt: fmtK, num: true, colored: true }),
        col('growthAvg3', 'Media 3d', { fmt: fmtK, num: true, colored: true }),
        money('valueN', `Valor en ${n}d`),
        gain('gainN', `G. ${n}d`, `Valor en ${n} días − precio`),
        gain('gainNLaLiga', `G. ${n}d LaLiga`, `Valor en ${n} días +10 % − precio`),
        ...sportCols,
        col('bids', 'Pujas', { num: true }),
        col('expiration', 'Expira', { fmt: fmtDate }),
      ];
    case 'rivals':
      return [
        ...playerCols,
        col('owner', 'Dueño'),
        money('buyPrice', 'Le costó'),
        col('acquiredVia', 'Vía', { fmt: (v) => VIA_LABEL[v] || v }),
        money('value', 'Valor'),
        gain('latentGain', 'Su g. latente'),
        money('clause', 'Cláusula'),
        col('clauseOverValuePct', 'Cláus. vs valor', { fmt: fmtPct, num: true, title: 'Cuánto supera la cláusula al valor de mercado' }),
        col('clauseOpenAt', 'Apertura', { render: clauseCell, sortValue: (r) => (r.isShielded ? Infinity : r.clauseIsOpen ? 0 : new Date(r.clauseOpenAt).getTime()) }),
        gain('clauseGainN', `Tu g. ${n}d LaLiga`, `Si lo clausulas hoy y LaLiga te ofrece +10 % en ${n} días`),
        col('dailyGrowth', 'Crec. diario', { fmt: fmtK, num: true, colored: true }),
        ...sportCols,
      ];
    case 'money':
      return [
        col('name', 'Manager', { render: (r) => <span className="font-medium">{r.isMe ? '⭐ ' : ''}{r.name}</span> }),
        col('position', 'Pos', { num: true }),
        col('points', 'Pts', { num: true }),
        money('teamValue', 'Valor equipo'),
        money('estimated', 'Dinero (base)', 'Inicial + ventas + premios − compras'),
        money('calibrated', 'Dinero (ajustado)', 'Base + desvío observado en tu equipo (subidas de cláusula, blindajes…)'),
        money('maxBuyingPower', 'Poder de compra', 'Dinero ajustado + valor de toda su plantilla'),
        col('bids30', 'Pujas 30d', { num: true, title: 'Fichajes de mercado en 30 días con valor conocido' }),
        col('overbidMedian', 'Sobrepuja med.', { fmt: fmtPct, num: true, title: 'Cuánto paga de mediana por encima del valor' }),
        col('overbidMax', 'Sobrepuja máx.', { fmt: fmtPct, num: true }),
        col('buys7', 'Compras 7d', { num: true }),
        money('buySpend7', 'Gasto 7d'),
        col('sells7', 'Ventas 7d', { num: true }),
        money('clauseRaiseSpend', 'Subidas cláusula', 'Gasto estimado en subir cláusulas (detectado en capturas diarias)'),
        money('spent', 'Gastado'),
        money('earned', 'Ingresado ventas'),
        money('prizes', 'Premios'),
      ];
    case 'lineup':
      return [
        col('role', '', { render: (r) => r.role }),
        ...playerCols,
        ...sportCols,
        col('form', 'Forma 3j', { fmt: (v) => fmtNum(v, 1), num: true, title: 'Media de puntos de las 3 últimas jornadas' }),
        money('value', 'Valor'),
      ];
    case 'sales':
      return [
        col('name', 'Jugador', { render: (r) => <span className="font-medium">{r.name}</span> }),
        money('buyPrice', 'P. compra'),
        col('buyDate', 'Comprado', { fmt: fmtDate }),
        money('sellPrice', 'P. venta'),
        col('sellDate', 'Vendido', { fmt: fmtDate }),
        col('soldTo', 'A quién'),
        gain('effectiveGain', 'Ganancia efectiva', 'Precio de venta − precio de compra'),
      ];
    default:
      return [];
  }
};

// ---------- CSV (separador ; y coma decimal → Excel en español) ----------
const toCsv = (rows, cols) => {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const header = cols.map((c) => esc(c.label)).join(';');
  const lines = rows.map((r) => cols.map((c) => {
    const v = r[c.key];
    if (isNum(v)) return String(Math.round(v * 100) / 100).replace('.', ',');
    if (typeof v === 'boolean') return v ? 'sí' : 'no';
    return esc(v);
  }).join(';'));
  return '﻿' + [header, ...lines].join('\r\n');
};

const downloadCsv = (name, content) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ---------- tabla ----------
const SortableTable = ({ rows, columns, sort, onSort }) => {
  const sorted = useMemo(() => {
    const c = columns.find((x) => x.key === sort.key);
    if (!c) return rows;
    const val = (r) => (c.sortValue ? c.sortValue(r) : r[c.key]);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const na = va === null || va === undefined || Number.isNaN(va);
      const nb = vb === null || vb === undefined || Number.isNaN(vb);
      if (na && nb) return 0;
      if (na) return 1; // vacíos siempre al final
      if (nb) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, columns, sort]);

  // Primera columna con datos de texto (jugador / manager) fija al deslizar en horizontal
  const stickyIdx = columns.findIndex((c) => c.key === 'name');
  const stickyCls = (i, bg) => (i === stickyIdx ? `sticky left-0 z-10 ${bg} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]` : '');

  return (
    <div className="overflow-auto max-h-[calc(100vh-300px)] min-h-[300px] w-full scroll-smooth">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-20">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => onSort(c.key)}
                className={`px-2 py-2 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer select-none whitespace-nowrap ${c.num ? 'text-right' : 'text-left'} ${stickyCls(i, 'bg-gray-50 dark:bg-gray-800')}`}
              >
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                {c.title ? <Info className="inline w-3 h-3 ml-0.5 opacity-50" /> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="group border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              {columns.map((c, i) => {
                const v = r[c.key];
                const content = c.render ? c.render(r) : c.fmt ? c.fmt(v) : (v ?? '—');
                return (
                  <td key={c.key} className={`px-2 py-1.5 whitespace-nowrap ${c.num ? 'text-right tabular-nums' : ''} ${c.colored ? signClass(v) : ''} ${stickyCls(i, 'bg-white dark:bg-dark-card group-hover:bg-gray-50 dark:group-hover:bg-gray-800')}`}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
          {!sorted.length && (
            <tr><td colSpan={columns.length} className="px-2 py-6 text-center text-gray-400">Sin datos</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

// ---------- página ----------
const DEFAULT_SORT = {
  squad: { key: 'gainNLaLiga', dir: 'desc' },
  market: { key: 'gainNLaLiga', dir: 'desc' },
  rivals: { key: 'clauseGainN', dir: 'desc' },
  money: { key: 'calibrated', dir: 'desc' },
  lineup: { key: 'order', dir: 'asc' },
  sales: { key: 'sellDate', dir: 'desc' },
};

const Rentabilidad = () => {
  const a = useLeagueAnalytics();
  const [tab, setTab] = useState('squad');
  const [rateMode, setRateMode] = useState('daily');
  const [days, setDays] = useState(5);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('all');
  const [sorts, setSorts] = useState(DEFAULT_SORT);
  // Gasto en subidas de cláusula detectado por el trabajo diario (capturas)
  const [clauseSpend, setClauseSpend] = useState(null);
  useEffect(() => {
    loadState().then((st) => {
      const m = new Map();
      Object.values(st?.clauseRaises || {}).forEach((day) => Object.entries(day).forEach(([id, r]) => {
        m.set(id, (m.get(id) || 0) + (r.estimatedCost || 0));
      }));
      setClauseSpend(m);
    });
  }, []);

  const rows = useMemo(() => {
    const common = { ledger: a.ledger, resolveTrend: a.resolveTrend, rateMode };
    let r;
    switch (tab) {
      case 'squad': r = buildSquadRows({ ...common, team: a.myTeam }); break;
      case 'lineup': {
        const squad = buildSquadRows({ ...common, team: a.myTeam });
        const lu = bestLineup(squad);
        const startIds = new Set(lu.starters.map((p) => p.id));
        const tag = (p) => {
          if (lu.captain?.id === p.id) return '© Capitán';
          if (lu.coach?.id === p.id) return '🧑‍💼 Entrenador';
          if (startIds.has(p.id)) return '⚽ Titular';
          return p.positionId === 5 ? '— Entrenador' : '🪑 Suplente';
        };
        const rank = (p) => (lu.captain?.id === p.id ? 0 : startIds.has(p.id) ? 1 : lu.coach?.id === p.id ? 2 : 3);
        r = squad.map((p) => ({ ...p, role: tag(p), order: rank(p) * 100 + (p.positionId || 9) * 10 - (p.xp || 0) / 10 }));
        r.lineupMeta = { formation: lu.formation, total: lu.total, ranking: lu.ranking };
        return r;
      }
      case 'market': r = buildMarketRows({ ...common, market: a.market, ownerByPlayer: a.ownerByPlayer }); break;
      case 'rivals': r = buildRivalRows({ ...common, teams: a.teams, myTeamId: a.myTeamId }); break;
      case 'money': {
        const stats = buildBidStats({ ledger: a.ledger, trendById: a.trendById });
        const recent = recentActivity(a.ledger, { days: 7 });
        r = buildMoneyRows({ teams: a.teams, ledger: a.ledger, myTeam: a.myTeam, myMoney: a.myMoney, initialMoney: DEFAULT_INITIAL_MONEY, clauseSpend })
          .map((m) => {
            const t = a.teams.find((x) => x.teamId === m.id);
            const b = stats.byManager.get(t?.managerId) || {};
            const act = recent.get(t?.managerId) || {};
            return { ...m, bids30: b.n || 0, overbidMedian: b.median ?? null, overbidMax: b.max ?? null, buys7: act.buys || 0, buySpend7: act.buySpend || 0, sells7: act.sells || 0 };
          });
        r.bidOverall = stats.overall;
        return r;
      }
      case 'sales': r = buildSalesRows({ ledger: a.ledger, managerId: a.myTeam?.managerId, playerNames: a.playerNames }); return r;
      default: r = [];
    }
    return r;
  }, [tab, a.ledger, a.resolveTrend, a.trendById, a.myTeam, a.market, a.ownerByPlayer, a.teams, a.myTeamId, a.myMoney, a.playerNames, rateMode, clauseSpend]);

  // Recalcular proyecciones con N días distinto de 5
  const rowsN = useMemo(() => {
    if (days === 5 || !['squad', 'market', 'rivals'].includes(tab)) return rows;
    return rows.map((r) => {
      const rate = rateMode === 'avg3' ? r.growthAvg3 : rateMode === 'avg7' ? r.growthAvg7 : r.dailyGrowth;
      const valueN = isNum(r.value) && isNum(rate) ? r.value + days * rate : null;
      const laLigaN = isNum(valueN) ? valueN * 1.1 : null;
      return {
        ...r,
        valueN,
        laLigaN,
        gainN: isNum(valueN) && isNum(r.buyPrice) ? valueN - r.buyPrice : null,
        gainNLaLiga: isNum(laLigaN) && isNum(r.buyPrice) ? laLigaN - r.buyPrice : null,
        clauseGainN: isNum(laLigaN) && isNum(r.clause) ? laLigaN - r.clause : r.clauseGainN,
      };
    });
  }, [rows, days, rateMode, tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rowsN.filter((r) => {
      if (position !== 'all' && r.positionId !== undefined && String(r.positionId) !== position) return false;
      if (!q) return true;
      return [r.name, r.fullName, r.owner, r.seller, r.team].some((s) => s && s.toLowerCase().includes(q));
    });
  }, [rowsN, search, position]);

  const columns = columnsFor(tab, days);
  const sort = sorts[tab];
  const onSort = (key) => setSorts((s) => ({
    ...s,
    [tab]: { key, dir: s[tab].key === key && s[tab].dir === 'desc' ? 'asc' : 'desc' },
  }));

  // Totales de mi equipo
  const totals = useMemo(() => {
    if (tab !== 'squad') return null;
    const sum = (k) => filtered.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
    return { value: sum('value'), latent: sum('latentGain'), latentLaLiga: sum('latentGainLaLiga'), gainN: sum('gainNLaLiga') };
  }, [filtered, tab]);

  if (a.isLoading) return <LoadingState message="Cargando plantillas, mercado y actividad de la liga..." />;
  if (a.error) return <ErrorState title="No se pudieron cargar los datos de la liga" error={a.error} onRetry={a.refetchAll} />;

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary-500" /> Rentabilidad
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary flex items-center gap-1" onClick={a.refetchAll} title="Recargar datos">
            <RefreshCw className={`w-4 h-4 ${a.loadingActivity ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            className="btn-primary flex items-center gap-1"
            onClick={() => downloadCsv(`rentabilidad-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filtered, columns))}
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-3"><div className="text-xs text-gray-500">Saldo</div><div className="text-lg font-bold">{fmtM(a.myMoney)}</div></div>
        {totals ? (
          <>
            <div className="card p-3"><div className="text-xs text-gray-500">Valor plantilla</div><div className="text-lg font-bold">{fmtM(totals.value)}</div></div>
            <div className="card p-3"><div className="text-xs text-gray-500">G. latente LaLiga (hoy)</div><div className={`text-lg font-bold ${signClass(totals.latentLaLiga)}`}>{fmtM(totals.latentLaLiga)}</div></div>
            <div className="card p-3"><div className="text-xs text-gray-500">G. {days}d LaLiga</div><div className={`text-lg font-bold ${signClass(totals.gainN)}`}>{fmtM(totals.gainN)}</div></div>
          </>
        ) : (
          <div className="card p-3 col-span-1 md:col-span-3 text-xs text-gray-500 flex items-center">
            {tab === 'money'
              ? `Dinero inicial supuesto: ${fmtM(DEFAULT_INITIAL_MONEY, 0)}. "Ajustado" descuenta las subidas de cláusula detectadas y aplica el desvío de tu propio saldo.${rows.bidOverall?.n ? ` Sobrepuja de la liga (30 días, ${rows.bidOverall.n} fichajes): mediana ${fmtPct(rows.bidOverall.median)}, p75 ${fmtPct(rows.bidOverall.p75)}.` : ''}`
              : tab === 'lineup' && rows.lineupMeta
                ? `Formación recomendada: ${rows.lineupMeta.formation} · ${fmtNum(rows.lineupMeta.total, 1)} pts previstos (capitán ×2 + entrenador). Alternativas: ${rows.lineupMeta.ranking.filter((x) => !x.missing).slice(1, 4).map((x) => `${x.formation} ${fmtNum(x.total, 1)}`).join(' · ')}`
              : tab === 'rivals'
                ? '"Tu g. LaLiga" = lo que ganarías si clausulas hoy y LaLiga te ofrece +10 % al final del periodo.'
                : `${filtered.length} jugadores`}
          </div>
        )}
      </div>

      {/* Controles */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {Object.entries(TABS).map(([k, t]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === k ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="input-field !py-1.5 max-w-[200px]"
          placeholder="Buscar jugador / dueño"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input-field !py-1.5 max-w-[140px]" value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="all">Todas</option>
          <option value="1">Porteros</option>
          <option value="2">Defensas</option>
          <option value="3">Medios</option>
          <option value="4">Delanteros</option>
          <option value="5">Entrenadores</option>
        </select>
        <label className="text-sm flex items-center gap-1">
          Ritmo
          <select className="input-field !py-1.5" value={rateMode} onChange={(e) => setRateMode(e.target.value)}>
            <option value="daily">Último día</option>
            <option value="avg3">Media 3 días</option>
            <option value="avg7">Media 7 días</option>
          </select>
        </label>
        <label className="text-sm flex items-center gap-1">
          Días
          <input
            type="number" min={1} max={30}
            className="input-field !py-1.5 w-16"
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 5)))}
          />
        </label>
        {!a.trendsReady && <span className="text-xs text-amber-600">Cargando tendencias de futbolfantasy…</span>}
      </div>

      <div className="card p-0 overflow-hidden max-w-full">
        <SortableTable rows={filtered} columns={columns} sort={sort} onSort={onSort} />
      </div>
    </div>
  );
};

export default Rentabilidad;
