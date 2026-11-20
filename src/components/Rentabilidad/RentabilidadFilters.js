import React from 'react';
import { Filter, X } from 'lucide-react';
import { EMPTY_FILTERS, countActiveFilters } from '../../services/analytics/filters';

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-0.5 text-xs text-gray-500 dark:text-gray-400">
    {label}
    {children}
  </label>
);

const Select = ({ value, onChange, options }) => (
  <select className="input-field !py-1 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

const Check = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-1.5 text-sm cursor-pointer self-end pb-1">
    <input type="checkbox" className="w-4 h-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

/** Panel de filtros de Rentabilidad (mi equipo, mercado y rivales). */
const RentabilidadFilters = ({ tab, filters, setFilters, owners = [], days, open, setOpen }) => {
  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));
  const active = countActiveFilters(filters);
  const hasClause = tab === 'squad' || tab === 'rivals';
  const hasCost = tab === 'rivals' || tab === 'market';

  return (
    <div className="card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !py-1 text-sm flex items-center gap-1" onClick={() => setOpen(!open)}>
          <Filter className="w-4 h-4" /> Filtros{active ? ` (${active})` : ''}
        </button>
        {active > 0 && (
          <button className="text-xs text-red-600 hover:underline flex items-center gap-0.5" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X className="w-3 h-3" /> Limpiar
          </button>
        )}
        {/* Atajos más usados */}
        {hasClause && (
          <div className="flex flex-wrap gap-1 ml-auto">
            {[['open', '🟢 Cláusula abierta'], ['24h', 'Se abre ≤ 24 h'], ['48h', '≤ 48 h']].map(([v, l]) => (
              <button
                key={v}
                onClick={() => set('clause')(filters.clause === v ? 'all' : v)}
                className={`px-2 py-0.5 rounded-full text-xs border ${filters.clause === v ? 'bg-primary-500 text-white border-primary-500' : 'border-gray-300 dark:border-gray-600'}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {hasClause && (
            <>
              <Field label="Cláusula">
                <Select value={filters.clause} onChange={set('clause')} options={[
                  ['all', 'Todas'], ['open', 'Abierta'], ['24h', 'Abierta o se abre ≤ 24 h'], ['48h', 'Abierta o se abre ≤ 48 h'],
                  ['7d', 'Abierta o se abre ≤ 7 días'], ['closed', 'Cerrada'], ['shielded', 'Blindado'],
                ]} />
              </Field>
              <Field label="Cláusula vs valor">
                <Select value={filters.clauseVsValue} onChange={set('clauseVsValue')} options={[
                  ['all', 'Cualquiera'], ['lt10', '< +10 %'], ['10-25', '+10 % a +25 %'], ['25-50', '+25 % a +50 %'],
                  ['50-100', '+50 % a +100 %'], ['gt100', '> +100 %'],
                ]} />
              </Field>
            </>
          )}
          <Field label="Valor (M €)">
            <div className="flex gap-1">
              <input className="input-field !py-1 text-sm w-full" placeholder="mín" inputMode="decimal" value={filters.valueMin} onChange={(e) => set('valueMin')(e.target.value)} />
              <input className="input-field !py-1 text-sm w-full" placeholder="máx" inputMode="decimal" value={filters.valueMax} onChange={(e) => set('valueMax')(e.target.value)} />
            </div>
          </Field>
          <Field label="Tendencia (según ritmo)">
            <Select value={filters.trend} onChange={set('trend')} options={[['all', 'Cualquiera'], ['up', '↑ Sube'], ['down', '↓ Baja']]} />
          </Field>
          <Field label="Estado">
            <Select value={filters.status} onChange={set('status')} options={[['all', 'Todos'], ['ok', 'Disponibles'], ['issues', 'Lesión / duda / sanción']]} />
          </Field>
          <Field label="Prob. de jugar">
            <Select value={filters.minProb} onChange={set('minProb')} options={[['all', 'Cualquiera'], ['50', '≥ 50 %'], ['70', '≥ 70 %'], ['90', '≥ 90 %']]} />
          </Field>
          <Field label="xP mínimo">
            <input className="input-field !py-1 text-sm" inputMode="decimal" placeholder="p. ej. 5" value={filters.minXp} onChange={(e) => set('minXp')(e.target.value)} />
          </Field>
          {tab === 'rivals' && (
            <Field label="Dueño">
              <Select value={filters.owner} onChange={set('owner')} options={[['all', 'Todos'], ...owners.map((o) => [o, o])]} />
            </Field>
          )}
          {hasCost && <Check checked={filters.affordable} onChange={set('affordable')} label={tab === 'rivals' ? 'Cláusula ≤ mi saldo' : 'Precio ≤ mi saldo'} />}
          <Check checked={filters.profitable} onChange={set('profitable')} label={`Gana dinero en ${days} d (LaLiga)`} />
        </div>
      )}
    </div>
  );
};

export default RentabilidadFilters;
