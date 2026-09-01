CREATE TABLE "entradas_auditoria" (
	"uuid" uuid PRIMARY KEY NOT NULL,
	"correlation_id" text NOT NULL,
	"servicio" text NOT NULL,
	"accion" text NOT NULL,
	"recurso" text NOT NULL,
	"recurso_id" text,
	"usuario" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"recibido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"detalle" jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_correlation" ON "entradas_auditoria" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_servicio_accion" ON "entradas_auditoria" USING btree ("servicio","accion");--> statement-breakpoint
CREATE INDEX "idx_usuario" ON "entradas_auditoria" USING btree ("usuario");--> statement-breakpoint
CREATE INDEX "idx_timestamp" ON "entradas_auditoria" USING btree ("timestamp");