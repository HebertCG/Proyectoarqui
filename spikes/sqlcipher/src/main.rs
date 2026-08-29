//! SPIKE S-03 — SQLCipher sobre Windows, sin OpenSSL externo.
//!
//! Valida lo que la Fase 7 (Terminal POS) da por sentado:
//!   1. `rusqlite` con `bundled-sqlcipher` compila en Windows
//!   2. Se crea una base cifrada y se escribe/relee con `PRAGMA key`
//!   3. Abrirla SIN la clave correcta falla
//!   4. El archivo en disco no expone los datos en claro
//!
//! Cubre RNF-07 (datos de cliente cifrados en reposo) y la advertencia W-02.

use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;

const CLAVE: &str = "clave-de-prueba-del-spike";
const CLAVE_INCORRECTA: &str = "clave-equivocada";

fn ruta_base() -> PathBuf {
    std::env::temp_dir().join("spike_sqlcipher.db")
}

/// Abre una conexión cifrada. `PRAGMA key` debe ir antes de cualquier consulta.
fn abrir_cifrada(ruta: &PathBuf, clave: &str) -> Result<Connection> {
    let conexion = Connection::open(ruta)?;
    conexion.pragma_update(None, "key", clave)?;
    Ok(conexion)
}

fn paso_1_crear_y_escribir(ruta: &PathBuf) -> Result<()> {
    let conexion = abrir_cifrada(ruta, CLAVE)?;

    conexion.execute(
        "CREATE TABLE cliente (
            id              TEXT PRIMARY KEY,
            tipo_documento  TEXT NOT NULL,
            numero_documento TEXT,
            razon_social    TEXT NOT NULL
        )",
        [],
    )?;

    conexion.execute(
        "INSERT INTO cliente (id, tipo_documento, numero_documento, razon_social)
         VALUES (?1, ?2, ?3, ?4)",
        (
            "3f7c1e94-9b2a-4d51-a8e3-6c0f5d2b8a17",
            "RUC",
            "20512345678",
            "Distribuidora San Miguel S.A.C.",
        ),
    )?;

    println!("  [1] base cifrada creada y cliente insertado");
    Ok(())
}

fn paso_2_releer(ruta: &PathBuf) -> Result<()> {
    let conexion = abrir_cifrada(ruta, CLAVE)?;

    let razon: String = conexion.query_row(
        "SELECT razon_social FROM cliente WHERE numero_documento = ?1",
        ["20512345678"],
        |fila| fila.get(0),
    )?;

    assert_eq!(razon, "Distribuidora San Miguel S.A.C.");
    println!("  [2] releido con la clave correcta: {razon}");
    Ok(())
}

fn paso_3_clave_incorrecta_falla(ruta: &PathBuf) -> Result<()> {
    let conexion = abrir_cifrada(ruta, CLAVE_INCORRECTA)?;
    let resultado: Result<i64> =
        conexion.query_row("SELECT count(*) FROM cliente", [], |fila| fila.get(0));

    match resultado {
        Err(e) => {
            println!("  [3] con clave incorrecta falla como se espera: {e}");
            Ok(())
        }
        Ok(_) => panic!("FALLO CRITICO: la base se leyo con la clave incorrecta"),
    }
}

fn paso_4_no_hay_texto_en_claro(ruta: &PathBuf) -> Result<()> {
    let bytes = fs::read(ruta).expect("no se pudo leer el archivo de base de datos");

    // Un SQLite sin cifrar empieza con la cabecera "SQLite format 3".
    let cabecera_plana = bytes.starts_with(b"SQLite format 3");
    let contiene_dato = bytes
        .windows(11)
        .any(|v| v == b"20512345678");

    assert!(!cabecera_plana, "FALLO: la cabecera SQLite esta en claro");
    assert!(!contiene_dato, "FALLO: el RUC aparece en claro en el archivo");

    println!(
        "  [4] archivo cifrado ({} bytes): sin cabecera SQLite ni datos legibles",
        bytes.len()
    );
    Ok(())
}

fn main() -> Result<()> {
    let ruta = ruta_base();
    let _ = fs::remove_file(&ruta);

    println!("SPIKE S-03 — SQLCipher en Windows\n");
    println!("  base: {}", ruta.display());

    paso_1_crear_y_escribir(&ruta)?;
    paso_2_releer(&ruta)?;
    paso_3_clave_incorrecta_falla(&ruta)?;
    paso_4_no_hay_texto_en_claro(&ruta)?;

    let _ = fs::remove_file(&ruta);

    println!("\nRESULTADO: VERDE — SQLCipher operativo, RNF-07 alcanzable.");
    Ok(())
}
