# Cómo trabajamos en equipo

Somos 2–3 personas sobre un mismo repositorio durante 18 semanas. Este documento
existe para que **nadie pierda trabajo y nadie espere a nadie**.

La regla que resume todo:

> **Los contratos son la frontera. Si respetas la frontera, no hay conflicto.**

---

## 1. Por qué casi no vamos a tener conflictos

Git solo genera conflicto cuando **dos personas editan las mismas líneas del mismo
archivo**. Así que la estrategia no es "resolver conflictos rápido": es **no crearlos**.

El proyecto ya está partido en tres carriles que tocan directorios distintos:

| Track | Dueño | Directorios que edita |
| :--- | :--- | :--- |
| **A — Servicios** | Persona 1 | `servicios/entidad/`, `servicios/tarea/`, `servicios/utilidad/` |
| **B — Integración** | Persona 2 | `esb/`, `registro/`, `orquestacion/`, `contratos/xslt/` |
| **C — Consumidor** | Persona 3 | `terminal-pos/` |

Con 2 personas: A y B se fusionan; C se mantiene aparte porque es el de mayor volumen.

**Nadie edita el directorio de otro.** Si necesitas un cambio fuera de tu carril,
pídelo — no lo hagas tú.

### Los archivos compartidos y su regla

Estos sí los tocamos todos. Cada uno tiene una regla para evitar choques:

| Archivo | Regla |
| :--- | :--- |
| `contratos/**` | **Congelados al cerrar la Fase 1.** Cambiar uno exige acuerdo de los tres y sube la versión (`-v2`). |
| `packages/service-kit`, `packages/xml-kit` | Cambios solo por PR, y avisando. Todos dependen de ellos. |
| `CLAUDE.md` | Solo por PR. Es la constitución. |
| `pnpm-lock.yaml` | Ver §5. Es la fuente de conflicto más común. |
| `package.json` (raíz) | Una persona a la vez añade dependencias. Avisar por el grupo. |

---

## 2. Flujo de trabajo

### Nunca commitees directo a `main`

```bash
git checkout main
git pull                            # siempre antes de empezar
git checkout -b feat/catalogo-consultar-producto
```

**Nombres de rama:** `<tipo>/<descripcion-corta>`

```
feat/venta-anular-ticket
fix/caja-arqueo-diferencia
docs/adr-006-notificaciones
refactor/service-kit-envelope
```

### Commits pequeños y frecuentes

Un commit = un cambio con sentido. No acumules tres días de trabajo en un commit:
si algo sale mal, no puedes revertir solo la parte rota.

**Formato** (ver `CLAUDE.md` §7):

```
<tipo>: <descripción en presente>

<por qué, no qué. El qué ya se ve en el diff.>
```

Tipos: `feat` `fix` `refactor` `docs` `test` `chore` `perf` `ci` `build`

### Subir y abrir Pull Request

```bash
git push -u origin feat/catalogo-consultar-producto
```

Luego abre el PR en GitHub. **Toda rama entra a `main` por PR, con al menos una
aprobación.** Esto no es burocracia: es cómo los tres se enteran de lo que cambia.

Antes de pedir revisión, verifica:

```bash
pnpm test          # todo en verde
pnpm typecheck     # sin errores de tipos
pnpm contratos:lint
```

---

## 3. Mantente al día: `rebase`, no `merge`

**Antes de subir**, trae lo último de `main` a tu rama:

```bash
git checkout main
git pull
git checkout mi-rama
git rebase main
```

`rebase` reescribe tus commits encima de `main`, dejando un historial lineal y legible.
`merge` crearía un commit de fusión por cada sincronización y el historial se vuelve
ilegible en pocas semanas.

> **Regla de oro del rebase:** solo sobre TUS ramas, nunca sobre `main`. Si ya
> compartiste la rama y otro la descargó, avisa antes de rebasear.

### Si el rebase encuentra conflicto

No entres en pánico. Git te dice exactamente qué archivo:

```bash
git status                    # ¿qué archivo está en conflicto?
# abre el archivo, busca <<<<<<< ======= >>>>>>>
# decide qué queda, borra los marcadores
git add <archivo>
git rebase --continue
```

