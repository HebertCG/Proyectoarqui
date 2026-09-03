/**
 * Publicación inicial del inventario canónico (CLAUDE.md §4.2).
 *
 * El registro nace poblado con los ocho servicios de entidad, los de utilidad y
 * los de tarea. **Los stubs de Nivel 3 se declaran como simulados**: aparecen en
 * el descubrimiento, pero nadie puede confundirlos con servicios reales.
 */
import { clave } from './modelo-uddi.js';
import type { RegistroUddi } from './repositorio.js';
import type { BusinessService, TModel } from './modelo-uddi.js';

const NEGOCIO = clave('business', 'pos-multirubro');

const BASE = process.env['REGISTRO_BASE_URL'] ?? 'http://localhost';

const tModel = (
  nombre: string,
  descripcion: string,
  urlContrato: string,
  categorias: string[],
): TModel => ({
  tModelKey: clave('tmodel', nombre),
  nombre,
  descripcion,
  urlContrato,
  categorias,
});

/** Especificaciones técnicas reutilizables. */
const T_MODELS: TModel[] = [
  tModel(
    'openapi-3.1',
    'Contrato REST descrito con OpenAPI 3.1',
    'contratos/openapi/',
    ['protocol:rest', 'spec:openapi'],
  ),
  tModel(
    'wsdl-1.1-soap',
    'Contrato SOAP descrito con WSDL 1.1, estilo document/literal',
    'contratos/wsdl/',
    ['protocol:soap', 'spec:wsdl'],
  ),
  tModel(
    'ubl-2.1-sunat',
    'Comprobante electrónico UBL 2.1 con firma XMLDSig, según SUNAT',
    'contratos/xsd/einvoicing-v1.xsd',
    ['protocol:soap', 'spec:ubl', 'dominio:tributario'],
  ),
  tModel(
    'amqp-eventos',
    'Eventos asíncronos sobre AMQP con idempotencia por UUIDv4',
    'contratos/eventos/',
    ['protocol:amqp', 'spec:eventos'],
  ),
];

interface DefinicionServicio {
  nombre: string;
  descripcion: string;
  capa: BusinessService['capa'];
  nivel: BusinessService['nivel'];
  puerto: number;
  categorias: string[];
  simulado?: boolean;
  soap?: boolean;
}

