import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forzamos la raíz del workspace al directorio del proyecto.
  // Sin esto, Next infiere el padre (que también es un proyecto Next.js)
  // y turbopack termina vigilando un árbol enorme → bloqueo del equipo.
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // Votación: la boleta y el estado "ya voté" no se guardan en el disco
        // del navegador. Se declara acá y no en el proxy porque Next reescribe
        // el Cache-Control de las páginas dinámicas después del middleware
        // (deja `no-cache` pero se come el `no-store`), y muchos de estos
        // teléfonos son compartidos.
        source: "/v/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
