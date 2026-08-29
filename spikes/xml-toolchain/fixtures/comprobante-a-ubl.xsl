<?xml version="1.0" encoding="UTF-8"?>
<!--
  Transforma el Comprobante interno al formato UBL 2.1 que espera SUNAT.
  Esta es exactamente la mediación que hará el ESB (CLAUDE.md §5.3).
  Versión reducida: solo los nodos necesarios para probar el toolchain.
-->
<xsl:stylesheet version="3.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:pos="urn:pos:ventas:comprobante:v1"
                xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
                xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
                xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
                exclude-result-prefixes="pos xsl">

  <xsl:output method="xml" indent="yes" encoding="UTF-8"/>

  <!-- Catálogo 01 de SUNAT: 01=Factura, 03=Boleta -->
  <xsl:variable name="codigoTipo">
    <xsl:choose>
      <xsl:when test="/pos:Comprobante/pos:tipoComprobante = 'FACTURA'">01</xsl:when>
      <xsl:when test="/pos:Comprobante/pos:tipoComprobante = 'BOLETA'">03</xsl:when>
      <xsl:otherwise>00</xsl:otherwise>
    </xsl:choose>
  </xsl:variable>

  <!-- Catálogo 06: 1=DNI, 6=RUC -->
  <xsl:variable name="codigoDoc">
    <xsl:choose>
      <xsl:when test="/pos:Comprobante/pos:cliente/pos:tipoDocumento = 'RUC'">6</xsl:when>
      <xsl:when test="/pos:Comprobante/pos:cliente/pos:tipoDocumento = 'DNI'">1</xsl:when>
      <xsl:otherwise>0</xsl:otherwise>
    </xsl:choose>
  </xsl:variable>

  <xsl:template match="/pos:Comprobante">
    <Invoice>
      <cbc:ID>
        <xsl:value-of select="concat(pos:serie, '-', pos:correlativo)"/>
      </cbc:ID>
      <cbc:IssueDate><xsl:value-of select="pos:fechaEmision"/></cbc:IssueDate>
      <cbc:InvoiceTypeCode><xsl:value-of select="$codigoTipo"/></cbc:InvoiceTypeCode>
      <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>

      <cac:AccountingCustomerParty>
        <cac:Party>
          <cac:PartyIdentification>
            <cbc:ID schemeID="{$codigoDoc}">
              <xsl:value-of select="pos:cliente/pos:numeroDocumento"/>
            </cbc:ID>
          </cac:PartyIdentification>
          <cac:PartyLegalEntity>
            <cbc:RegistrationName>
              <xsl:value-of select="pos:cliente/pos:razonSocial"/>
            </cbc:RegistrationName>
          </cac:PartyLegalEntity>
        </cac:Party>
      </cac:AccountingCustomerParty>

      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="PEN"><xsl:value-of select="pos:totalIgv"/></cbc:TaxAmount>
      </cac:TaxTotal>

      <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="PEN">
          <xsl:value-of select="pos:totalGravado"/>
        </cbc:LineExtensionAmount>
        <cbc:PayableAmount currencyID="PEN"><xsl:value-of select="pos:total"/></cbc:PayableAmount>
      </cac:LegalMonetaryTotal>

      <xsl:for-each select="pos:lineas/pos:linea">
        <cac:InvoiceLine>
          <cbc:ID><xsl:value-of select="position()"/></cbc:ID>
          <cbc:InvoicedQuantity unitCode="NIU">
            <xsl:value-of select="pos:cantidad"/>
          </cbc:InvoicedQuantity>
          <cbc:LineExtensionAmount currencyID="PEN">
            <xsl:value-of select="pos:importe"/>
          </cbc:LineExtensionAmount>
          <cac:Item>
            <cbc:Description><xsl:value-of select="pos:descripcion"/></cbc:Description>
            <cac:SellersItemIdentification>
              <cbc:ID><xsl:value-of select="pos:sku"/></cbc:ID>
            </cac:SellersItemIdentification>
          </cac:Item>
        </cac:InvoiceLine>
      </xsl:for-each>
    </Invoice>
  </xsl:template>

</xsl:stylesheet>
