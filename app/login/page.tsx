'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Lock, ArrowRight, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Highlight } from '@/components/Highlight'
import { Stamp } from '@/components/Stamp'

const DEV_AUTO_EMAIL = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_EMAIL
const DEV_AUTO_PASSWORD = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_PASSWORD
const DEV_AUTO_LOGIN = Boolean(DEV_AUTO_EMAIL && DEV_AUTO_PASSWORD)

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoLoading, setAutoLoading] = useState(DEV_AUTO_LOGIN)
  const autoRan = useRef(false)

  useEffect(() => {
    if (!DEV_AUTO_LOGIN || autoRan.current) return
    autoRan.current = true
    ;(async () => {
      try {
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithPassword({
          email: DEV_AUTO_EMAIL!.trim(),
          password: DEV_AUTO_PASSWORD!,
        })
        if (error) {
          toast.error(`Auto-login dev falló: ${error.message}`)
          setAutoLoading(false)
          return
        }
        router.replace('/empresa')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error de conexión')
        setAutoLoading(false)
      }
    })()
  }, [router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error('Completá email y contraseña')
      return
    }
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) {
        toast.error(error.message)
        return
      }
      router.push('/empresa')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión')
    } finally {
      setBusy(false)
    }
  }

  if (autoLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-ink-2">
          <Loader2 className="animate-spin text-amber" size={20} />
          <span className="font-mono text-sm">Auto-login dev…</span>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex">
      {/* HERO panel — solo desktop */}
      <aside className="hidden md:flex md:w-1/2 lg:w-2/5 bg-paper-2 grain flex-col justify-between p-10 lg:p-16 border-r border-line">
        <header>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl lg:text-4xl font-medium">ContaSystem</span>
            <span className="label-mono mt-2">Carga</span>
          </div>
          <div className="perforated mt-5 max-w-[220px]" />
        </header>

        <div className="flex-1 flex items-center justify-center my-8">
          <Stamp />
        </div>

        <footer className="font-mono text-xs text-ink-3 space-y-2">
          <div className="flex items-center gap-2">
            <Lock size={13} />
            <span>Conexión cifrada · Supabase Auth</span>
          </div>
          <div>sucursales · oficina externa · gerencia</div>
        </footer>
      </aside>

      {/* FORM panel */}
      <div className="flex-1 flex items-center justify-center p-8 sm:p-10 md:p-12 lg:p-16">
        <div className="w-full max-w-md rise">
          {/* Brand en mobile */}
          <div className="md:hidden mb-12 flex items-baseline gap-3">
            <span className="font-display text-3xl font-medium">ContaSystem</span>
            <span className="label-mono mt-2">Carga</span>
          </div>

          <h1 className="font-display text-5xl lg:text-[3.5rem] font-medium leading-[0.95] mb-3">
            Iniciar<br />
            <Highlight>sesión</Highlight>
          </h1>
          <p className="text-ink-2 mb-12 text-base">
            Operadores de sucursal. Cargá facturas y recibos en segundos —
            el contador los importa después.
          </p>

          <form className="space-y-7" onSubmit={onSubmit}>
            <div>
              <label htmlFor="email" className="label-mono block mb-1">Correo</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="field"
                placeholder="tu@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="label-mono block mb-1">Contraseña</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="field"
                placeholder="•••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-5 pt-4">
              <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
                {busy ? 'Entrando…' : 'Entrar'}
                {!busy && <ArrowRight size={16} strokeWidth={2.5} />}
              </button>
            </div>
          </form>

          <div className="perforated mt-16" />
          <div className="font-mono text-[11px] text-ink-3 mt-4 flex justify-between">
            <span>SOPORTE · soporte@contasystem.uy</span>
            <span>v0.1</span>
          </div>
        </div>
      </div>
    </main>
  )
}
