// Carga diferida de jsPDF + jspdf-autotable, centralizada (06/10/2026, pedido de Leo: reporte
// real de un agente con un error que apuntaba a un chunk de jsPDF -- "Failed to fetch
// dynamically imported module: .../jspdf.es.min-XXXXXXXX.js" -- justo lo que tira el navegador
// cuando la pestaña quedó abierta con una build VIEJA (sus archivos .js tienen nombres
// hasheados por contenido) y mientras tanto se publicó un deploy nuevo: el archivo de la build
// vieja ya no existe en el servidor, así que el import() dinámico falla con 404. Pasa en
// CUALQUIER botón "Descargar PDF" (Liquidaciones, Proveedores, Resumen por agente, Resumen de
// club, Estado de cuenta) -- antes cada uno repetía su propio
// Promise.all([import("jspdf"), import("jspdf-autotable")]) sin capturar este caso, así que el
// error crudo del navegador (una URL pelada) le llegaba tal cual al usuario sin ninguna
// explicación. Centralizado acá para que el mensaje (y el día de mañana, cualquier otro ajuste)
// quede en un solo lugar en vez de cinco.
export async function cargarLibreriasPdf() {
  try {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    return { jsPDF, autoTable };
  } catch {
    // No se distingue el tipo de error puntual -- en la práctica, la enorme mayoría de las
    // veces que esto falla es exactamente este caso (build vieja + deploy nuevo mientras tanto),
    // y recargar la página siempre lo soluciona. Un error de red genuino (sin conexión) también
    // se arregla reintentando después de recargar, así que el mismo mensaje sirve para los dos.
    throw new Error(
      "Se publicó una versión nueva del sistema mientras tenías esta página abierta -- recargá la página (F5 o Ctrl+R) y volvé a intentar descargar el PDF."
    );
  }
}
