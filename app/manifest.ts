import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ContaSystem Carga',
    short_name: 'CS Carga',
    description: 'Carga online de comprobantes para ContaSystem',
    start_url: '/',
    display: 'standalone',
    background_color: '#fdfcf7',
    theme_color: '#f59e0b',
    orientation: 'portrait',
    lang: 'es',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      {
        src: '/icon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
