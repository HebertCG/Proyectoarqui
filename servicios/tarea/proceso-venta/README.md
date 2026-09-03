# ProcesoVenta.Task

> Cubre: Unidad 2 — Sesión 17–19 — "Orquestación de Servicios"
> Unidad 3 — Sesión 27–28 — "BPM • Relación BPM ↔ SOA"
> Unidad 3 — Sesión 29 — "Integridad de procesos: transacciones, idempotencia y compensación"

**Servicio de tarea** · Nivel **N1** · **Sin base de datos propia** · Puerto `3020`

---

## Propósito

Ejecuta el proceso de negocio *venta de mostrador hasta comprobante fiscal* de principio a
fin, coordinando `Sales & Customer Service` y `E-Invoicing Service`.

### Objetivo estratégico que soporta

> *Que ninguna venta quede a medias: o hay venta con comprobante válido, o no hay venta.*

Ese es el punto entero de un servicio de tarea. Sin él, la secuencia
`verificar → cobrar → facturar → enviar` queda repartida entre quien llame a los servicios, y
cada consumidor la implementa a su manera — incluido el paso que casi nadie implementa: qué
hacer cuando SUNAT rechaza algo que ya se cobró.

---

## El modelo BPMN **es** el código

El proceso vive en [`orquestacion/definiciones/proceso-venta.bpmn`](../../../orquestacion/definiciones/proceso-venta.bpmn),
un archivo BPMN 2.0 con diagrama incluido que se abre en [bpmn.io](https://bpmn.io) o Camunda
Modeler. Ese archivo **es el que ejecuta `bpmn-engine`**.

No hay una "versión de código" del proceso que pueda desviarse del diagrama. Mover una flecha
en el modelador cambia el comportamiento en producción, y las pruebas se caen si la ruta que
cambió estaba cubierta.

El modelo se puede consultar en caliente:

```
GET /procesos/venta/definicion   →   el XML BPMN que este servicio va a ejecutar
```

### Los cuatro pasos

| # | Actividad | Servicio | ¿Compensable? |
| :--- | :--- | :--- | :--- |
| 1 | `VerificarComprobante` | Sales & Customer | No: solo lee |
| 2 | `CerrarVenta` | Sales & Customer | **Sí** → `RevertirVenta` |
| 3 | `RegistrarComprobante` | E-Invoicing | No: idempotente y append-only |
| 4 | `EnviarASunat` | E-Invoicing (SOAP vía ESB) | No: es la llamada externa |

### Los cuatro desenlaces

Cada evento de fin del diagrama corresponde a una respuesta HTTP. La tabla es explícita en
[`src/rutas.ts`](src/rutas.ts): añadir un fin al modelo sin decidir qué significa se detecta en
el borde, no con un estado inventado.

| Fin en el modelo | HTTP | Qué pasó |
| :--- | :--- | :--- |
| `FinAceptado` | `200` | Venta cobrada y comprobante aceptado por SUNAT |
| `FinPendiente` | `202` | Venta cobrada; el comprobante quedó en cola (RNF-01) |
| `FinIncompatible` | `422` | **No se cobró**: el comprobante no correspondía al documento |
| `FinCompensado` | `409` | Se cobró y **se revirtió**: SUNAT rechazó de forma definitiva |

---

## Compensación (sesión 29)

Es compensación **canónica de BPMN**, no una saga escrita a mano: evento de borde
`compensateEventDefinition` sobre `CerrarVenta`, tarea `isForCompensation` asociada, y un
evento intermedio que la dispara.

### Cuándo se compensa — y cuándo no

La distinción es de negocio, no técnica, y es la decisión más importante del proceso:

| Situación | ¿Compensa? | Por qué |
| :--- | :--- | :--- |
| SUNAT **rechaza** de forma definitiva | **Sí** | El comprobante no podrá existir nunca. La venta cobrada tiene que revertirse. |
| **Sin conexión** con SUNAT | **No** | El comprobante queda en cola y el worker reintenta. Es el comportamiento local-first, no un fallo. |
| E-Invoicing responde 5xx | **No** | Es técnico y reintentable. Revertir una venta por un servicio caído sería absurdo. |
| El comprobante es incompatible | No aplica | Se cortó antes de cobrar. |

> El orquestador **no decide** si la reversión es anulación o nota de crédito: eso lo resuelve
> `Sales & Customer Service` según el estado tributario ([ADR-002](../../../docs/adr/002-anulacion-nota-credito.md)).
> Aquí solo se declara la intención de revertir.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Tarea | Encapsula un proceso de negocio, no una entidad |
| **Estado** | Stateless | El estado del proceso vive en el motor mientras dura la ejecución. Nada persiste entre peticiones (P6) |
| **Comunicación** | Síncrona | El cajero espera el resultado: no puede entregar el ticket sin saber si la venta quedó |
| **Granularidad** | Gruesa | Una sola operación de negocio que agrupa cinco llamadas |
| **Rol** | **Compositor** | Coordina a otros servicios sin ser proveedor de datos |
| **Seguridad** | Exige `codigoAutorizacion` de supervisor ([ADR-001](../../../docs/adr/001-seguridad-roles-pin.md)): sin él no podría compensar |

## Principios de diseño (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| P1 | Contrato estandarizado | Contrato REST validado con TypeBox; el modelo BPMN es contrato publicado |
| P2 | Bajo acoplamiento | Solo conoce rutas del ESB. No sabe qué servicio hay detrás de cada una |
| P3 | Abstracción | El consumidor pide "ejecuta la venta"; no sabe que son cinco llamadas |
| P4 | Reutilización | Consumido por el terminal POS y por el backoffice |
| P5 | Autonomía | **Sin base de datos**: no hay dato que pueda desincronizarse |
| P6 | Sin estado | El proceso empieza y termina en la misma petición |
| P7 | Descubribilidad | Registrado en UDDI; publica su propio modelo BPMN |
| P8 | Componibilidad | Es él mismo una composición, e invocable desde otra |

---

## Todas las salidas van por el ESB

Un servicio de tarea es donde más tienta llamar punto a punto — ya sabe exactamente a quién
necesita. No se hace (CLAUDE.md §9.1 regla 8): si el orquestador esquivara el bus, se perderían
el ruteo, la mediación REST⇄SOAP y la auditoría. Es decir, todo lo que el bus aporta.

Hay una prueba que lo verifica: ninguna ruta invocada puede llevar host propio.

---

## Uso

```bash
pnpm --filter @pos/proceso-venta dev     # requiere el ESB en :3000
pnpm --filter @pos/proceso-venta test
```

```bash
curl -X POST http://localhost:3000/procesos/venta \
  -H 'content-type: application/json' \
  -d '{
    "ticketUuid": "...",
    "tipoComprobante": "FACTURA",
    "pagos": [{ "formaPago": "EFECTIVO", "monto": 120, "montoRecibido": 150 }],
    "codigoAutorizacion": "sup:1234"
  }'
```

La respuesta incluye la **traza completa**: qué pasos se ejecutaron, en qué orden, cuánto tardó
cada uno y cuáles quedaron compensados. Es la evidencia de integridad del proceso, no un
adorno de depuración.

## Variables de entorno

| Variable | Por defecto | Para qué |
| :--- | :--- | :--- |
| `PORT` | `3020` | Puerto del servicio |
| `ESB_URL` | `http://localhost:3000` | Única salida del servicio |
| `AUDITORIA_URL` | `http://localhost:3012` | Destino de la traza del proceso |
