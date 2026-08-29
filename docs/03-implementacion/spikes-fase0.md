# Spikes de Riesgo — Fase 0

> Cubre: Unidad 3 — Sesión 21 — "Implementación de SOA • Tecnología para el desarrollo de servicios Web"

Tres incógnitas técnicas cuyo fallo obligaría a cambiar el plan. Se resuelven en la Fase 0 y no en la semana 14.

Fecha de ejecución: 2026-08-29

---

## Resumen

| Spike | Estado | Consecuencia |
| :--- | :--- | :--- |
| **S-01** Toolchain XML (XSD/XSLT/XPath/XQuery) | ✅ **VERDE** | Fase 6 desbloqueada. Sin toolchain nativo. |
| **S-02** node-soap (servidor + cliente + WS-Security) | ✅ **VERDE** | Fase 6 desbloqueada. `EInvoicing` viable como SOAP. |
| **S-03** SQLCipher en Windows | ✅ **VERDE** (tras resolver W-02) | Cifrado real verificado. Ver §S-03. |
| **S-04** Ejecución de servicios en Node 24 | ✅ **VERDE** (con hallazgo) | Ver §S-04. Obligó a cambiar los scripts del generador. |

**Entorno verificado:** Node 24.19.0 · pnpm 11.2.2 · Docker 28.5.1 (*healthy*) · git 2.49.0 · Rust 1.98.0 (MSVC) · Strawberry Perl 5.42.

---

## S-01 — Toolchain XML sin compilación nativa

**Pregunta:** ¿se pueden cumplir las cuatro tecnologías XML del sílabo (sesiones 5–6) en Windows sin cadena de
compilación nativa?

**Resultado: sí.** 6/6 pruebas en verde.

| Tecnología | Librería | Verificado con |
| :--- | :--- | :--- |
| **XSD** | `xmllint-wasm` | Acepta un comprobante con RUC válido; **rechaza** un RUC con prefijo `99` y 10 dígitos |
| **XPath 3.1** | `fontoxpath` | Extrae `tipoComprobante` (ruteo del ESB) y suma importes de línea |
| **XQuery 3.1** | `fontoxpath` | Proyecta líneas con `importe > 50` a una estructura de reporte |
| **XSLT 3.0** | `saxon-js` | Transforma el comprobante interno a **UBL 2.1** con códigos SUNAT correctos |

La transformación XSLT no es un ejemplo de juguete: produce `<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>`
(catálogo 01 de SUNAT), `schemeID="6"` para RUC (catálogo 06) y el `ID` con formato `F001-128`. Es la mediación
real que hará el ESB.

**Nota operativa — `xmllint-wasm` es WASM**, no requiere `node-gyp`, Visual Studio Build Tools ni Python. Este
era el riesgo principal del spike y no se materializó.

**Nota operativa — compilación de XSLT.** Saxon-JS necesita el stylesheet compilado a SEF:

```bash
pnpm exec xslt3 -xsl:fixtures/x.xsl -export:fixtures/x.sef.json -nogo
```

⚠️ **Este comando debe correrse desde Bash, no desde PowerShell.** PowerShell interpreta `-export:valor` como
parámetro propio y lo parte, produciendo `Command line option -export requires a value`. Alternativa en
PowerShell: anteponer el token `--%`.

Los `.sef.json` se generan en build, no se editan a mano. Fuente de verdad = el `.xsl`.

**Ubicación:** `spikes/xml-toolchain/`

---

## S-02 — node-soap como servidor y cliente

**Pregunta:** ¿puede `soap` (node-soap) exponer un WSDL propio, consumirlo y manejar WS-Security, tal como exige
`EInvoicing` en la Fase 6?

**Resultado: sí.** 5/5 pruebas en verde.

