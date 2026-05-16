import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forzamos la raíz del workspace al directorio del proyecto.
  // Sin esto, Next infiere el padre (que también es un proyecto Next.js)
  // y turbopack termina vigilando un árbol enorme → bloqueo del equipo.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
