# Changelog

Todos los cambios relevantes de este fork se documentan aquí. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); las versiones del fork siguen
[SemVer](https://semver.org/lang/es/) con el sufijo `-fork`.

Este archivo cumple además el requisito de la GPLv3 §5a: indica qué se ha modificado respecto
a **LaLigaApp 3.5.7** de Externoak y cuándo. Para el historial del proyecto original, ver
[docs/upstream/README.md](docs/upstream/README.md) y el repositorio original.

## [Sin publicar]

### Añadido
- Documentación profesional: README del fork, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `docs/ARQUITECTURA.md`, `docs/AUTOMATIZACION.md` y `docs/API-NOTAS.md`.
- Plantillas de incidencias y de pull request, `.editorconfig` y `.gitattributes`.
- Integración continua (tests, lint y compilación) en GitHub Actions.
- Scripts `npm run lint` y `npm run test:ci`; `scripts/register-task.ps1` para crear la tarea programada.
- Informe: en las oportunidades, **puja máxima rentable** (lo máximo que se puede pagar sin perder
  dinero vendiendo a LaLiga en N días), **rentabilidad %** sobre el coste y aviso si la puja habitual
  de la liga la supera.
- Informe: las oportunidades deportivas indican **a quién mejoran de la alineación guardada** y por
  cuántos puntos, y se ordenan priorizando las que mejoran el once.
- **Dos informes al día**: 18:50 *Antes del cierre* (actuar sobre el mercado del día) y 19:10
  *Mercado nuevo* (preparar el siguiente; el auto-mercado solo se ejecuta aquí). Horas configurables.
- **Notificaciones al móvil por Telegram** (bot propio): resumen con *Qué hacer*, PDF adjunto,
  avisos de cláusulas y errores. Clave del bot cifrada con `safeStorage` en el proceso principal.
- Los avisos de cláusulas llegan **2 minutos antes** de la apertura («Cláusula en 2 min»).
- **Inicio de jornada**: se lee el primer partido del calendario. Las cláusulas se tratan como
  **bloqueadas** desde 24 h antes hasta ese partido (protección, oportunidades, avisos y Rentabilidad).
- **Resumen de inicio de jornada** por Telegram 1 h antes del primer partido: puntos previstos de la
  alineación guardada, alertas (lesionados, dudas, sin capitán) y cambios frente a la recomendada.
  Se programa solo con una tarea de Windows de un solo uso que despierta el equipo.
- **Ofertas**: buena solo si supera el valor en un **5 %** o más; *Venta fuerte* (con motivo
  deportivo: lesión, poca probabilidad de jugar, fuera del once, mala jornada) u *Oportunidad*.
- Rentabilidad: **crecimiento diario en %** además del absoluto (también en el informe) y
  **filtros** (estado y apertura de cláusula, cláusula vs valor por rangos, valor, tendencia,
  estado, probabilidad de jugar, xP, dueño, asequible con mi saldo, rentable en N días).

- **Bot de Telegram con comandos**: `/clausula nombre` (cuándo se abre, precio, si te llega,
  aviso 2 min antes y evento de calendario con alarma para el móvil), `/avisos` y `/ayuda`. Solo
  atiende al chat configurado y solo lee datos.
- Informe: oportunidades separadas en **mercado de LaLiga** y **cláusulas de otros managers**.
- **xP v2** (método acordado con un "consejo" de revisión y validado con un backtest retroactivo
  sin fuga de datos sobre J4–J12): P(titular) × puntos por titularidad (≥ 60', media ponderada por
  recencia y encogida a la media de su posición) + P(suplente) × puntos de banquillo, × factor
  rival según el calendario (±15 %). Casa/fuera eliminado (no mejoraba). Backtest: MAE 2,88 → 2,78,
  Spearman por posición 0,376 → 0,398, puntos perdidos por el once frente al óptimo 13,5 → 13,1 por
  jornada (mejora pequeña, dentro del ruido estadístico de 9 jornadas).
- Backtest retroactivo del xP (`--daily-run --backtest`, solo lectura): MAE, Spearman, *regret*
  del once e intervalo bootstrap. Se guarda cada día la probabilidad de jugar de futbolfantasy
  en la captura local para poder validarla en el futuro.
- Ofertas: "mala jornada prevista" pasa a ser relativa a su posición (< 50 % del titular medio).

### Cambiado
- Rentabilidad → *Mercado hoy*: solo los jugadores que pone LaLiga (sin los de otros managers).
- El README original de LaLigaApp se conserva íntegro en `docs/upstream/`.
- Repositorio público.

### Eliminado
- Código sin uso heredado: `CorsHelp`, `PlayerCard`, `Dashboard/MarketTrends` (esqueleto),
  `TopPlayers`, `VersionInfo`.
- Despliegue web con Docker/nginx (`docker/`, `docker-compose.yml`, `nginx.conf`, `.dockerignore`):
  el fork es de escritorio y su automatización requiere Electron.
- Lanzador `index.js` (sustituido por los scripts de npm) y `version.json` (las notas de versión se
  leen del repositorio original).
- Imágenes sin uso en `build-resources/` y dependencias sin uso (`supertest`, `@types/dompurify`).

### Corregido
- Aviso de ESLint en el manejador de errores del servidor (`_next`).

## [1.0.0-fork] — 2026-11-18

Primera versión del fork, basada en LaLigaApp 3.5.7.

### Añadido
- **Rentabilidad** (`/rentabilidad`): precio de compra de todos los jugadores de la liga
  reconstruido desde la actividad, ganancia latente y efectiva, mejor oferta de LaLiga (+10 %),
  proyección a N días con el histórico de futbolfantasy (1/2/3/7/14/30 días), exportación CSV.
  Pestañas: mi equipo, once, mercado (sin mis jugadores), rivales, dinero de rivales y mis ventas.
- **Previsión de puntos (xP)** con media, forma, casa/fuera y probabilidad de jugar; optimizador
  de alineación con formaciones estándar y premium.
- **Mi Alineación**: botón *Cargar recomendada*; capitán, entrenador y banquillo editables y
  guardados con la alineación, con verificación posterior contra la API.
- **Inteligencia de rivales**: dinero estimado, sobrepuja por manager, puja sugerida, actividad de
  7 días y subidas de cláusula detectadas entre capturas diarias.
- **Protección de la plantilla** frente a cláusulas (blindar / subir con coste razonable / asumible).
- **Informe diario automático** tras el reseteo del mercado, en PDF (A4 vertical), Markdown y JSON:
  cifras clave, *Qué hacer hoy*, once dibujado, ofertas con ganancia, oportunidades (mercado de
  LaLiga + cláusulas que se abren en ≤ 48 h), plantilla y rivales.
- **Precisión de la previsión**: se guarda antes de cada jornada y se compara con los puntos reales.
- **Avisos de apertura de cláusulas** de rivales (notificación de Windows).
- **Auto-mercado** opcional (desactivado y en simulación por defecto): relista a valor de mercado
  los jugadores propios; nunca acepta ofertas ni puja.
- Modo `--daily-run` e instancia única en Electron; página de **Ajustes y automatización**.
- Captura opcional de respuestas de la API para depuración (`API_CAPTURE_DIR`; sin cabeceras ni tokens).

### Cambiado
- Interfaz: aviso de versión modificada con la atribución al proyecto original.

### Eliminado
- Workflows de release automática del proyecto original (no aplicables al fork).

### Seguridad
- Actualización automática desde el repositorio original **desactivada** (sobrescribiría el fork).
- PDF generado en ventana oculta con sesión aislada, sin JavaScript ni red; texto de la API escapado.

[Sin publicar]: https://github.com/alfreedx/laligaapp-fork/compare/v1.0.0-fork...HEAD
[1.0.0-fork]: https://github.com/alfreedx/laligaapp-fork/releases/tag/v1.0.0-fork