| Capacidad | Verificado |
| :--- | :--- |
| Publicar WSDL en `?wsdl` | El WSDL se sirve por HTTP y contiene las operaciones declaradas |
| Cliente generado desde WSDL | `describe()` descubre `sendBill` y `getStatus` |
| Ida y vuelta `sendBill` | Envía el comprobante y recibe el CDR en base64 |
| **WS-Security UsernameToken** | El servidor recibe el `Username` enviado por el cliente |
| **SOAP Fault** | Un error de negocio se propaga como excepción tipada en el cliente |

El WSDL usado está modelado sobre el `billService` real de SUNAT (operaciones `sendBill` / `getStatus`,
`document/literal`), por lo que sirve como base directa del contrato de la Fase 1.

**Ubicación:** `spikes/soap/` · WSDL en `spikes/soap/fixtures/billService.wsdl`

---

## S-03 — SQLCipher en Windows

**Pregunta:** ¿compila `rusqlite` con `bundled-sqlcipher` en Windows, y cifra de verdad la base local?

**Resultado: VERDE, tras resolver W-02.** La advertencia de la arquitectura resultó cierta. El spike la
convirtió en un problema resuelto en la semana 1 en lugar de un bloqueo en la semana 12.

### Cadena de fallos encontrada

| # | Intento | Fallo |
| :--- | :--- | :--- |
| 1 | `features = ["bundled-sqlcipher"]` | `Missing environment variable OPENSSL_DIR`. La feature empaqueta SQLCipher pero **no** OpenSSL: lo exige ya instalado. |
| 2 | `features = ["bundled-sqlcipher-vendored-openssl"]` | Compila OpenSSL desde fuente, pero el Perl de Git for Windows es de msys y le faltan módulos del core: `Can't locate Locale/Maketext/Simple.pm`. |
| 3 | Ídem + **Strawberry Perl** | Perl nativo de Windows con el core completo. `Locale::Maketext::Simple` e `IPC::Cmd` disponibles. |

**NASM no hizo falta:** `openssl-src` configura con `no-asm`, así que se evita esa dependencia adicional.

### Prerequisitos confirmados para el terminal POS

Toda máquina que compile `terminal-pos` necesita:

| Prerequisito | Instalación |
| :--- | :--- |
| Rust (MSVC) | `rustup-init.exe` → opción 1 (instala VC++ build tools) |
| Visual Studio Build Tools | Lo instala rustup. Workload *Desarrollo de escritorio con C++* |
| **Strawberry Perl** | `winget install StrawberryPerl.StrawberryPerl` |

**Esto ES la advertencia W-02**, ahora con nombre y solución concreta. Debe quedar en el README del
terminal POS y en el pipeline de CI.

### Por qué se eligió SQLCipher y no cifrado por campo

La alternativa era SQLite sin cifrar más cifrado a nivel de campo. Se descartó por un choque de
requisitos que no es evidente a primera vista:

- **RNF-07** exige datos de cliente cifrados en reposo.
- **RNF-03 + RNF-15** exigen búsqueda de clientes en **<300ms sobre 100k registros**.

Cifrar campo por campo inutiliza los índices sobre esos campos: no se puede buscar por nombre ni por
documento sin construir índices ciegos o cifrado determinista. **SQLCipher cifra el archivo completo pero
deja el SQL y los índices funcionando con normalidad por dentro**, que es justamente lo que permite cumplir
ambos requisitos a la vez.

Decisión registrada: se paga un prerequisito de compilación a cambio de no construir un subsistema de
búsqueda sobre datos cifrados.

### Verificación del cifrado

Con Strawberry Perl la compilación completó: `libcrypto.lib` (53.3 MB) y `libssl.lib` (9.9 MB) construidos
desde fuente, y SQLCipher enlazado contra ellos.

Los cuatro pasos del spike, todos en verde:

