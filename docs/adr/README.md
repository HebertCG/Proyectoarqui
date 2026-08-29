# Registro de Decisiones de Arquitectura (ADR)

Cada decision que afecta contratos, inventario de servicios o stack se registra aqui.
Un ADR no se edita cuando cambia la decision: se marca **Reemplazado por** y se escribe uno nuevo.

| # | Decision | Estado | Vacio que cierra |
| :--- | :--- | :--- | :--- |
| [001](001-seguridad-roles-pin.md) | Roles fijos + PIN de supervisor | Aceptado | V-02 |
| [002](002-anulacion-nota-credito.md) | Maquina de estados del comprobante | Aceptado | V-03 |
| [003](003-precedencia-precios.md) | Cascada de precios con bandera de acumulable | Aceptado | V-04 |
| [004](004-stock-offline.md) | Replica local de stock con descuento optimista | Aceptado | V-01 |
| [005](005-sqlcipher-openssl.md) | SQLCipher con OpenSSL vendorizado | Aceptado | W-02 |

## Formato

Cada ADR responde: que se decidio, por que, que se descarto y que consecuencias trae.
