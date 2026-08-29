# ADR-005 — SQLCipher con OpenSSL vendorizado

**Estado:** Aceptado · 2026-08-29
**Cierra:** W-02 · **Habilita:** RNF-07, y preserva RNF-03/RNF-15
**Componente afectado:** terminal POS (`src-tauri`)

## Contexto

RNF-07 exige que los datos de cliente esten cifrados en reposo mediante SQLCipher. El spike S-03 descubrio
que en Windows esto no es directo:

1. `bundled-sqlcipher` empaqueta SQLCipher pero **no** OpenSSL: lo exige ya instalado.
2. `bundled-sqlcipher-vendored-openssl` lo compila desde fuente, pero necesita un Perl nativo de Windows
   con el core completo. El Perl que trae Git for Windows es de msys y le faltan modulos.

## Decision

Usar `bundled-sqlcipher-vendored-openssl` y asumir **Strawberry Perl como prerequisito de compilacion**
del terminal POS.

```
winget install StrawberryPerl.StrawberryPerl
```

NASM no hace falta: `openssl-src` configura con `no-asm`.

## Alternativa descartada

**SQLite sin cifrar + cifrado a nivel de campo.** Evitaba el prerequisito, pero choca con otro requisito
que no es evidente a primera vista:

- RNF-07 pide cifrar datos de cliente.
- **RNF-03 + RNF-15 piden buscar clientes en menos de 300ms sobre 100.000 registros.**

Cifrar campo por campo inutiliza los indices sobre esos campos: no se puede buscar por nombre ni por
documento sin construir indices ciegos o cifrado determinista. **SQLCipher cifra el archivo completo pero
deja el SQL y los indices funcionando con normalidad por dentro**, que es lo unico que permite cumplir
ambos requisitos a la vez.

Se paga un prerequisito de compilacion a cambio de no construir un subsistema de busqueda sobre datos
cifrados.

## Consecuencias

- Toda maquina que compile el terminal necesita: Rust MSVC + VC++ Build Tools + Strawberry Perl.
- La primera compilacion supera los 10 minutos (OpenSSL desde fuente). Se cachea en `target/`.
- **En CI hay que cachear `target/`**, o cada build pagara ese coste completo.
- El prerequisito debe quedar documentado en el README del terminal POS.
- Android e iOS repetiran este analisis con su propia cadena de compilacion (W-01, W-02).
