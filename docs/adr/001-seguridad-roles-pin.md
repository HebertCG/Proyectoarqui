# ADR-001 — Seguridad: roles fijos con elevacion por PIN

**Estado:** Aceptado · 2026-08-29
**Cierra:** V-02 · **Habilita:** RNF-06, RNF-11
**Servicio afectado:** `Seguridad.Utility`

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

- `Seguridad.Utility` entra en el Nivel N1 (CLAUDE.md §4.7): todos los demas dependen de el.
- Toda entrada de auditoria lleva el usuario que **autorizo**, que puede diferir del que opera.
- Offline el terminal valida el PIN contra su replica local de credenciales; el token se renueva al sincronizar.
- Los roles quedan fijos en el contrato. Anadir uno es un cambio de version del contrato.
