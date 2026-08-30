/**
 * Skeleton de /e/[slug] mientras el Server Component resuelve el evento.
 *
 * Antes no había ningún `loading.tsx` acá (ver P2/P7 del diagnóstico): con las
 * ~7 consultas de `loadEventoPublico` en serie con la latencia normal de
 * Supabase, quien abría el link se quedaba mirando una pantalla en blanco.
 * Mismo layout y anchos que la página real (ver `page.tsx`) para que no haya
 * salto de tamaño cuando el contenido de verdad reemplaza al esqueleto.
 */
export default function Loading() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-xl px-6 py-12 sm:py-16">
        <header className="rise mb-10 animate-pulse">
          <div className="h-3 w-20 rounded bg-paper-3" />
          <div className="h-10 w-5/6 rounded-lg bg-paper-3 mt-4" />
          <div className="h-10 w-1/2 rounded-lg bg-paper-3 mt-2" />
          <div className="space-y-2 mt-5">
            <div className="h-3.5 w-44 rounded bg-paper-3" />
            <div className="h-3.5 w-32 rounded bg-paper-3" />
          </div>
          <div className="perforated mt-8" />
        </header>

        <div className="rise space-y-6 animate-pulse">
          <div className="h-3 w-28 rounded bg-paper-3" />
          <div className="flex items-end gap-3">
            <div className="h-11 flex-1 rounded-xl bg-paper-3" />
            <div className="h-11 w-28 shrink-0 rounded-xl bg-paper-3" />
          </div>
          <div className="h-24 w-full rounded-xl bg-paper-3" />
          <div className="h-24 w-full rounded-xl bg-paper-3" />
        </div>
      </div>
    </main>
  )
}
