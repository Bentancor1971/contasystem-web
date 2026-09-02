import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forzamos la raíz del workspace al directorio del proyecto.
  // Sin esto, Next infiere el padre (que también es un proyecto Next.js)
  // y turbopack termina vigilando un árbol enorme → bloqueo del equipo.
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    // Votación, postulación y mesa: la boleta, la deuda y el estado "ya voté" /
    // "ya me anoté" no se guardan en el disco de un teléfono compartido. Se
    // declara acá y no en el proxy porque Next reescribe el Cache-Control de
    // las páginas dinámicas después del middleware (deja `no-cache` pero se
    // come el `no-store`). `/p/` quedaba afuera —una convocatoria sin segundo
    // factor dejaba nombre y deuda en el caché de disco— y `/mesa/` también,
    // que además lleva documentos en el padrón.
    const SIN_CACHE = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
    ];
    return [
      { source: "/v/:path*", headers: SIN_CACHE },
      { source: "/p/:path*", headers: SIN_CACHE },
      { source: "/mesa/:path*", headers: SIN_CACHE },
      // La ficha del socio: tras el segundo factor la página muestra los
      // datos personales completos — nada de eso queda en caché de disco.
      { source: "/f/:path*", headers: SIN_CACHE },
    ];
  },
};

export default nextConfig;
