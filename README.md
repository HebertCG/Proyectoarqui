# Sales & Customer Service — POS bajo Arquitectura Orientada al Servicio

Sistema de punto de venta **Local-First** para un negocio peruano de una sola caja,
construido como una **arquitectura orientada a servicios**: inventario de servicios en
tres capas, ESB con mediación REST⇄SOAP, orquestación BPMN y auditoría transversal.

> **Curso:** Arquitectura Orientada al Servicio (100000S08I) — Ingeniería de Sistemas
> e Informática, UTP · Ciclo 2026-2

Las reglas del proyecto están en [`CLAUDE.md`](CLAUDE.md). **Es la constitución: ante
cualquier duda, manda ese archivo.**

---

## Qué hace

Vende productos **y servicios con cita** en el mismo ticket, controla caja con arqueo,
gestiona clientes y emite comprobantes válidos ante SUNAT — **todo funcionando al 100%
sin internet**, sincronizando después.

| Capacidad | Detalle |
| :--- | :--- |
| **Opera offline** | No es un modo degradado: es el modo primario. Escribe local y sincroniza luego. |
| **Productos y servicios** | Un producto depende de stock; un servicio depende de tiempo, personal y recurso. |
| **Comprobantes SUNAT** | DNI → Boleta · RUC → Factura · genérico → Nota de venta. Validado **antes** de emitir. |
| **Trazabilidad total** | Toda operación registra usuario, fecha y detalle. Append-only. |

---

## Arquitectura

El sistema es un **inventario de ocho servicios SOA**. `Sales & Customer Service` es **uno**
de ellos — el núcleo operativo, pero no el proyecto completo.

```
CONSUMIDORES     Backoffice Web (admin)  ·  Apps externas
                              │
ORQUESTACIÓN     ProcesoVenta · ReservaMulticanal · ConciliacionPago  (BPMN)
                              │
      ESB        Ruteo (XPath) · Transformación (XSLT) · Mediación REST⇄SOAP · Auditoría
                              │
   ENTIDAD       Sales & Customer · Inventory · Order & Booking · Payment Gateway
                 E-Invoicing · Omnichannel Bot · Notification & Sync · Analytics
                              │
   UTILIDAD      Auditoría · Sincronización · Notificación
                              │
    RECURSOS     Una base de datos por servicio del inventario  (autonomía, P5)
```

### La decisión que define el proyecto

`Sales & Customer Service` **fusiona deliberadamente** cuatro sub-dominios — Caja, Venta/POS,
Cliente/CRM y Catálogo — en un solo servicio autónomo con una sola base de datos.

No es un atajo: es la decisión que evita llamadas cruzadas constantes entre servicios que el
cajero necesita **en el mismo instante** del ticket de venta. Busca el cliente, consulta el
precio, aplica la promoción y cobra en un solo flujo.

**Esa fusión no se reabre.** Fragmentarla para que "parezca más SOA" está explícitamente
prohibido en [`CLAUDE.md`](CLAUDE.md) §12. El detalle está en
[docs/00-base/correccion-arquitectonica.md](docs/00-base/correccion-arquitectonica.md).

### Dónde vive SOAP, y por qué solo ahí

El único punto del inventario con justificación técnica real para SOAP/WSDL/XML es
`E-Invoicing Service`: SUNAT exige XML/UBL, firma digital XMLDSig, y responde con un CDR
en XML.

Ahí el ESB demuestra su función real — mediar entre `Sales & Customer Service`, que opera
en REST/JSON, y SUNAT, que exige SOAP/XML. Forzar SOAP en el resto no demostraría dominio
de SOA: demostraría lo contrario.

### Tres builds, un mismo código

`Sales & Customer Service` se despliega desde un solo monorepo:

| Build | Datos | Uso |
| :--- | :--- | :--- |
| **Desktop** (Windows, Tauri) | SQLite/SQLCipher local | Terminal POS, opera sin internet |
| **Tablet** (Android, Tauri) | SQLite/SQLCipher local | Mismo núcleo, interacción táctil |
| **Web** (React estático) | API REST contra réplica cloud | Backoffice y administración |

El `RepositoryFactory` resuelve en tiempo de arranque si hablar con SQLite o con la API,
de modo que el mismo código de UI sirve para los tres sin bifurcaciones por plataforma.

---

## Stack

**TypeScript de punta a punta.** Node.js 22+ · Fastify 5 · PostgreSQL 16 · RabbitMQ ·
Drizzle ORM · Vitest. Rust queda confinado al shell de Tauri.

Las cuatro tecnologías XML del sílabo tienen herramienta asignada:

| Exigencia | Librería |
| :--- | :--- |
| XSD | `xmllint-wasm` (WASM: sin compilación nativa) |
| XSLT 3.0 | `saxon-js` + `xslt3` |
| XPath 3.1 / XQuery 3.1 | `fontoxpath` |
| SOAP + WSDL | `soap` (node-soap) |
| Firma XMLDSig | `xml-crypto` |
| BPMN | `bpmn-engine` |

---

## Puesta en marcha

### Prerequisitos