/** El inventario canónico de CLAUDE.md §4.2, §4.3 y §4.4. */
const SERVICIOS: DefinicionServicio[] = [
  // ── Entidad ─────────────────────────────────────────────────
  {
    nombre: 'Sales.Customer.Entity',
    descripcion:
      'Servicio compuesto: Caja, Venta/POS, Cliente/CRM y Catálogo. Núcleo operativo.',
    capa: 'entidad',
    nivel: 'N1',
    puerto: 3001,
    categorias: ['dominio:venta', 'dominio:crm', 'dominio:catalogo', 'local-first'],
  },
  {
    nombre: 'EInvoicing.Entity',
    descripcion:
      'Comprobantes electrónicos: UBL 2.1, firma XMLDSig y envío tributario a SUNAT.',
    capa: 'entidad',
    nivel: 'N1',
    puerto: 3005,
    categorias: ['dominio:tributario', 'b2b'],
    soap: true,
  },
  {
    nombre: 'Inventory.Entity',
    descripcion: 'Stock, Kardex y alertas de mínimos. También opera local-first.',
    capa: 'entidad',
    nivel: 'N2',
    puerto: 3002,
    categorias: ['dominio:inventario', 'local-first'],
  },
  {
    nombre: 'OrderBooking.Entity',
    descripcion: 'Carritos y agendamiento de citas. Sujeto a la decisión V-08.',
    capa: 'entidad',
    nivel: 'N2',
    puerto: 3003,
    categorias: ['dominio:agenda', 'dominio:pedidos'],
  },
  {
    nombre: 'NotificationSync.Entity',
    descripcion: 'Sincronización terminal↔nube y notificaciones en tiempo real.',
    capa: 'entidad',
    nivel: 'N2',
    puerto: 3004,
    categorias: ['dominio:sincronizacion', 'tiempo-real'],
  },
  {
    nombre: 'PaymentGateway.Entity',
    descripcion: 'Pasarelas de pago externas, links de pago y QR dinámicos.',
    capa: 'entidad',
    nivel: 'N3',
    puerto: 3006,
    categorias: ['dominio:pagos', 'b2b'],
    simulado: true,
  },
  {
    nombre: 'OmnichannelBot.Entity',
    descripcion: 'WhatsApp Cloud API e IVR para pedidos y reservas.',
    capa: 'entidad',
    nivel: 'N3',
    puerto: 3007,
    categorias: ['dominio:omnicanal', 'b2b'],
    simulado: true,
  },
  {
    nombre: 'AnalyticsReporting.Entity',
    descripcion: 'Dashboards y consolidación multi-serie de comprobantes.',
    capa: 'entidad',
    nivel: 'N3',
    puerto: 3008,
    categorias: ['dominio:analitica'],
    simulado: true,
  },

  // ── Utilidad ────────────────────────────────────────────────
  {
    nombre: 'Auditoria.Utility',
    descripcion: 'Registro append-only de toda operación del inventario.',
    capa: 'utilidad',
    nivel: 'N1',
    puerto: 3012,
    categorias: ['transversal:auditoria'],
  },
  {
    nombre: 'Sincronizacion.Utility',
    descripcion: 'Idempotencia por UUIDv4 y backoff exponencial, reutilizable.',
    capa: 'utilidad',
    nivel: 'N2',
    puerto: 3013,
    categorias: ['transversal:sincronizacion'],
  },
  {
    nombre: 'Notificacion.Utility',
    descripcion: 'Envío de comprobantes y alertas transversales.',
    capa: 'utilidad',
    nivel: 'N2',
    puerto: 3014,
    categorias: ['transversal:notificacion'],
  },

  // ── Tarea ───────────────────────────────────────────────────
  {
    nombre: 'ProcesoVenta.Task',
    descripcion: 'Venta de mostrador hasta comprobante fiscal.',
    capa: 'tarea',
    nivel: 'N1',
    puerto: 3020,
    categorias: ['proceso:venta', 'bpmn'],
  },
  {
    nombre: 'CierreCaja.Task',
    descripcion: 'Arqueo y cierre del turno de caja, con drenaje de comprobantes pendientes.',
    capa: 'tarea',
    nivel: 'N1',
    puerto: 3023,
    categorias: ['proceso:caja', 'bpmn'],
  },
  {
    nombre: 'ReservaMulticanal.Task',
    descripcion: 'Reserva por canal digital validada contra disponibilidad real.',
    capa: 'tarea',
    nivel: 'N2',
    puerto: 3021,
    categorias: ['proceso:reserva', 'bpmn'],
  },
  {
    nombre: 'ConciliacionPago.Task',
    descripcion: 'Confirmación de pago remoto y actualización del ticket asociado.',
    capa: 'tarea',
    nivel: 'N3',
    puerto: 3022,
    categorias: ['proceso:pago', 'bpmn'],
    simulado: true,
  },

  // ── Infraestructura ─────────────────────────────────────────
  {
    nombre: 'ESB',
    descripcion: 'Punto único de integración: ruteo, transformación, mediación y auditoría.',
    capa: 'infraestructura',
    nivel: 'N1',
    puerto: 3000,
    categorias: ['infraestructura:bus'],
  },
];

/** Publica el inventario completo en el registro. */
export function publicarInventario(registro: RegistroUddi): void {
  registro.publicarEntidad({
    businessKey: NEGOCIO,
    nombre: 'POS Multirrubro',
    descripcion:
      'Sistema POS y e-commerce multirrubro bajo arquitectura orientada al servicio.',
  });

  for (const t of T_MODELS) registro.publicarTModel(t);

  const keyOpenapi = clave('tmodel', 'openapi-3.1');
  const keyWsdl = clave('tmodel', 'wsdl-1.1-soap');
  const keyUbl = clave('tmodel', 'ubl-2.1-sunat');

  for (const def of SERVICIOS) {
    const bindings = [
      {
        bindingKey: clave('binding', `${def.nombre}-rest`),
        accessPoint: `${BASE}:${def.puerto}`,
        tipoAcceso: 'REST' as const,
        tModelKeys: [keyOpenapi],
        descripcion: 'Interfaz REST/JSON del servicio',
      },
    ];

    // Solo EInvoicing expone SOAP, y por una razón: SUNAT lo exige.
    if (def.soap) {
      bindings.push({
        bindingKey: clave('binding', `${def.nombre}-soap`),
        accessPoint: `${BASE}:${def.puerto}/ol-ti-itcpe/billService`,
        tipoAcceso: 'SOAP' as never,
        tModelKeys: [keyWsdl, keyUbl],
        descripcion: 'Interfaz SOAP/WSDL, compatible con el billService de SUNAT',
      });
    }

    registro.publicarServicio({
      serviceKey: clave('service', def.nombre),
      businessKey: NEGOCIO,
      nombre: def.nombre,
      descripcion: def.descripcion,
      capa: def.capa,
      nivel: def.nivel,
      categorias: def.categorias,
      bindings,
      simulado: def.simulado ?? false,
    });
  }
}

export { NEGOCIO, T_MODELS, SERVICIOS };
