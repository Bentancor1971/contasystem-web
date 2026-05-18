'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Save, ShieldCheck, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useApp } from '@/lib/app-context'
import {
  canManageRoles,
  DEFAULT_PERMISOS,
  PERMISO_DESCRIPCION,
  PERMISO_LABEL,
  PERMISOS_INMUTABLES_ADMIN,
  PERMISOS_KEYS,
  ROL_DESCRIPCION,
  ROL_LABEL,
  ROLES,
  ROLES_LIST,
  type PermisosRol,
  type Rol,
} from '@/lib/roles'

type Matriz = Record<Rol, PermisosRol>

function cloneMatriz(m: Matriz): Matriz {
  return {
    admin: { ...m.admin },
    contador: { ...m.contador },
    usuario: { ...m.usuario },
  }
}

function matrizEqual(a: Matriz, b: Matriz): boolean {
  for (const rol of ROLES_LIST) {
    for (const k of PERMISOS_KEYS) {
      if (a[rol][k] !== b[rol][k]) return false
    }
  }
  return true
}

export default function RolesPage() {
  const router = useRouter()
  const { empresa, permisos } = useApp()
  const [matriz, setMatriz] = useState<Matriz | null>(null)
  const [original, setOriginal] = useState<Matriz | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canManageRoles(permisos)) {
      router.replace('/configuracion')
    }
  }, [permisos, router])

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.empresa_id])

  async function cargar() {
    setMatriz(null)
    setOriginal(null)
    const res = await fetch(
      `/api/admin/permisos?empresa_id=${encodeURIComponent(empresa.empresa_id)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      toast.error(`No pude cargar permisos · ${res.status} ${txt}`)
      return
    }
    const data = (await res.json()) as { matriz: Matriz }
    setMatriz(cloneMatriz(data.matriz))
    setOriginal(cloneMatriz(data.matriz))
  }

  if (!canManageRoles(permisos)) return null

  const hayCambios = matriz && original ? !matrizEqual(matriz, original) : false

  function toggle(rol: Rol, key: keyof PermisosRol) {
    if (!matriz) return
    if (rol === ROLES.ADMIN && PERMISOS_INMUTABLES_ADMIN.includes(key)) {
      // anti-lockout: no permitir desmarcar
      return
    }
    setMatriz({
      ...matriz,
      [rol]: { ...matriz[rol], [key]: !matriz[rol][key] },
    })
  }

  function resetADefaults() {
    setMatriz(cloneMatriz(DEFAULT_PERMISOS))
  }

  function descartar() {
    if (original) setMatriz(cloneMatriz(original))
  }

  async function guardar() {
    if (!matriz) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/permisos', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          empresa_id: empresa.empresa_id,
          matriz,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        matriz?: Matriz
      }
      if (!res.ok) {
        toast.error(data.error ?? `Error · ${res.status}`)
        return
      }
      toast.success('Permisos guardados')
      if (data.matriz) {
        setMatriz(cloneMatriz(data.matriz))
        setOriginal(cloneMatriz(data.matriz))
      } else {
        setOriginal(cloneMatriz(matriz))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 label-mono text-ink-2 hover:text-ink mb-5"
      >
        <ArrowLeft size={12} /> Configuración
      </Link>

      <div className="mb-7 rise">
        <p className="label-mono mb-2">Empresa · {empresa.nombre}</p>
        <h1 className="font-display text-4xl font-medium leading-tight">
          Roles y permisos
        </h1>
        <p className="text-ink-2 mt-3 text-base max-w-2xl">
          Definí qué acciones puede realizar cada rol en esta empresa. Los
          cambios afectan solo a los usuarios de <strong>{empresa.nombre}</strong>.
        </p>
      </div>

      {matriz === null ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={28} className="animate-spin text-amber" />
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-paper-2">
                  <th className="text-left px-5 py-4 label-mono font-medium">
                    Rol
                  </th>
                  {PERMISOS_KEYS.map((k) => (
                    <th
                      key={k}
                      className="px-3 py-4 label-mono font-medium text-center align-bottom"
                      title={PERMISO_DESCRIPCION[k]}
                    >
                      {PERMISO_LABEL[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLES_LIST.map((rol, idx) => (
                  <tr
                    key={rol}
                    className={
                      idx < ROLES_LIST.length - 1 ? 'border-b border-line' : ''
                    }
                  >
                    <td className="px-5 py-4 align-top">
                      <div className="flex items-start gap-2">
                        {rol === ROLES.ADMIN && (
                          <ShieldCheck
                            size={14}
                            className="text-amber-deep mt-1 flex-shrink-0"
                          />
                        )}
                        <div>
                          <div className="font-display-tight text-base font-medium">
                            {ROL_LABEL[rol]}
                          </div>
                          <div className="font-mono text-[11px] text-ink-3 mt-0.5 max-w-[220px] leading-relaxed">
                            {ROL_DESCRIPCION[rol]}
                          </div>
                        </div>
                      </div>
                    </td>
                    {PERMISOS_KEYS.map((k) => {
                      const checked = matriz[rol][k]
                      const inmutable =
                        rol === ROLES.ADMIN &&
                        PERMISOS_INMUTABLES_ADMIN.includes(k)
                      return (
                        <td key={k} className="px-3 py-4 text-center">
                          <label
                            className={`inline-flex items-center justify-center ${
                              inmutable
                                ? 'cursor-not-allowed'
                                : 'cursor-pointer'
                            }`}
                            title={
                              inmutable
                                ? 'El Administrador no puede perder este permiso (anti-lockout)'
                                : PERMISO_DESCRIPCION[k]
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(rol, k)}
                              disabled={busy || inmutable}
                              className="w-4 h-4 accent-ink"
                            />
                          </label>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={resetADefaults}
              className="btn-ghost"
              disabled={busy}
            >
              <RotateCcw size={14} />
              <span className="label-mono">Volver a defaults</span>
            </button>

            <div className="flex items-center gap-3">
              {hayCambios && !busy && (
                <button
                  type="button"
                  onClick={descartar}
                  className="btn-ghost"
                >
                  <span className="label-mono">Descartar</span>
                </button>
              )}
              <button
                type="button"
                onClick={guardar}
                className="btn-primary"
                disabled={busy || !hayCambios}
              >
                {busy ? 'Guardando…' : 'Guardar cambios'}
                {!busy && <Save size={16} strokeWidth={2.5} />}
              </button>
            </div>
          </div>

          <p className="font-mono text-[11px] text-ink-3 mt-5 leading-relaxed max-w-2xl">
            El rol <strong>Administrador</strong> siempre conserva los permisos
            de gestionar usuarios y gestionar roles. Es para evitar que la
            empresa se quede sin nadie con acceso a esta pantalla.
          </p>
        </>
      )}
    </main>
  )
}