| # | Comprobación | Resultado |
| :--- | :--- | :--- |
| 1 | Crear base cifrada e insertar un cliente con RUC | OK |
| 2 | Releer con `PRAGMA key` correcta | Devuelve `Distribuidora San Miguel S.A.C.` |
| 3 | Abrir con clave **incorrecta** | Falla: `file is not a database` |
| 4 | Inspeccionar los bytes del archivo | **Sin cabecera `SQLite format 3` y sin el RUC en claro** |

El paso 4 es el que importa: no basta con que la librería diga que cifra. Se leyeron los 12.288 bytes del
archivo y se comprobó que no aparece ni la cabecera estándar de SQLite ni el número de documento. **RNF-07
alcanzable y verificado.**

### Coste de compilación

OpenSSL desde fuente supera los 10 minutos la primera vez (~1.500 objetos compilados a ~75/min). Se cachea
en `target/`, así que las compilaciones posteriores no lo repiten. **En CI hay que cachear ese directorio**
o cada build pagará el coste completo.

---

## Impacto en el plan

- **Fases 1 y 6 desbloqueadas.** Las dos incógnitas que podían obligar a cambiar de librería quedaron cerradas.
- **Fase 7 (Terminal POS) con dependencia abierta** hasta que S-03 corra. No bloquea el arranque del track:
  la UI y el `RepositoryFactory` no dependen del cifrado.
- Las cuatro librerías XML y `soap` quedan **confirmadas** para `packages/xml-kit` y `EInvoicing`.


---

## S-04 — Ejecución de servicios TypeScript en Node 24

**Hallazgo no previsto**, detectado al arrancar por primera vez un servicio generado.

Node 24 ejecuta archivos `.ts` directamente (elimina los tipos en carga), pero **no reescribe los
especificadores de import**. Con `module: NodeNext` TypeScript obliga a escribir:

```ts
import { registrarRutas } from './rutas.js';   // apunta al .js compilado
```

Vitest resuelve ese `./rutas.js` hacia `rutas.ts` sin problema. `node src/index.ts` **no**:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/rutas.js'
    imported from .../src/index.ts
```

Es decir: **las pruebas pasaban y el servicio no arrancaba.** Un fallo que se habría descubierto en la
Fase 2 o más tarde, cuando ya hubiera varios servicios con el mismo defecto.

**Resolución** — scripts de todo servicio generado:

| Script | Comando | Motivo |
| :--- | :--- | :--- |
| `dev` | `tsx watch src/index.ts` | `tsx` sí resuelve `./x.js` → `./x.ts` |
| `start` | `node dist/index.js` | En producción no se transpila en caliente |
| `build` | `tsc -b` | Genera `dist/` |

**Verificado tras el cambio:** el servicio arranca, responde `/health`, propaga el `x-correlation-id`
entrante, devuelve envelope en 200 y en 404, y registra auditoría.

---

## Estado de la Fase 0

| Entregable | Estado |
| :--- | :--- |
| Estructura de repositorio (CLAUDE.md §6) | ✅ |
| Monorepo pnpm + TypeScript estricto + Vitest | ✅ |
| `infra/docker-compose.yml` — PostgreSQL + RabbitMQ | ✅ 18 bases creadas, ambos *healthy* |
| `packages/service-kit` | ✅ 12 pruebas |
| `packages/xml-kit` | ✅ 14 pruebas |
| `tools/crear-servicio.mjs` | ✅ Verificado generando y arrancando un servicio real |
| Contratos canónicos promovidos a `contratos/` | ✅ `comprobante-v1.xsd`, `comprobante-a-ubl-v1.xsl` |
| Spike S-03 (SQLCipher) | ✅ Verde — cifrado verificado byte a byte |

**Total de la suite: 37 pruebas en verde** (6 + 5 + 14 + 12).

**Criterio de "terminado" de la Fase 0 — cumplido:** `node tools/crear-servicio.mjs <nombre> <tipo> <puerto>`
genera un servicio que arranca, responde `/health`, valida contra su esquema, devuelve el envelope estándar
y deja entrada de auditoría. Y `docker compose up` levanta toda la infraestructura.
