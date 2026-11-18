# Automatización diaria

## Qué hace

En cada hora programada (configurables en *Ajustes y automatización*), la app genera una edición del informe:

| Hora (por defecto) | Edición | Para qué |
|---|---|---|
| 18:50 | ⏳ Antes del cierre | Actuar sobre el mercado del día: ofertas y pujas se resuelven a las 19:00. |
| 19:10 | 🆕 Mercado nuevo | Preparar el día siguiente. Los valores se actualizan de madrugada. Aquí se ejecuta el auto-mercado. |

En cada una:

1. Descarga datos frescos de la liga y de futbolfantasy.
2. Guarda una captura local del día.
3. Ejecuta el **auto-mercado** si está activado (solo en la edición de mercado nuevo).
4. Evalúa la previsión de las jornadas ya terminadas.
5. Escribe en la carpeta de exportación:
   - `informe-fantasy.pdf`: informe visual (móvil y PC);
   - `informe-fantasy.md`: misma información en texto, ideal para Claude u otros asistentes;
   - `plantilla.json`: todos los datos estructurados.
6. Muestra una notificación de Windows y, si está configurado, envía a **Telegram** el resumen y el PDF.

Si la app no estaba abierta a la hora programada, el trabajo se ejecuta en cuanto se abre.

## Tarea programada (portátil en suspensión)

`scripts/register-task.ps1` crea la tarea **"LaLigaFantasy - Informe diario"**, que:

- lanza `LaLiga Fantasy App.exe --daily-run` todos los días a cada hora indicada;
- **despierta el equipo** si está en suspensión (`WakeToRun`);
- se ejecuta en cuanto sea posible si se perdió la hora (`StartWhenAvailable`);
- tiene un límite de 20 minutos.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1                    # 18:50 y 19:10
powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1 -At 18:45,19:15    # otras horas
powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1 -Remove    # eliminarla
```

Con `--daily-run` la app se abre minimizada, hace el trabajo, impide que el equipo vuelva a
dormirse mientras tanto y se cierra sola. Si ya estaba abierta, la instancia abierta ejecuta el
trabajo y no se cierra.

Requisitos:
- **Suspender** el equipo, no apagarlo. En portátiles, mejor **enchufado**: por defecto Windows
  solo permite los temporizadores de reactivación con corriente (`powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE`).
- Haber iniciado sesión en la app al menos una vez (la sesión se renueva sola).

## Google Drive

1. Instala **Google Drive para escritorio** e inicia sesión (aparece una unidad, p. ej. `G:\Mi unidad`).
2. En *Ajustes y automatización* → **Cambiar carpeta**, elige una carpeta de esa unidad.
3. Los archivos se sobrescriben cada día: en Drive siempre está solo el último informe.

Desde el móvil, abre `informe-fantasy.pdf` con la app de Google Drive. Para un asistente con
acceso a Drive, `informe-fantasy.md` y `plantilla.json` son los más cómodos de leer.

## Telegram

1. En Telegram, abre **@BotFather**, envía `/newbot` y elige nombre y usuario (acabado en `bot`).
2. Copia la clave del bot y pégala en *Ajustes → Notificaciones al móvil*. Se guarda cifrada con tu usuario de Windows (`safeStorage`) y solo la usa el proceso principal.
3. Abre tu bot, pulsa **Iniciar** y después **Detectar mi chat** en la app.
4. **Enviar prueba** para comprobarlo.

Cada informe llega como mensaje (cifras clave y *Qué hacer*) con el PDF adjunto. Los errores también se notifican.

## Avisos de cláusulas

Con la app abierta (aunque esté minimizada), se envía una notificación cuando se abre la
cláusula de un jugador rival de la lista del último informe (próximas 48 h). Si el equipo estaba
dormido, el aviso llega al volver, con un máximo de 12 horas de retraso.

## Auto-mercado

Desactivado y en modo simulación por defecto. Cuando está activo, pone a la venta a su valor de
mercado los jugadores propios que no estén ya en el mercado y no estén en la lista de exclusión,
con 1,5 s entre acciones y un máximo de 30 por ejecución. Nunca acepta ofertas, puja ni retira.
El resultado aparece en el informe y en *Ajustes*.

## Solución de problemas

| Síntoma | Qué revisar |
|---|---|
| No se genera a la hora programada | La tarea existe (`Get-ScheduledTask "LaLigaFantasy - Informe diario"`), el equipo estaba en suspensión y enchufado, sesión iniciada en la app. |
| "Informe Fantasy: no generado" | Sesión caducada o sin conexión: abre la app e inicia sesión. |
| El PDF no aparece | *Ajustes* muestra el error del último intento; el `.md` y el `.json` se escriben igualmente. |
| No llegan avisos de cláusula | La app debe estar abierta; la lista se crea al generar un informe. |
