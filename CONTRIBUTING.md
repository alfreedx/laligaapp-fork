# Cómo contribuir

Fork personal de [LaLigaApp](https://github.com/Externoak/LaLigaApp). Estas pautas sirven para
mantener el código ordenado y fácil de sincronizar con el proyecto original.

## Flujo de trabajo

1. Crea una rama desde `main`: `git checkout -b feat/descripcion-corta`.
2. Haz cambios pequeños y con sentido propio; un commit por idea.
3. Antes de subir:
   ```powershell
   npm run lint
   npm run test:ci
   npm run build
   ```
4. Abre un pull request usando la plantilla. La integración continua debe pasar.
5. Añade la entrada correspondiente en [CHANGELOG.md](CHANGELOG.md) (sección *Sin publicar*).

Mensajes de commit en español, en imperativo y con un resumen corto en la primera línea
(p. ej. `Informe: excluye jugadores puestos a la venta por otros managers`).

## Convenciones de código

- La lógica de negocio va en **funciones puras** con tests (`src/services/analytics`,
  `src/services/automation`), separada de los componentes React.
- No guardes datos de la liga ni tokens en el repositorio; los tests usan **datos ficticios**.
- Todo texto que venga de la API y se inserte en HTML debe escaparse.
- Cualquier nueva acción de escritura contra la API debe ser explícita para el usuario o, si es
  automática, opcional, desactivada por defecto y con modo simulación.
- Estilo: el de ESLint del proyecto; 2 espacios; ver `.editorconfig`.

## Sincronizar con el proyecto original

El remoto `upstream` apunta a Externoak/LaLigaApp:

```powershell
git remote add upstream https://github.com/Externoak/LaLigaApp.git   # una sola vez
git fetch upstream
git checkout -b sync/upstream-X.Y.Z
git merge upstream/master
```

Resuelve los conflictos priorizando los cambios del fork documentados en el CHANGELOG
(en especial, mantener desactivada la actualización automática en `electron/ipc-handlers.js`),
pasa los tests y abre un pull request.

## Licencia

Al contribuir aceptas que tu aportación se distribuya bajo **GPL-3.0-or-later con Términos
Adicionales — Atribución**, como el resto del proyecto (ver [LICENSE](LICENSE) y [NOTICE](NOTICE)).