Para abortar y volver al estado anterior: `git rebase --abort`.

---

## 4. Conflictos típicos de ESTE proyecto y cómo resolverlos

### `pnpm-lock.yaml`

**El más frecuente.** Dos personas instalan dependencias distintas y el lockfile choca.

No intentes resolverlo a mano nunca. Regenéralo:

```bash
git checkout --theirs pnpm-lock.yaml   # o --ours, da igual
pnpm install                            # pnpm lo reconstruye correcto
git add pnpm-lock.yaml
git rebase --continue
```

**Cómo evitarlo:** avisa por el grupo antes de instalar una dependencia nueva, e
instálala en su propio PR pequeño que se mergea rápido.

### Tipos generados (`packages/contracts/src/generado/`)

**No pueden dar conflicto: están en `.gitignore`.** Se regeneran solos en cada
`pnpm install` desde los contratos OpenAPI. Si ves un error de tipos tras un pull:

```bash
pnpm contratos:tipos
```

### `.sef.json` (XSLT compilado)

Igual: artefacto derivado, ignorado por git. La fuente de verdad es el `.xsl`.

```bash
pnpm contratos:xslt
```

### Finales de línea

**Ya está resuelto** con `.gitattributes`: el repositorio guarda LF y cada quien tiene
lo suyo en disco. Si alguna vez ves un archivo entero marcado como modificado sin que
lo hayas tocado, es esto — avisa y lo corregimos, no lo commitees.

### Migraciones de base de datos

Cada servicio tiene su propia base y sus propias migraciones en `servicios/*/db/`.
Como cada servicio tiene dueño, **no deberían chocar**. Si dos personas crean una
migración en el mismo servicio, la segunda renumera la suya.

---

## 5. Reglas que no se negocian

1. **Nunca `git push --force` sobre `main`.** Sobre tu propia rama sí, usando
   `--force-with-lease` (aborta si alguien más subió algo que no tienes).
2. **Nunca commitees `.env`.** Está en `.gitignore`. Si necesitas una variable nueva,
   añádela a `.env.example` y avisa.
3. **Nunca subas secretos reales.** Ni claves de SUNAT de producción, ni certificados,
   ni contraseñas. Si se te escapa una, avisa de inmediato: hay que rotarla, no basta
   con borrar el commit.
4. **No edites el directorio de otro track** sin acordarlo antes.
5. **No cambies un contrato** después de la Fase 1 sin acuerdo de los tres.
6. **No mergees tu propio PR** sin que alguien lo haya revisado.

---

## 6. Configuración recomendada de GitHub

En **Settings → Branches → Add branch protection rule** para `main`:

- ✅ Require a pull request before merging (1 aprobación)
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings

Esto hace **imposible** commitear directo a `main` por accidente, que es la causa
número uno de que un equipo pise el trabajo de otro.

---

## 7. Rutina diaria

```bash
# Al empezar el día
git checkout main && git pull
git checkout mi-rama && git rebase main

# Mientras trabajas
git add -p                     # revisa lo que subes, trozo a trozo
git commit -m "feat: ..."      # commits pequeños

# Al terminar
pnpm test && pnpm typecheck
git push
```

**Sube tu rama todos los días**, aunque no esté terminada. Una rama que vive una semana
sin subir es una rama que va a doler al integrar — y si se te rompe el disco, se pierde.

---

## 8. Si algo sale mal

| Situación | Qué hacer |
| :--- | :--- |
| Commiteé en `main` sin querer | `git branch mi-rama && git reset --hard origin/main` |
| Commiteé un archivo que no debía | `git reset HEAD~1` (deshace el commit, conserva los cambios) |
| Quiero descartar cambios locales | `git checkout -- <archivo>` |
| El rebase se enredó | `git rebase --abort` y vuelve a empezar |
| Perdí commits | `git reflog` — git guarda todo, casi nada se pierde de verdad |
| **Subí un secreto** | **Avisa YA.** Hay que rotar la credencial; borrar el commit no basta. |

Ante la duda: **pregunta antes de forzar nada**. Un `push --force` mal dado sí borra
trabajo de otros.
