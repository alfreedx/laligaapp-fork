# Notas sobre la API de LaLiga Fantasy (temporada 26/27)

La API **no es pública ni está documentada**. Estas notas recogen el comportamiento observado al
desarrollar el fork; pueden cambiar sin aviso. Base: `https://fantasy-api.llt-services.com/api`,
rutas con prefijo de competición `/v1/competition/1`.

## Actividad de la liga

`GET /leagues/{leagueId}/activity/{index}`: páginas desde `0` hasta que una llega vacía. Contiene
el historial completo desde la creación de la liga.

| `activityTypeId` | Significado | Campos |
|---|---|---|
| 31 | Fichaje del mercado (LaLiga → `user1`) | `amount` = precio |
| 1 | Compra a otro manager (`user2` → `user1`) | `amount` = precio |
| 32 | Cláusula pagada (`user2` → `user1`) | `amount` |
| 33 | Venta a LaLiga (`user1`) | `amount` |
| 6 | Premio de jornada | `amount`, `weekNumber` |
| 12 | Bonus de jornada | `amount`, `weekNumber` |
| 4 | Blindaje | sin importe |
| 2 / 3 | Transferencia / devolución entre managers | `amount` |
| 7, 9, 5, 13–19 | Alineación incorrecta, nuevo miembro, configuración de liga… | — |

Verificado: el **comprador es siempre `user1`** y el vendedor `user2` (coincide al 100 % con las
plantillas). La subida de cláusulas **no aparece** en la actividad.

## Equipos y dinero

- `GET /leagues/{leagueId}/teams/{teamId}`: plantilla con `buyoutClause`,
  `buyoutClauseLockedEndTime` (apertura de la cláusula), `isShielded`, `playerMarket` (si está en
  venta: `salePrice`, `expirationDate`, `numberOfOffers`) y `playerMaster` (`marketValue`,
  `points`, `averagePoints`, `playerStatus`, `lastStats` por jornada).
- `teamMoney` solo viene para el **equipo propio** (`GET /teams/{teamId}/money`); para rivales es `null`.

## Mercado y ofertas

- `GET /league/{leagueId}/market`: jugadores libres (`discr: marketPlayerLeague`) y de managers.
- `GET /league/{leagueId}/playerTeam/{playerTeamId}/offer`: ofertas recibidas (`money`,
  `expirationDate`, `status`). LaLiga hace una oferta diaria (±10 % del valor) a los jugadores en venta.
- `POST /league/{leagueId}/market/sell` `{ playerId: playerTeamId, salePrice }`: poner a la venta.

## Alineación

`GET /teams/{teamId}/lineup` → `formation` con `goalkeeper` / `defender` / `midfield` / `striker`
(listas de jugadores), `tacticalFormation` `[D, M, F]` y, en ligas premium:

- `coach`: lista con el entrenador;
- `captain`: `playerTeamId` del capitán como **string** (no aparece si no hay capitán);
- `bench`: objeto con **un suplente por línea** (`goalkeeper`, `defender`, `midfield`, `striker`).

`PUT /teams/{teamId}/lineup` (verificado en una liga premium):

```json
{
  "goalkeeper": "<playerTeamId>",
  "defender": ["<id>", "..."],
  "midfield": ["<id>", "..."],
  "striker": ["<id>", "..."],
  "tactical_formation": [3, 4, 3],
  "coach": "<playerTeamId>",
  "captain": "<playerTeamId>",
  "bench": { "goalkeeper": "<id>", "defender": "<id>", "midfield": "<id>", "striker": "<id>" }
}
```

El editor relee la alineación tras guardar y compara campo por campo.

## Jornada

`GET /week/current` → `weekNumber`, `isLive`, `openingWeekDate`, `closingWeekDate`.

## futbolfantasy.com (scraping)

La página de mercado de análisis incluye por jugador (`data-*`): `valor`, `valor1/2/3/7/14/30`
(valor hace N días), `diferencia*`, `tendencia`, `aceleracion` y, en la columna de próximo rival,
el título `Jornada N · Próximo rival: X (Casa|Fuera)` y la probabilidad de jugar (`NN%`), que no
existe para todos los jugadores.

## Prudencia

- Usar ritmos humanos (pausas entre peticiones) para evitar `429` y no sobrecargar el servicio.
- Ante cambios de formato, preferir no escribir y avisar al usuario a escribir datos incompletos.
