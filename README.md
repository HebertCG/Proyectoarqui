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

## Arquitectura en una imagen

```
CONSUMIDORES     Terminal POS (Tauri)  ·  Backoffice Web
                              │
ORQUESTACIÓN     Procesos BPMN  ·  Compensación / saga
                              │
      ESB        Ruteo (XPath) · Transformación (XSLT) · Mediación REST⇄SOAP · Auditoría
                              │
   SERVICIOS     Tarea      →  ProcesoVenta, CierreCaja, ReservaServicio…
                 Entidad    →  Catálogo, Cliente, Caja, Venta, Inventario, Agenda
                 Utilidad   →  ValidaciónDocumento, Auditoría, Seguridad, ReglasPrecio…
                              │
    RECURSOS     Una base de datos por servicio  (autonomía, principio P5)
```

El terminal Local-First **es un consumidor de servicios**, no la arquitectura evaluada.
Ver [`CLAUDE.md` §3](CLAUDE.md) para el reencuadre completo.

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

pnpm infra:up             # PostgreSQL (18 bases) + RabbitMQ
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

# Crear un servicio nuevo del inventario
node tools/crear-servicio.mjs catalogo entidad 3001
```

---

## Estructura

```
contratos/          Contract-first: XSD, OpenAPI, WSDL, XSLT. Siempre antes del código.
servicios/          entidad/ · tarea/ · utilidad/
packages/           service-kit (base común) · xml-kit (toolchain XML) · contracts (tipos)
esb/                Ruteo, mediación, transformación, políticas
registro/           Registro de servicios con modelo de datos UDDI
orquestacion/       Procesos BPMN
terminal-pos/       Consumidor Local-First (Tauri + React)
infra/              docker-compose y scripts
docs/adr/           Decisiones de arquitectura con su justificación
spikes/             Pruebas de riesgo técnico de la Fase 0
tools/              Generador de servicios
```

---

## Estado

| Fase | Estado |
| :--- | :--- |
| **0 — Fundaciones** | ✅ Completa. Infra, service-kit, xml-kit, generador, 4 spikes |
| **1 — Contratos** | 🔄 En curso. 6 XSD canónicos + capa de utilidad completa |
| 2 — Esqueleto vertical | Pendiente |
| 3 — Servicios de utilidad | Pendiente |
| 4 — Servicios de entidad | Pendiente |
| 5 — Orquestación y BPM | Pendiente |
| 6 — EInvoicing SOAP | Pendiente |
| 7 — Terminal POS | Pendiente |
| 8 — Integración y demo | Pendiente |

---

## Trabajar en este repositorio

Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) **antes de tu primer commit**. Define cómo
trabajamos en paralelo sin pisarnos.
