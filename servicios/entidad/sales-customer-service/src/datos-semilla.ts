/**
 * Datos de ejemplo para el esqueleto vertical.
 *
 * Cubren la distincion central del dominio (documento base seccion 7): un PRODUCTO
 * depende de stock, un SERVICIO depende de tiempo, personal y recurso.
 */
import type { ItemCatalogo } from './catalogo/repositorio.js';

export const CATALOGO_SEMILLA: ItemCatalogo[] = [
  {
    uuid: '3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17',
    sku: 'SH-500ML',
    tipoItem: 'PRODUCTO',
    nombre: 'Shampoo anticaspa 500ml',
    descripcion: 'Shampoo de uso frecuente, presentacion de 500ml',
    categoria: 'Cuidado capilar',
    precioBase: 25.0,
    afectoIgv: true,
    precios: [
      { lista: 'REGULAR', precio: 25.0, vigenteDesde: '2026-01-01' },
      { lista: 'VIP', precio: 21.5, vigenteDesde: '2026-01-01' },
      { lista: 'MAYORISTA', precio: 18.0, vigenteDesde: '2026-01-01' },
    ],
    activo: true,
  },
  {
    uuid: '8a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
    sku: 'SRV-CORTE',
    tipoItem: 'SERVICIO',
    nombre: 'Corte de cabello',
    descripcion: 'Corte con especialista asignado',
    categoria: 'Servicios de peluqueria',
    precioBase: 45.0,
    afectoIgv: true,
    // Un SERVICIO no depende de stock sino de disponibilidad.
    datosServicio: {
      duracionMinutos: 45,
      especialistas: ['c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f'],
      recursos: ['d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a'],
    },
    activo: true,
  },
  {
    uuid: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
    sku: 'CMB-CUIDADO',
    tipoItem: 'COMBO',
    nombre: 'Combo cuidado completo',
    descripcion: 'Shampoo + corte de cabello',
    categoria: 'Combos',
    precioBase: 60.0,
    afectoIgv: true,
    activo: true,
  },
  {
    uuid: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    sku: 'AC-DESCONT',
    tipoItem: 'PRODUCTO',
    nombre: 'Acondicionador descontinuado',
    categoria: 'Cuidado capilar',
    precioBase: 19.0,
    afectoIgv: true,
    // RF-CAT-07: se desactiva, no se elimina del historico.
    activo: false,
  },
];
