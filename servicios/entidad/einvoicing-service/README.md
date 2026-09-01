# E-Invoicing Service

> Cubre: Unidad 2 — Sesión 13–14 — "Diseño de una Arquitectura SOA • Diseño de Servicios"
> Unidad 3 — Sesión 23, 25–26 — "Creando servicios. Integración de procesos • Business to Business"

**Servicio de entidad** · Nivel **N1** · Base propia: `svc_einvoicing`
**Único servicio del inventario con transporte SOAP/WSDL** (CLAUDE.md §5.1)

---

## Propósito

Convierte una venta en un comprobante fiscal válido ante SUNAT: genera el XML/UBL 2.1, lo firma
digitalmente, lo envía a la autoridad tributaria y procesa el CDR de respuesta.

### Objetivo estratégico que soporta

> *Que el negocio cumpla con la normativa tributaria sin frenar la operación de venta.*

La responsabilidad legal de emitir correctamente recae en el negocio. Este servicio la asume
técnicamente, y lo hace **sin bloquear la caja**: el comprobante se entrega al cliente de
inmediato y el trámite tributario ocurre después.

---

## Por qué aquí sí va SOAP — y solo aquí

Es el único punto del inventario donde SOAP/WSDL/XML tiene **justificación técnica real**:

| Exigencia de SUNAT | Consecuencia |
| :--- | :--- |
| Comprobante en formato **XML/UBL 2.1** | No es negociable: es el formato de la autoridad |
| **Firma digital XMLDSig** sobre el documento | Requiere criptografía sobre XML, no sobre JSON |
| Respuesta como **CDR** (Constancia de Recepción), también XML | El ciclo completo es XML |
| Transporte **SOAP** con WS-Security UsernameToken | El `billService` de SUNAT es SOAP |

Aquí el ESB demuestra su función real: mediar entre `Sales & Customer Service`, que opera en
REST/JSON, y SUNAT, que exige SOAP/XML — **sin que ninguno de los dos conozca los detalles del
otro**.

> Forzar SOAP en el resto del inventario no demostraría dominio de SOA. Demostraría lo
> contrario: aplicar tecnología sin justificación de diseño.

---

## Clasificación (CLAUDE.md §2.3)

| Atributo | Valor | Justificación |
| :--- | :--- | :--- |
| **Tipo / capa** | Entidad | Centrado en el Comprobante como entidad de negocio |
| **Estado** | **Stateful**, justificado | El comprobante recorre una máquina de estados tributarios (ADR-002) que debe persistir |
| **Comunicación** | **Asíncrona** hacia dentro, **síncrona** hacia SUNAT | Recibe por cola desde `sync_outbox`; llama a SUNAT por SOAP y espera el CDR |
| **Granularidad** | **Gruesa** | `EmitirComprobante` encapsula generar + firmar + enviar + procesar respuesta |
| **Rol** | **Proveedor** e **Intermediario** | Provee emisión al inventario; media hacia SUNAT |
| **Seguridad** | WS-Security UsernameToken hacia SUNAT · certificado digital para XMLDSig · credenciales en gestor de secretos, **jamás en el repositorio** | |

---

## Flujo de emisión

```
1. Sales & Customer Service cierra la venta
2. Emite el comprobante LOCALMENTE  →  ticket/PDF al cliente, al instante
   (correlativo propio de la serie de esa caja, sin consultar a nadie)
3. Lo marca pendiente_envio_tributario y lo encola en sync_outbox
4. Al haber conexión, el ESB lo entrega a este servicio
5. Genera UBL 2.1 (XSLT), firma con XMLDSig, comprime y envía por SOAP
6. SUNAT responde: aceptado / observado / rechazado
7. El estado vuelve al terminal y actualiza el registro local
8. Si es RECHAZADO, se alerta al negocio: la responsabilidad legal es suya
```

**El paso 2 es la clave del diseño offline-first.** El cliente ya se fue con su comprobante
cuando empieza el trámite tributario.

### Series por caja

Cada punto de emisión tiene serie propia (`B001`/`F001` para Caja 1, `B002`/`F002` para Caja 2)
y su correlativo corre local e independiente. **No es un workaround**: es el modelo estándar
que la propia normativa de SUNAT espera. Elimina la necesidad de coordinar numeración con la
nube en tiempo real y hace imposible la colisión entre cajas.

---

## Los 8 principios (CLAUDE.md §2.1)

| # | Principio | Cómo se cumple |
| :--- | :--- | :--- |
| **P1** | Contrato estandarizado | **WSDL** en `contratos/wsdl/` + XSD `einvoicing-v1.xsd` (`urn:pos:einvoicing:v1`) |
| **P2** | Bajo acoplamiento | Recibe el comprobante en formato canónico interno; quien lo envía no sabe nada de UBL ni de SUNAT |
| **P3** | Abstracción | El contrato no filtra qué PSE/OSE se usa ni cómo se firma |
| **P4** | Reutilización | Lo consumen `Sales & Customer Service` y `Analytics & Reporting` (consolidación multi-serie) |
| **P5** | Autonomía | Base propia. La cola de pendientes es suya |
| **P6** | Sin estado | ⚠️ **No cumple, justificado**: el estado tributario del comprobante es el núcleo del servicio |
| **P7** | Descubribilidad | Registrado en UDDI — **el caso donde UDDI tiene sentido histórico real**, junto a SOAP y WSDL |
| **P8** | Componibilidad | Es el paso final de `ProcesoVenta.Task` |

---

## Con quién habla

| Contraparte | Dirección | Transporte |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Recibe | **Asíncrono** — cola de comprobantes vía `sync_outbox` |
| **SUNAT** (vía PSE/OSE) | Consume | **SOAP/XML** con WS-Security — el caso B2B del proyecto |
| `Analytics & Reporting` | Provee | Eventos de comprobante emitido/aceptado/rechazado |
| `Auditoria.Utility` | Consume | Cada cambio de estado tributario |

---

## Tecnologías del sílabo que evidencia

Este servicio es donde se concentran cuatro ítems del temario:

| Tecnología | Uso concreto |
| :--- | :--- |
| **XML + XSD** | UBL 2.1 validado contra esquema |
| **XSLT** | Comprobante interno → UBL 2.1 (ya implementado y probado, spike S-01) |
| **SOAP + WSDL** | `billService`: `sendBill` y `getStatus` (probado en spike S-02) |
| **UDDI** | Registro y descubrimiento del endpoint |

---

## Decisiones que le aplican

| ADR | Decisión |
| :--- | :--- |
| [002](../../../docs/adr/002-anulacion-nota-credito.md) | Un comprobante `ACEPTADO` no se anula: se emite **Nota de Crédito** (tipo 07) con motivo del catálogo 09 |

---

## Vacíos abiertos

| # | Afecta |
| :--- | :--- |
| **V-09** | Homologación formal del modelo de series por caja con el PSE/OSE elegido. Riesgo legal, no técnico |

---

## Estado

Implementación: pendiente (Nivel N1). Base ya validada: el WSDL de
[`spikes/soap/fixtures/billService.wsdl`](../../../spikes/soap/fixtures/billService.wsdl) está
modelado sobre el `billService` real de SUNAT, y la transformación a UBL funciona
([spike S-01](../../../docs/03-implementacion/spikes-fase0.md)).

Desarrollo contra el **ambiente beta de homologación** de SUNAT desde el primer día.
