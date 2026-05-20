'use client'

import { useEffect, useState } from 'react'

/**
 * Devuelve `true` mientras `navigator.onLine` reporte conexión. Se actualiza
 * con los eventos `online`/`offline` del navegador.
 *
 * Nota: `navigator.onLine === true` significa "tengo una interfaz de red
 * activa", no "puedo llegar a Supabase". Para distinguir el segundo caso
 * usamos `esErrorDeRed()` cuando una petición real falla.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
