/**
 * Firma digital XMLDSig sobre el UBL.
 *
 * SUNAT exige que el comprobante vaya firmado con un certificado digital del
 * emisor. La firma es **enveloped**: va dentro del propio documento, en el nodo
 * `ext:ExtensionContent` que UBL reserva para eso.
 *
 * El certificado y su clave privada **jamás se versionan** (CLAUDE.md §9.3):
 * llegan por variable de entorno o gestor de secretos.
 */
import { SignedXml } from 'xml-crypto';
import { parsear } from '@pos/xml-kit';

export interface CredencialesFirma {
  /** Clave privada en PEM. */
  clavePrivada: string;
  /** Certificado en PEM, que viaja dentro de la firma como KeyInfo. */
  certificado: string;
}

export class ErrorFirma extends Error {
  constructor(detalle: string) {
    super(`No se pudo firmar el comprobante: ${detalle}`);
    this.name = 'ErrorFirma';
  }
}

/**
 * Firma un documento UBL.
 *
 * Se construye una vez con las credenciales y se reutiliza. Que las credenciales
 * se inyecten —en vez de leerse de `process.env` aquí dentro— es lo que permite
 * probar la firma sin un certificado real.
 */
export class FirmadorUbl {
  readonly #credenciales: CredencialesFirma;

  constructor(credenciales: CredencialesFirma) {
    if (!credenciales.clavePrivada || !credenciales.certificado) {
      throw new ErrorFirma('faltan la clave privada o el certificado.');
    }
    this.#credenciales = credenciales;
  }

  /**
   * Devuelve el UBL con la firma incrustada.
   *
   * @param ubl Documento UBL 2.1 sin firmar.
   */
  firmar(ubl: string): string {
    // xml-crypto REPARA en silencio el XML mal formado y firma la version
    // reparada: `<roto sin cerrar` se convierte en `<roto sin="sin">` y se firma.
    // Eso significaria mandar a SUNAT algo distinto de lo que se valido contra
    // el XSD. Se verifica que el documento este bien formado antes de firmar.
    exigirBienFormado(ubl);

    try {
      const firma = new SignedXml({
        privateKey: this.#credenciales.clavePrivada,
        publicCert: this.#credenciales.certificado,
        // SUNAT acepta RSA-SHA256; SHA1 está descontinuado.
        signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      });

      // Firma todo el documento (referencia vacía = el documento entero).
      firma.addReference({
        xpath: '/*',
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
      });

      firma.computeSignature(ubl);
      return firma.getSignedXml();
    } catch (causa) {
      throw new ErrorFirma(causa instanceof Error ? causa.message : String(causa));
    }
  }
}

/** Falla si el XML no esta bien formado. Ver el comentario en `firmar`. */
function exigirBienFormado(xml: string): void {
  try {
    parsear(xml);
  } catch (causa) {
    throw new ErrorFirma(
      'el documento no es XML bien formado, y firmarlo produciria un ' +
        `documento distinto del validado. Detalle: ${
          causa instanceof Error ? causa.message : String(causa)
        }`,
    );
  }
}

/**
 * Firmador que no firma. Para desarrollo y pruebas sin certificado.
 *
 * **Marca el documento explícitamente** con un comentario: así es imposible
 * confundir un comprobante sin firmar con uno firmado de verdad si alguien mira
 * el XML generado.
 */
export class FirmadorSimulado {
  firmar(ubl: string): string {
    return ubl.replace(
      /\?>/,
      '?>\n<!-- SIN FIRMA DIGITAL REAL: entorno de desarrollo. -->',
    );
  }
}

export type Firmador = FirmadorUbl | FirmadorSimulado;

/**
 * Construye el firmador según haya credenciales o no.
 *
 * Falla ruidosamente si se pide firma real en producción sin certificado: un
 * comprobante sin firmar que llegue a SUNAT se rechaza, y descubrirlo ahí es
 * mucho más caro que fallar al arrancar.
 */
export function crearFirmador(
  entorno: string,
  credenciales?: Partial<CredencialesFirma>,
): Firmador {
  const completas =
    credenciales?.clavePrivada !== undefined && credenciales.certificado !== undefined;

  if (completas) {
    return new FirmadorUbl(credenciales as CredencialesFirma);
  }

  if (entorno === 'production') {
    throw new ErrorFirma(
      'no hay certificado configurado y el entorno es producción. ' +
        'SUNAT rechaza los comprobantes sin firma digital válida.',
    );
  }

  return new FirmadorSimulado();
}
