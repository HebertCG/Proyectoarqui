# Enterprise Service Bus

Punto único de integración del inventario. Ver [`CLAUDE.md` §5.3](../CLAUDE.md).

**Regla dura:** el ESB no contiene lógica de negocio. Solo ruta, transforma, media y audita.
Si aparece una regla de negocio aquí, está mal ubicada.

| Mecanismo | Implementación |
| :--- | :--- |
| Ruteo | Tabla declarativa + ruteo por contenido con XPath (`fontoxpath`) |
| Transformación | XSLT (`saxon-js`) para XML; mapeadores TS para JSON |
| **Mediación de protocolos** | REST/JSON ⇄ SOAP/XML — el caso estrella de la demo |
| Mensajería asíncrona | RabbitMQ: topic exchange, backoff, dead-letter queue |
| Auditoría | Todo mensaje que cruza el bus va a `Auditoria.Utility` |
| Políticas | Autenticación, autorización, límite de tasa, idempotencia |

El caso que justifica el bus: `Sales & Customer Service` opera en REST/JSON y SUNAT exige
SOAP/XML. El ESB media entre ambos sin que ninguno conozca al otro.
