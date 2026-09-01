# ADR-003 — Precios: cascada con bandera de acumulable

**Estado:** Aceptado · 2026-08-29
**Cierra:** V-04 · **Habilita:** RF-POS-03, RF-POS-14, RF-POS-15, RF-POS-16, RF-CAT-03, RF-CAT-04, RF-CAT-05
**Servicio afectado:** `Sales & Customer Service` (sub-dominio Catalogo + Venta)

## Contexto

Cuatro mecanismos de precio pueden concurrir sobre el mismo ticket: lista de precios del cliente,
promocion automatica, cupon y descuento manual. Ni el orden de aplicacion ni la acumulabilidad estaban
definidos. Sin esa definicion, dos implementaciones del mismo requisito dan totales distintos.

## Decision

**Orden fijo, en cascada.** Cada etapa opera sobre el resultado de la anterior:

| # | Etapa | Efecto |
| :--- | :--- | :--- |
| 1 | **Lista de precios del cliente** | Fija el precio base (regular / VIP / mayorista) |
| 2 | **Promocion automatica** | Se aplica sobre ese precio base (2x1, 3x2, volumen, combo) |
| 3 | **Cupon** | Se aplica sobre el subtotal ya promocionado |
| 4 | **Descuento manual** | Ultimo. Requiere PIN de supervisor (ADR-001) |

**Acumulabilidad:** cada promocion y cada cupon lleva una bandera `acumulable`. Si una etapa marca
`acumulable: false`, la cascada se detiene ahi y las etapas posteriores no se aplican.

El desglose de como se llego al precio final se guarda con el ticket, para poder auditarlo y explicarselo
al cliente.

## Alternativa descartada

**Calcular todas las combinaciones y aplicar la mas barata.** Mejor para el cliente, pero exige un motor
combinatorio, es dificil de auditar y el cajero no puede explicar por que salio ese precio cuando el
cliente pregunta. La previsibilidad pesa mas que el optimo.

## Consecuencias

- El motor de precios es determinista: mismas entradas, mismo resultado siempre. Facil de probar.
- El ticket guarda el desglose etapa por etapa, no solo el total.
- La misma cascada corre en el terminal offline y en la nube: una sola implementacion compartida.
- Anadir un quinto mecanismo de precio exige decidir explicitamente su posicion en la cascada.


---

## Correccion posterior (2026-09-01)

La cascada no cambia. Lo que se corrige es **donde vive**.

La version original asignaba esta logica a un servicio `ReglasPrecio.Utility` extraido. El documento base
(§5.1) ya situa el motor de promociones y descuentos **dentro** del Catalogo de
`Sales & Customer Service`, y CLAUDE.md §4.4 lo confirma explicitamente: extraerlo violaria Autonomia (P5)
sin beneficio de reutilizacion real, porque ningun otro servicio del inventario lo necesita.
