/**
 * Rutas del sub-dominio **Cliente / CRM**.
 *
 * Contract-first: cada operación corresponde a un `operationId` de
 * `contratos/openapi/sales-customer-v1.yaml` (CLAUDE.md §9.1.1).
 *
 * El documento del cliente es lo que decide qué comprobante se puede emitir
 * (RF-CRM-02, RF-POS-18), así que se valida **al dar de alta**, no al facturar:
 * descubrir un RUC mal escrito cuando el cliente ya pagó es demasiado tarde.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { exito, errorNoEncontrado, errorConflicto, errorReglaNegocio } from '@pos/service-kit';

import { validarDocumento } from '../venta/reglas/validacion-comprobante.js';
import type {
  CambiosCliente,
  Cliente,
  RepositorioCliente,
  Segmento,
  TipoDocumento,
} from './repositorio.js';

const TIPOS_DOCUMENTO = [
  Type.Literal('DNI'),
  Type.Literal('RUC'),
  Type.Literal('GENERICO'),
];

const SEGMENTOS = [
  Type.Literal('REGULAR'),
  Type.Literal('VIP'),
  Type.Literal('FRECUENTE'),
  Type.Literal('MAYORISTA'),
];

const EsquemaContacto = Type.Object({
  telefono: Type.Optional(Type.String({ maxLength: 120 })),
  correo: Type.Optional(Type.String({ format: 'email', maxLength: 120 })),
  direccion: Type.Optional(Type.String({ maxLength: 1000 })),
});

const EsquemaBusqueda = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 120 }),
  pagina: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

const EsquemaNuevo = Type.Object({
  tipoDocumento: Type.Union(TIPOS_DOCUMENTO),
  numeroDocumento: Type.Optional(Type.String({ maxLength: 15 })),
  razonSocial: Type.String({ minLength: 1, maxLength: 120 }),
  nombreComercial: Type.Optional(Type.String({ maxLength: 120 })),
  contacto: Type.Optional(EsquemaContacto),
  segmento: Type.Optional(Type.Union(SEGMENTOS)),
  listaPrecios: Type.Optional(Type.String({ maxLength: 40 })),
});

const EsquemaCambios = Type.Object({
  razonSocial: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  nombreComercial: Type.Optional(Type.String({ maxLength: 120 })),
  contacto: Type.Optional(EsquemaContacto),
  segmento: Type.Optional(Type.Union(SEGMENTOS)),
  listaPrecios: Type.Optional(Type.String({ maxLength: 40 })),
  activo: Type.Optional(Type.Boolean()),
});

const EsquemaUuid = Type.Object({
  uuid: Type.String({ format: 'uuid' }),
});

/** El segmento fija la lista de precios por defecto de la cascada (ADR-003). */
const LISTA_POR_SEGMENTO: Record<Segmento, string> = {
  REGULAR: 'REGULAR',
  VIP: 'VIP',
  FRECUENTE: 'REGULAR',
  MAYORISTA: 'MAYORISTA',
};

