# ADR-002 — Anulacion: maquina de estados del comprobante

**Estado:** Aceptado · 2026-08-29
**Cierra:** V-03 · **Habilita:** RF-POS-10, RF-POS-11, RNF-08
**Servicios afectados:** `Venta.Service`, `EInvoicing.Service`, `DevolucionAnulacion.Task`

## Contexto

RF-POS-10 y RF-POS-11 piden anular ventas y hacer devoluciones. Pero la normativa peruana no permite
"anular" un comprobante que SUNAT ya acepto: hay que emitir una **Nota de Credito**. El diseno previo no
modelaba esa diferencia, lo que habria producido comprobantes invalidos ante SUNAT.

## Decision

El comprobante tiene **estado tributario**, y ese estado determina que reversion es legal:

```
PENDIENTE_ENVIO   -> anulacion local directa
                     (SUNAT nunca lo recibio; no deja rastro tributario)

ENVIADO           -> esperar respuesta antes de permitir reversion

ACEPTADO          -> NOTA DE CREDITO (tipo 07)
                     con motivo del catalogo 09 de SUNAT

RECHAZADO         -> corregir y reemitir con el mismo correlativo

OBSERVADO         -> corregir y reenviar
```

La UI ofrece **unicamente** la accion valida para el estado actual. El operador no elige entre "anular" y
"nota de credito": el sistema ya lo decidio.

## Alternativa descartada

**Emitir siempre nota de credito.** Un solo camino de codigo, mas simple. Se descarto porque consume
correlativos de nota de credito para comprobantes que SUNAT nunca recibio, ensuciando la numeracion
tributaria sin necesidad.

## Consecuencias

- `Venta.Service` guarda el estado tributario y lo expone en su contrato.
- Nace un tipo de comprobante adicional (Nota de Credito, tipo 07) con su propia serie y correlativo.
- El motivo de la nota de credito sale del **catalogo 09 de SUNAT**, no es texto libre.
- Nada se borra: la anulacion es un registro nuevo que referencia al original (RNF-08, append-only).
- `DevolucionAnulacion.Task` orquesta segun el estado: reversion de caja y stock siempre, emision de nota
  de credito solo si corresponde.
