# CierreCaja.Task

> Cubre: Unidad 2 — Sesión 17–19 — "Orquestación de Servicios"
> Unidad 3 — Sesión 27–28 — "BPM • Relación BPM ↔ SOA"

**Servicio de tarea** · Nivel **N1** · **Sin base de datos propia** · Puerto `3023`

---

## Propósito

Cierra el turno de caja: arquea lo esperado contra lo contado y, antes de hacerlo, intenta
vaciar la cola de comprobantes que aún no llegaron a SUNAT.

### Objetivo estratégico que soporta

> *Que al final del día se sepa exactamente cuánto dinero hay y cuánto trámite queda.*

El arqueo por sí solo responde lo primero. Lo segundo — cuántos comprobantes cerraron el turno
sin llegar a la autoridad — es lo que en la práctica se pierde de vista, y es lo que hace que
la conciliación del día siguiente sea un problema.

---

## Segundo consumidor del motor BPMN

Este servicio existe también como **prueba de reutilización (P4)**: usa
[`@pos/orquestacion`](../../../orquestacion/) sin modificarlo. Que el mismo motor ejecute dos
procesos con estructuras distintas es lo que hace real ese principio, en vez de afirmarlo en un
documento.

El modelo vive en [`orquestacion/definiciones/cierre-caja.bpmn`](../../../orquestacion/definiciones/cierre-caja.bpmn)
y se consulta en caliente:

```
GET /procesos/cierre-caja/definicion
```

### Los tres pasos

| # | Actividad | Servicio | Nota |
| :--- | :--- | :--- | :--- |
| 1 | `ConsultarTurno` | Sales & Customer | Sin turno abierto no hay nada que cerrar |
| 2 | `DrenarPendientes` | E-Invoicing | **Best-effort**: nunca bloquea el cierre |
| 3 | `CerrarTurno` | Sales & Customer | Arqueo. A partir de aquí el turno no admite movimientos |

### Los dos desenlaces — ambos `200`

| Fin en el modelo | HTTP | Qué pasó |
| :--- | :--- | :--- |
| `FinCuadrado` | `200` | Lo contado coincide con lo esperado |
| `FinDescuadre` | `200` | El turno **quedó cerrado**, con diferencia registrada |

Un descuadre no es un fallo de la operación: es un hecho del arqueo. Devolver un error haría
creer al terminal que el cierre no ocurrió, y el cajero lo reintentaría sobre un turno ya
cerrado.

---

## Por qué **no** lleva compensación

Cerrar un turno no se deshace. Si el arqueo sale descuadrado, el descuadre se **registra** y
queda para revisión del supervisor (RF-CAJA-08) — no se "revierte" el cierre.

Añadir aquí una compensación sería aplicar la técnica porque el temario la nombra, no porque el
negocio la pida. Hay una prueba que verifica que el `.bpmn` **no** declara
`compensateEventDefinition`: si alguien la añade sin justificarla, se cae.

> La compensación real del inventario está en
> [`ProcesoVenta.Task`](../proceso-venta/README.md), donde sí hay un efecto reversible.

---

## Dos decisiones que conviene mirar

**Tolerancia de arqueo = 0.** Una caja cuadra o no cuadra. Un margen "razonable" es justo el
hueco por donde se escapan los faltantes pequeños y repetidos, que es la forma más común de
merma. Está declarada como constante en [`src/actividades.ts`](src/actividades.ts): si el
negocio quiere tolerancia, se cambia ahí y queda a la vista.

**`comprobantesPendientes: null` no es cero.** Si ni siquiera se pudo consultar la cola —porque
no hay conexión— el servicio responde `null`. Decir "cero pendientes" cuando no se pudo mirar
sería mentir sobre el estado tributario del día.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Tarea | Encapsula un proceso de negocio |
| **Estado** | Stateless | El estado vive en el motor mientras dura la ejecución (P6) |
| **Comunicación** | Síncrona | El cajero no se va sin saber si la caja cuadró |
| **Granularidad** | Gruesa | Una operación que agrupa el drenaje y el arqueo |
| **Rol** | Compositor | Coordina sin ser proveedor de datos |
| **Seguridad** | Exige `codigoAutorizacion` de supervisor ([ADR-001](../../../docs/adr/001-seguridad-roles-pin.md)) |

---

## Uso

```bash
pnpm --filter @pos/cierre-caja dev      # requiere el ESB en :3000
pnpm --filter @pos/cierre-caja test
```

```bash
curl -X POST http://localhost:3000/procesos/cierre-caja \
  -H 'content-type: application/json' \
  -d '{
    "cajaId": "CAJA-01",
    "modo": "CIEGO",
    "montoContado": 320,
    "codigoAutorizacion": "sup:1234"
  }'
```

## Variables de entorno

| Variable | Por defecto | Para qué |
| :--- | :--- | :--- |
| `PORT` | `3023` | Puerto del servicio |
| `ESB_URL` | `http://localhost:3000` | Única salida del servicio |
| `AUDITORIA_URL` | `http://localhost:3012` | Destino de la traza del proceso |