| Herramienta | Necesaria para |
| :--- | :--- |
| **Node.js 22+** y **pnpm** | Todo el proyecto |
| **Docker Desktop** | PostgreSQL y RabbitMQ |
| **Rust (MSVC)** | Solo el terminal POS. `rustup-init.exe` → opción 1 |
| **Strawberry Perl** | Solo el terminal POS. `winget install StrawberryPerl.StrawberryPerl` |

> Los dos últimos son la advertencia W-02 hecha concreta: SQLCipher necesita compilar
> OpenSSL desde fuente. El porqué está en [ADR-005](docs/adr/005-sqlcipher-openssl.md).

### Arranque

```bash
git clone https://github.com/HebertCG/Proyectoarqui.git
cd Proyectoarqui

cp .env.example .env      # valores de desarrollo, ajusta si hace falta
pnpm install              # instala y regenera tipos y XSLT compilado

pnpm infra:up             # PostgreSQL (una base por servicio) + RabbitMQ
pnpm test                 # debe quedar todo en verde
```

Consola de RabbitMQ: http://localhost:15672 (`pos` / `pos_dev_local`)

### Comandos

```bash
pnpm test               # toda la suite
pnpm typecheck          # tipos en todos los paquetes
pnpm contratos:lint     # calidad de los contratos OpenAPI
pnpm contratos:tipos    # regenera tipos TypeScript desde los contratos
pnpm infra:down         # detiene la infraestructura
pnpm infra:reset        # la detiene y BORRA los datos

# Crear un servicio DEL INVENTARIO (§4.2). Los sub-dominios internos de
# Sales & Customer Service no son servicios: el generador los rechaza.
node tools/crear-servicio.mjs inventory-service entidad 3002
```

---

## Estructura

```
contratos/          Contract-first: XSD, OpenAPI, WSDL, XSLT. Siempre antes del código.
                    Un namespace por servicio del inventario.
servicios/
  entidad/          Los 8 servicios del inventario canónico
    sales-customer-service/    ← monorepo Tauri + React + réplica cloud
    inventory-service/
    einvoicing-service/        ← único con contrato SOAP/WSDL
    ...
  tarea/            proceso-venta · reserva-multicanal · conciliacion-pago
  utilidad/         auditoria · sincronizacion · notificacion
packages/           service-kit (base común) · xml-kit (toolchain XML) · contracts (tipos)
esb/                Ruteo, mediación, transformación, políticas
registro/           Registro de servicios con modelo de datos UDDI
orquestacion/       Procesos BPMN
infra/              docker-compose y scripts
docs/00-base/       Documentos fuente. Determinantes, no se reinterpretan.
docs/adr/           Decisiones de arquitectura con su justificación
spikes/             Pruebas de riesgo técnico de la Fase 0
tools/              Generador de servicios del inventario
```

---

## Estado

**Nivel N1 operativo end-to-end.** 356 pruebas en verde.

| Componente | Estado | Pruebas |
| :--- | :--- | :--- |
| `Sales & Customer Service` | Catálogo · Caja · Venta · reglas de negocio | 122 |
| `E-Invoicing Service` | UBL 2.1 · XMLDSig · SOAP con WSDL propio | 62 |
| `Auditoria.Utility` | Append-only sobre PostgreSQL | 31 |
| **ESB** | Ruteo, ruteo por contenido, mediación REST⇄SOAP, auditoría | 60 |
| **Registro UDDI** | Modelo de datos UDDI sobre REST, 15 servicios publicados | 36 |
| `service-kit` · `xml-kit` | Base común y toolchain XML | 33 |
| Spikes de riesgo | XML · SOAP · SQLCipher · Node 24 | 11 |

### Demo verificada

```
1. Caja abierta, fondo S/ 200
2. Ticket: producto x3 + servicio con cita  =  S/ 120
3. Intento con BOLETA (cliente con RUC) →  BLOQUEADO, sugiere FACTURA
4. Cierre con FACTURA, pago combinado    →  F001-1, vuelto S/ 30
5. Comprobante entregado a E-Invoicing por el ESB
6. UBL 2.1 → firma → gzip → SOAP → SUNAT →  ACEPTADO (código 0)

Traza reconstruida: 22 pasos, 3 servicios, un solo correlationId.
```

### Pendiente

| Fase | Estado |
| :--- | :--- |
| Servicios N2 (`Inventory`, `Order & Booking`, `Notification & Sync`) | Diseñados, sin implementar |
| Stubs N3 (`Payment Gateway`, `Omnichannel`, `Analytics`) | Registrados en UDDI, sin implementar |
| Orquestación BPMN (`ProcesoVenta`, `CierreCaja`, `ReservaServicio`) | Pendiente |
| Terminal POS Tauri (Desktop · Tablet · Web) | Pendiente |
| Persistencia PostgreSQL en Sales & Customer y E-Invoicing | En memoria; el patrón ya está probado en Auditoría |
| **V-08** — ¿`Order & Booking` separado o fusionado? | **Decisión abierta** |

---

## Trabajar en este repositorio

Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) **antes de tu primer commit**. Define cómo
trabajamos en paralelo sin pisarnos.
