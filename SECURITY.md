# Seguridad

## Versiones soportadas

Solo se mantiene la última versión de la rama `main`.

## Cómo informar de una vulnerabilidad

Es un repositorio privado de uso personal. Si tienes acceso y encuentras un problema de
seguridad, **no abras una incidencia pública**: escribe directamente al propietario del
repositorio (`alfreedx`) describiendo el problema, cómo reproducirlo y su impacto.

Si el problema afecta también al proyecto original, notifícalo a
[Externoak/LaLigaApp](https://github.com/Externoak/LaLigaApp).

## Principios del proyecto

- **Credenciales**: los tokens de LaLiga Fantasy se guardan cifrados en la carpeta de datos de
  la app (lógica heredada del original). Nunca se escriben en informes, capturas, logs de
  depuración ni en el repositorio.
- **Acciones sobre la cuenta**: la app solo **lee** de la API, salvo:
  - acciones que el usuario confirma en la interfaz (pujas, ventas, guardar alineación…), y
  - el **auto-mercado**, opcional, desactivado y en simulación por defecto, que únicamente pone
    jugadores a la venta (nunca acepta ofertas, puja ni retira).
- **Datos personales**: informes, capturas diarias y ajustes se guardan fuera del repositorio
  (`%APPDATA%\laliga-fantasy-app\fantasy-data` y la carpeta de exportación elegida). `.gitignore`
  bloquea además los nombres de esos archivos por si se copian aquí por error.
- **Contenido externo**: los nombres de jugadores y managers vienen de la API y se escapan
  siempre antes de insertarse en HTML. El PDF se genera en una ventana con sesión aislada, sin
  JavaScript ni acceso a red.
- **Actualizaciones**: la instalación automática de versiones del repositorio original está
  desactivada en el proceso principal de Electron.
- **Captura de depuración**: el servidor solo guarda respuestas de la API si se arranca con
  `API_CAPTURE_DIR`; nunca guarda cabeceras ni rutas de autenticación.
