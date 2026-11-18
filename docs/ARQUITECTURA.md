# Arquitectura

## Visión general

```
┌──────────────┐   IPC (preload)   ┌───────────────────────────────┐
│  React (UI)  │ ◄───────────────► │ Electron (proceso principal)   │
│  src/        │                   │ electron/automation.js: PDF,   │
│              │                   │ notificaciones, --daily-run     │
└──────┬───────┘                   └───────────────────────────────┘
       │ HTTP (token en cabecera)
┌──────▼────────────────┐        ┌───────────────────────────────────┐
│ Proxy local (server/) │ ─────► │ API LaLiga Fantasy (llt-services) │
│ puerto 3005           │ ─────► │ futbolfantasy.com (scraping)      │
└───────────────────────┘        └───────────────────────────────────┘
```

- **Proxy local** (`server/`): evita CORS y reenvía las peticiones a la API. Opcionalmente guarda
  respuestas para depuración (`API_CAPTURE_DIR`).
- **Renderer** (`src/`): toda la lógica de negocio y la interfaz. El token vive aquí (`authStore`).
- **Proceso principal** (`electron/`): ventanas, IPC, escritura de archivos fuera de la app,
  generación del PDF y modo de ejecución diaria.

## Módulos del fork

### `src/services/analytics/` (funciones puras, con tests)

| Módulo | Responsabilidad |
|---|---|
| `ledger.js` | Reconstruye el libro de operaciones desde la actividad: adquisición vigente de cada jugador, ventas con ganancia efectiva y flujos de dinero por manager. |
| `valuation.js` | Columnas de rentabilidad: latente, LaLiga +10 %, crecimiento diario/3d/7d, proyección a N días, ROI, puntos por millón. |
| `forecast.js` | Puntos esperados (xP) y optimizador de alineación (formaciones estándar y premium). |
| `rivalIntel.js` | Sobrepuja por manager (valor interpolado en la fecha de compra), puja sugerida, actividad reciente, subidas de cláusula entre capturas. |
| `protection.js` | Exposición de la plantilla a cláusulas y recomendación (blindar / subir / asumible). |
| `backtest.js` | Guarda la previsión por jornada y la evalúa con los puntos reales. |
| `rows.js` | Une lo anterior en filas para tablas e informe. |

### `src/services/automation/`

| Módulo | Responsabilidad |
|---|---|
| `dataLoader.js` | Descarga imperativa de todos los datos (equipos, actividad completa, mercado, ofertas, jugadores, futbolfantasy). |
| `report.js` | `buildReportModel` (cálculos y *Qué hacer hoy*), `renderMarkdown`, JSON y captura diaria. |
| `reportHtml.js` / `reportFormat.js` | Presentación visual para el PDF y formateadores compartidos. |
| `dailyJob.js` | Orquesta el trabajo diario: captura, auto-mercado, backtest, informe, exportación y notificación. |
| `autoMarket.js` | Plan y ejecución del auto-mercado (con simulación). |
| `clauseAlerts.js` | Avisos de apertura de cláusulas. |
| `localStore.js` | Ajustes, estado y capturas en `userData/fantasy-data` (o `localStorage` en web). |

### Interfaz

- `components/Rentabilidad/Rentabilidad.js`: página de análisis (usa `hooks/useLeagueAnalytics.js`).
- `components/Automation/DailyAutomation.js`: componente invisible que lanza el trabajo diario y los avisos.
- `components/Settings/AutomationSettings.js`: ajustes de automatización.
- `components/Teams/LineupEditor.js`: editor de alineación ampliado.

## Flujo del trabajo diario

1. `DailyAutomation` comprueba cada minuto si toca ejecutar (`isRunDue`): último horario
   programado ya pasado y sin ejecución exitosa posterior.
2. `runDailyJob` → `loadLeagueData` → captura diaria (y comparación con la anterior para
   detectar subidas de cláusula) → auto-mercado → evaluación de previsiones → `buildDailyReport`.
3. Escritura atómica en la carpeta de exportación (`automation:write-export` y `automation:write-pdf`).
4. Estado en `fantasy-data/state.json`: última ejecución, previsiones, evaluaciones, cláusulas vigiladas.

## Datos persistentes (fuera del repositorio)

| Ruta | Contenido |
|---|---|
| `%APPDATA%\laliga-fantasy-app\fantasy-data\settings.json` | Ajustes de automatización |
| `…\fantasy-data\state.json` | Estado del trabajo diario |
| `…\fantasy-data\snapshots\AAAA-MM-DD.json` | Capturas diarias (valores, cláusulas, mercado) |
| `…\fantasy-data\clause-alerts.json` | Avisos de cláusula ya enviados |
| `…\fantasy-automation.json` | Carpeta de exportación |
| Carpeta de exportación | `informe-fantasy.pdf`, `informe-fantasy.md`, `plantilla.json` |
