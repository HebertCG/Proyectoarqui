# Registro de Servicios (UDDI)

Ver [`CLAUDE.md` §5.4](../CLAUDE.md).

UDDI como estándar está en desuso y sus implementaciones vivas son Java. Se implementa un
registro propio en Node/TS que **reproduce el modelo de datos UDDI** y lo expone vía REST:

```
businessEntity → businessService → bindingTemplate → tModel
```

Debe soportar: publicación, búsqueda por categoría/tModel, y resolución de endpoint.

**La correspondencia con el estándar UDDI se documenta en APF3 — esa documentación *es* la
evidencia de la sesión 24 del sílabo.**
