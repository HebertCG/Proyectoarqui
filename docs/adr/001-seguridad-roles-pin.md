# ADR-001 — Seguridad: roles fijos con elevacion por PIN

**Estado:** Aceptado · 2026-08-29
**Cierra:** V-02 · **Habilita:** RNF-06, RNF-11
**Servicio afectado:** `Sales & Customer Service` (sub-dominio interno)

## Contexto

RNF-06 exige que anulaciones, descuentos manuales y apertura/cierre de caja requieran autenticacion de
supervisor. RNF-11 exige registrar el usuario responsable de cada operacion. Ningun RF definia como se
gestionan usuarios, roles ni permisos: el modelo simplemente no existia.

## Decision

Tres roles cerrados, con permisos predefinidos:

| Rol | Puede |
| :--- | :--- |
| **Cajero** | Vender, cobrar, consultar catalogo y clientes |
| **Supervisor** | Lo anterior + anular, descuento manual, apertura y cierre de caja |
| **Administrador** | Lo anterior + precios, catalogo, gestion de usuarios |

**Elevacion por PIN:** ante una operacion sensible el terminal pide el PIN de un supervisor presente.
No se cierra la sesion del cajero. La auditoria registra **el usuario del supervisor** que autorizo, no el
del cajero que opera.

**Transporte:** los servicios validan un token emitido por `Seguridad.Utility`. El PIN nunca viaja fuera
del terminal: se canjea por una autorizacion de un solo uso ligada a la operacion.

## Alternativa descartada

**Permisos granulares componibles.** Mas flexible, pero obliga a construir ahora un gestor de roles con su
UI. YAGNI: el negocio objetivo es un local con una caja. Si aparece la necesidad, los tres roles se pueden
reexpresar como conjuntos de permisos sin romper contratos.

## Consecuencias

- Vive **dentro** de `Sales & Customer Service`, no como servicio extraido: ningun otro servicio del
  inventario necesita estos roles, asi que extraerlo violaria P5 sin beneficio de reutilizacion (CLAUDE.md §4.4).
- Toda entrada de auditoria lleva el usuario que **autorizo**, que puede diferir del que opera.
- Offline el terminal valida el PIN contra su base local; es coherente con que el servicio sea local-first.
- Los roles quedan fijos en el contrato. Anadir uno es un cambio de version del contrato.


---

## Correccion posterior (2026-09-01)

La decision no cambia. Lo que se corrige es **donde vive**.

La version original de este ADR asignaba la decision a un servicio `Seguridad.Utility` extraido del
inventario. Eso fue consecuencia de un error de interpretacion arquitectonica: se fragmento
`Sales & Customer Service`, que es un servicio compuesto por diseno cerrado.

Roles, PIN y autorizacion de operaciones sensibles son **reglas internas del sub-dominio de Caja y Venta**.
Ningun otro servicio del inventario las consume. Ver `docs/00-base/correccion-arquitectonica.md`.
