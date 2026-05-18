'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  UserPlus,
  ShieldCheck,
  Mail,
  Eye,
  EyeOff,
  Pencil,
  Save,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useApp } from '@/lib/app-context'
import {
  canManageUsers,
  ROL_LABEL,
  ROL_DESCRIPCION,
  ROLES,
  ROLES_LIST,
  type Rol,
} from '@/lib/roles'

interface UsuarioRow {
  user_id: string
  email: string | null
  nombre: string | null
  rol: Rol
  created_at: string
}

export default function UsuariosPage() {
  const router = useRouter()
  const { empresa, permisos, userId: miUserId } = useApp()
  const [usuarios, setUsuarios] = useState<UsuarioRow[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<UsuarioRow | null>(null)

  useEffect(() => {
    if (!canManageUsers(permisos)) {
      router.replace('/configuracion')
    }
  }, [permisos, router])

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.empresa_id])

  async function cargar() {
    setUsuarios(null)
    const res = await fetch(
      `/api/admin/usuarios?empresa_id=${encodeURIComponent(empresa.empresa_id)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      toast.error(`No pude listar usuarios · ${res.status} ${txt}`)
      setUsuarios([])
      return
    }
    const data = (await res.json()) as { usuarios: UsuarioRow[] }
    setUsuarios(data.usuarios)
  }

  if (!canManageUsers(permisos)) return null

  return (
    <main className="max-w-3xl mx-auto px-5 md:px-8 py-7 lg:py-10 flex-1 w-full">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 label-mono text-ink-2 hover:text-ink mb-5"
      >
        <ArrowLeft size={12} /> Configuración
      </Link>

      <div className="flex items-end justify-between gap-4 mb-7 rise">
        <div>
          <p className="label-mono mb-2">Empresa · {empresa.nombre}</p>
          <h1 className="font-display text-4xl font-medium leading-tight">
            Usuarios
          </h1>
        </div>
        {!showForm && !editing && (
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary whitespace-nowrap"
          >
            <UserPlus size={16} strokeWidth={2.5} /> Nuevo
          </button>
        )}
      </div>

      {showForm && (
        <FormCrear
          empresaId={empresa.empresa_id}
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false)
            void cargar()
          }}
        />
      )}

      {editing && (
        <FormEditar
          empresaId={empresa.empresa_id}
          usuario={editing}
          esYo={editing.user_id === miUserId}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void cargar()
          }}
        />
      )}

      <div className="card p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display-tight text-xl font-medium">Acceso a la empresa</h2>
          <span className="font-mono text-xs text-ink-3">
            {usuarios?.length ?? '—'} usuario{usuarios?.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="perforated mb-3" />

        {usuarios === null ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={24} className="animate-spin text-amber" />
          </div>
        ) : usuarios.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">
            Sin usuarios asignados a esta empresa todavía.
          </p>
        ) : (
          <div>
            {usuarios.map((u, i) => (
              <div key={u.user_id}>
                <UsuarioRowView
                  usuario={u}
                  esYo={u.user_id === miUserId}
                  onEdit={() => {
                    setShowForm(false)
                    setEditing(u)
                  }}
                />
                {i < usuarios.length - 1 && <div className="perforated mx-1" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function UsuarioRowView({
  usuario,
  esYo,
  onEdit,
}: {
  usuario: UsuarioRow
  esYo: boolean
  onEdit: () => void
}) {
  const tituloPrincipal = usuario.nombre?.trim() || usuario.email || '(sin nombre)'
  const tieneNombre = !!usuario.nombre?.trim()
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 px-2 py-3.5 group">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display-tight text-base font-medium">
            {tituloPrincipal}
          </span>
          {esYo && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 bg-paper-2 px-1.5 py-0.5 rounded">
              vos
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-ink-3 mt-0.5">
          {tieneNombre && usuario.email ? usuario.email : `${usuario.user_id.slice(0, 8)}…`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RolBadge rol={usuario.rol} />
        <button
          onClick={onEdit}
          className="p-1.5 rounded text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
          aria-label={`Editar ${tituloPrincipal}`}
        >
          <Pencil size={14} />
        </button>
      </div>
    </div>
  )
}

function RolBadge({ rol }: { rol: Rol }) {
  const styles: Record<Rol, string> = {
    admin: 'bg-amber-light text-amber-deep',
    contador: 'bg-status-ok-bg text-status-ok',
    usuario: 'bg-paper-2 text-ink-2',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] font-medium px-2.5 py-1 rounded-full ${styles[rol]}`}
    >
      {rol === ROLES.ADMIN && <ShieldCheck size={11} />}
      {ROL_LABEL[rol]}
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────
// Form crear usuario
// ────────────────────────────────────────────────────────────────────

function FormCrear({
  empresaId,
  onCancel,
  onCreated,
}: {
  empresaId: string
  onCancel: () => void
  onCreated: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState<Rol>(ROLES.USUARIO)
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) {
      toast.error('Ingresá un nombre')
      return
    }
    if (!email.trim() || !password.trim()) {
      toast.error('Completá email y password')
      return
    }
    if (password.length < 8) {
      toast.error('La password debe tener al menos 8 caracteres')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          empresa_id: empresaId,
          nombre: nombre.trim(),
          email: email.trim(),
          password,
          rol,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
      }
      if (!res.ok) {
        toast.error(data.error ?? `Error · ${res.status}`)
        return
      }
      toast.success(`Usuario ${nombre.trim()} creado`)
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear usuario')
    } finally {
      setBusy(false)
    }
  }

  function generarPassword() {
    // 12 caracteres, alfanuméricos + algún símbolo accesible
    const alfa = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const sym = '#$%&*+-=?@'
    const pool = alfa + sym
    let out = ''
    const arr = new Uint32Array(12)
    crypto.getRandomValues(arr)
    for (let i = 0; i < arr.length; i++) {
      out += pool[arr[i] % pool.length]
    }
    setPassword(out)
    setShowPass(true)
  }

  return (
    <form onSubmit={submit} className="card p-6 lg:p-7 mb-6 rise">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="font-display-tight text-xl font-medium">Nuevo usuario</h2>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost"
          disabled={busy}
        >
          <span className="label-mono">Cancelar</span>
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="nombre" className="label-mono block mb-2">
            Nombre *
          </label>
          <input
            id="nombre"
            type="text"
            autoComplete="off"
            className="field text-[17px]"
            placeholder="Ej. María Pérez"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={busy}
            required
            maxLength={80}
          />
          <p className="font-mono text-[11px] text-ink-3 mt-2">
            Se va a mostrar en los comprobantes que cargue este usuario.
          </p>
        </div>

        <div>
          <label htmlFor="email" className="label-mono block mb-2">
            Email *
          </label>
          <div className="flex items-baseline gap-2 border-b-[1.5px] border-ink py-1.5">
            <Mail size={14} className="text-ink-3" />
            <input
              id="email"
              type="email"
              autoComplete="off"
              className="font-mono text-[15px] bg-transparent border-0 outline-none w-full p-0"
              placeholder="usuario@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label htmlFor="password" className="label-mono">
              Password * (mín 8 caracteres)
            </label>
            <button
              type="button"
              onClick={generarPassword}
              className="font-mono text-[11px] text-amber-deep hover:underline"
              disabled={busy}
            >
              Generar
            </button>
          </div>
          <div className="flex items-baseline gap-2 border-b-[1.5px] border-ink py-1.5">
            <input
              id="password"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              className="font-mono text-[15px] bg-transparent border-0 outline-none w-full p-0"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="text-ink-3 hover:text-ink-2"
              aria-label={showPass ? 'Ocultar' : 'Mostrar'}
            >
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="font-mono text-[11px] text-ink-3 mt-2 leading-relaxed">
            El usuario podrá cambiarla después desde su perfil de Supabase. Pasale
            email + password por un canal seguro.
          </p>
        </div>

        <div>
          <span className="label-mono block mb-2">Rol en esta empresa *</span>
          <div className="space-y-2">
            {ROLES_LIST.map((r) => (
              <label
                key={r}
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  rol === r
                    ? 'border-ink bg-paper-2'
                    : 'border-line hover:border-ink-3'
                }`}
              >
                <input
                  type="radio"
                  name="rol"
                  value={r}
                  checked={rol === r}
                  onChange={() => setRol(r)}
                  disabled={busy}
                  className="mt-0.5 accent-ink"
                />
                <div>
                  <div className="font-medium text-sm">{ROL_LABEL[r]}</div>
                  <div className="font-mono text-[11px] text-ink-3 mt-0.5">
                    {ROL_DESCRIPCION[r]}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Creando…' : 'Crear usuario'}
            {!busy && <UserPlus size={16} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </form>
  )
}

// ────────────────────────────────────────────────────────────────────
// Form editar usuario (nombre + rol)
// ────────────────────────────────────────────────────────────────────

function FormEditar({
  empresaId,
  usuario,
  esYo,
  onCancel,
  onSaved,
}: {
  empresaId: string
  usuario: UsuarioRow
  esYo: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(usuario.nombre ?? '')
  const [rol, setRol] = useState<Rol>(usuario.rol)
  const [busy, setBusy] = useState(false)

  const nombreCambio = nombre.trim() !== (usuario.nombre ?? '').trim()
  const rolCambio = rol !== usuario.rol
  const hayCambios = nombreCambio || rolCambio

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!hayCambios) {
      toast('Sin cambios — el nombre y rol ya están actualizados', {
        icon: 'ℹ️',
      })
      onCancel()
      return
    }
    if (nombreCambio && !nombre.trim()) {
      toast.error('El nombre no puede estar vacío')
      return
    }

    setBusy(true)
    try {
      const body: Record<string, unknown> = { empresa_id: empresaId }
      if (nombreCambio) body.nombre = nombre.trim()
      if (rolCambio) body.rol = rol

      const res = await fetch(
        `/api/admin/usuarios/${encodeURIComponent(usuario.user_id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? `Error · ${res.status}`)
        return
      }
      toast.success('Usuario actualizado')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card p-6 lg:p-7 mb-6 rise">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display-tight text-xl font-medium">Editar usuario</h2>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost"
          disabled={busy}
        >
          <span className="label-mono">Cancelar</span>
        </button>
      </div>
      <p className="font-mono text-[11px] text-ink-3 mb-5">
        {usuario.email ?? usuario.user_id.slice(0, 8) + '…'}
      </p>

      <div className="space-y-5">
        <div>
          <label htmlFor="nombre-edit" className="label-mono block mb-2">
            Nombre *
          </label>
          <input
            id="nombre-edit"
            type="text"
            autoComplete="off"
            className="field text-[17px]"
            placeholder="Ej. María Pérez"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={busy}
            required
            maxLength={80}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="label-mono">Rol en esta empresa *</span>
            {esYo && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                no podés cambiar tu propio rol
              </span>
            )}
          </div>
          <div className="space-y-2">
            {ROLES_LIST.map((r) => {
              const disabled = busy || (esYo && r !== usuario.rol)
              return (
                <label
                  key={r}
                  className={`flex items-start gap-3 p-3 rounded-md border transition-colors ${
                    rol === r
                      ? 'border-ink bg-paper-2'
                      : 'border-line hover:border-ink-3'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="rol-edit"
                    value={r}
                    checked={rol === r}
                    onChange={() => setRol(r)}
                    disabled={disabled}
                    className="mt-0.5 accent-ink"
                  />
                  <div>
                    <div className="font-medium text-sm">{ROL_LABEL[r]}</div>
                    <div className="font-mono text-[11px] text-ink-3 mt-0.5">
                      {ROL_DESCRIPCION[r]}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        <div className="pt-2">
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
            {!busy && <Save size={16} strokeWidth={2.5} />}
          </button>
          {!hayCambios && !busy && (
            <p className="font-mono text-[11px] text-ink-3 mt-2 text-center">
              Sin cambios todavía · el botón cerrará el formulario.
            </p>
          )}
        </div>
      </div>
    </form>
  )
}