export function registrarRutasCliente(
  app: FastifyInstance,
  repositorio: RepositorioCliente,
): void {
  // ── BuscarClientes ──────────────────────────────────────────────
  app.get(
    '/clientes',
    { schema: { querystring: EsquemaBusqueda } },
    async (peticion) => {
      const q = peticion.query as { q: string; pagina?: number; limite?: number };
      const pagina = q.pagina ?? 1;
      const limite = q.limite ?? 50;

      const { clientes, total } = await repositorio.buscar({ q: q.q, pagina, limite });

      return exito(clientes, app.meta(peticion), { total, pagina, limite });
    },
  );

  // ── RegistrarCliente ────────────────────────────────────────────
  app.post(
    '/clientes',
    { schema: { body: EsquemaNuevo } },
    async (peticion, respuesta) => {
      const cuerpo = peticion.body as {
        tipoDocumento: TipoDocumento;
        numeroDocumento?: string;
        razonSocial: string;
        nombreComercial?: string;
        contacto?: Cliente['contacto'];
        segmento?: Segmento;
        listaPrecios?: string;
      };

      // RF-CRM-02: el formato se valida antes de asociar. Un RUC mal escrito
      // aquí es un comprobante rechazado por SUNAT más tarde.
      const validacion = validarDocumento({
        tipoDocumento: cuerpo.tipoDocumento,
        numeroDocumento: cuerpo.numeroDocumento,
      });

      if (!validacion.valido) {
        throw errorReglaNegocio(
          'DOCUMENTO_INVALIDO',
          validacion.motivo ?? 'El documento no tiene un formato válido.',
          { tipoDocumento: cuerpo.tipoDocumento },
        );
      }

      if (cuerpo.tipoDocumento !== 'GENERICO' && cuerpo.numeroDocumento) {
        const existente = await repositorio.porDocumento(
          cuerpo.tipoDocumento,
          cuerpo.numeroDocumento,
        );

        if (existente) {
          throw errorConflicto(
            'CLIENTE_DUPLICADO',
            `Ya existe un cliente con ${cuerpo.tipoDocumento} ${cuerpo.numeroDocumento}.`,
            { uuid: existente.uuid },
          );
        }
      }

      const segmento: Segmento = cuerpo.segmento ?? 'REGULAR';
      const ahora = new Date().toISOString();

      const cliente: Cliente = {
        uuid: randomUUID(),
        tipoDocumento: cuerpo.tipoDocumento,
        razonSocial: cuerpo.razonSocial,
        segmento,
        listaPrecios: cuerpo.listaPrecios ?? LISTA_POR_SEGMENTO[segmento],
        fidelizacion: { puntosAcumulados: 0, puntosRedimidos: 0 },
        activo: true,
        trazabilidad: { creadoPor: 'cajero', creadoEn: ahora },
        ...(cuerpo.numeroDocumento ? { numeroDocumento: cuerpo.numeroDocumento } : {}),
        ...(cuerpo.nombreComercial ? { nombreComercial: cuerpo.nombreComercial } : {}),
        ...(cuerpo.contacto ? { contacto: cuerpo.contacto } : {}),
        // Sin documento tributario hace falta un identificador propio para
        // poder referirse al cliente en el historial.
        ...(cuerpo.tipoDocumento === 'GENERICO'
          ? { codigoInterno: `GEN-${Date.now().toString(36).toUpperCase()}` }
          : {}),
      };

      await repositorio.guardar(cliente);

      await app.auditoria.registrar({
        correlationId: peticion.correlationId,
        servicio: app.config.nombre,
        accion: 'CLIENTE_REGISTRADO',
        recurso: 'cliente',
        recursoId: cliente.uuid,
        usuario: 'cajero',
        timestamp: ahora,
        detalle: { tipoDocumento: cliente.tipoDocumento, segmento },
      });

      return respuesta.code(201).send(exito(cliente, app.meta(peticion)));
    },
  );

  // ── ConsultarCliente ────────────────────────────────────────────
  app.get(
    '/clientes/:uuid',
    { schema: { params: EsquemaUuid } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      return exito(await exigirCliente(repositorio, uuid), app.meta(peticion));
    },
  );

  // ── ActualizarCliente ───────────────────────────────────────────
  app.patch(
    '/clientes/:uuid',
    { schema: { params: EsquemaUuid, body: EsquemaCambios } },
    async (peticion) => {
      const { uuid } = peticion.params as { uuid: string };
      const cambios = peticion.body as CambiosCliente;

      const actual = await exigirCliente(repositorio, uuid);

      // RF-CRM-07 y RNF-08: se desactiva, nunca se borra. El historial de
      // compras tiene que seguir apuntando a alguien.
      const actualizado: Cliente = {
        ...actual,
        ...limpiar(cambios),
        uuid: actual.uuid,
        tipoDocumento: actual.tipoDocumento,
        trazabilidad: {
          ...actual.trazabilidad,
          modificadoPor: 'cajero',
          modificadoEn: new Date().toISOString(),
        },
      };

      await repositorio.guardar(actualizado);

      return exito(actualizado, app.meta(peticion));
    },
  );
}

async function exigirCliente(
  repositorio: RepositorioCliente,
  uuid: string,
): Promise<Cliente> {
  const cliente = await repositorio.porUuid(uuid);
  if (!cliente) {
    throw errorNoEncontrado('CLIENTE_NO_ENCONTRADO', `No existe el cliente ${uuid}.`);
  }
  return cliente;
}

/** Quita las claves ausentes para que no pisen el valor actual con `undefined`. */
function limpiar(cambios: CambiosCliente): Partial<Cliente> {
  return Object.fromEntries(
    Object.entries(cambios).filter(([, valor]) => valor !== undefined),
  ) as Partial<Cliente>;
}
