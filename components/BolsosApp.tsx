"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, type User } from "firebase/auth";
import { fb } from "@/lib/firebase";
import { alertasVenc, buildCopyTextVarios, resumen, type Bolso, type CambioLista } from "@/lib/inventory";
import {
  ADMINS, agregarMiembro, aplicarListaEnOtros, cambiarEquipos, cambiarNombre, aprobar, bolsoStore, cambiarServicio, linkMaps, copiarListaATodos, borrarBolso, cambiarRol, crearBolso, editarBolso, emailDe,
  quitarMiembro, rechazar, subscribeAcceso, subscribeBolsos, subscribeEquipo, subscribeSolicitudes,
  type Acceso, type BolsoInst, type DatosBolso, type Miembro, type Rol, type Solicitud,
} from "@/lib/bolsos";
import InventoryApp from "./InventoryApp";
import { UserChip } from "./Login";
import AlarmasPush from "./AlarmasPush";
import { BARRIOS, EQUIPOS, type EquipoId } from "@/lib/config";
import { disponibilidad, leerHorario, textoDisponibilidad, type Disponibilidad } from "@/lib/horario";

const STALE_DAYS = 30; // a bag nobody has checked in this long gets flagged
type Vista = { k: "lista" } | { k: "bolso"; id: string } | { k: "equipo" };

function leerVista(): Vista {
  if (typeof window === "undefined") return { k: "lista" };
  const h = window.location.hash.replace(/^#/, "");
  if (h === "equipo") return { k: "equipo" };
  if (h.startsWith("b/") && h.length > 2) return { k: "bolso", id: decodeURIComponent(h.slice(2)) };
  return { k: "lista" };
}
function hace(d: Date | null) {
  if (!d) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.floor(h / 24);
  return dd === 1 ? "ayer" : `hace ${dd} días`;
}
const diasDesde = (d: Date | null) => (d ? Math.floor((Date.now() - d.getTime()) / 864e5) : null);

/** Signed-in entry point: waits for the person's place in the team. */
export default function BolsosGate({ user }: { user: User }) {
  const [acceso, setAcceso] = useState<Acceso>({ estado: "cargando" });
  const [error, setError] = useState("");
  useEffect(() => subscribeAcceso(user, setAcceso, (e) => setError(e.message)), [user]);
  const salir = () => signOut(fb().auth);

  if (error) return (
    <div className="login"><div className="login-card">
      <h1>Bolsos</h1>
      <p className="err">No se pudo comprobar tu acceso ({error}).</p>
      <button className="btn" onClick={salir}>Salir</button>
    </div></div>
  );
  if (acceso.estado === "cargando") return <div className="splash">Comprobando tu acceso…</div>;
  if (acceso.estado === "pendiente") return (
    <div className="login"><div className="login-card">
      <h1>Pedido enviado</h1>
      <p>Entraste como <b>{user.email}</b>. La gerencia tiene que aprobarte para ver los bolsos de la institución. Esta pantalla se actualiza sola cuando te aprueben.</p>
      <p className="small-note">¿Buscabas tu bolso personal? Está en <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`}>Mi Bolso</a>.</p>
      <button className="btn" onClick={salir}>Entrar con otra cuenta</button>
    </div></div>
  );
  return <BolsosApp user={user} rol={acceso.rol} />;
}

function BolsosApp({ user, rol }: { user: User; rol: Rol }) {
  const gerencia = rol === "gerencia";
  const [vista, setVista] = useState<Vista>({ k: "lista" });
  const [bolsos, setBolsos] = useState<BolsoInst[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [error, setError] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const toastT = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((m: string) => {
    setToastMsg(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  useEffect(() => {
    setVista(leerVista());
    const on = () => { setVista(leerVista()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => subscribeBolsos(setBolsos, (e) => setError(e.message)), []);
  useEffect(() => (gerencia ? subscribeSolicitudes(setSolicitudes, () => {}) : undefined), [gerencia]);

  const ir = (v: Vista) => { window.location.hash = v.k === "lista" ? "" : v.k === "equipo" ? "equipo" : `b/${encodeURIComponent(v.id)}`; };
  const chip = <UserChip user={user} onSignOut={() => signOut(fb().auth)} />;

  if (error) return <div className="splash" style={{ padding: 16, textAlign: "center" }}>No se pudieron cargar los bolsos ({error}).</div>;
  if (!bolsos) return <div className="splash">Cargando bolsos…</div>;

  if (vista.k === "bolso") {
    const b = bolsos.find((x) => x.id === vista.id);
    if (!b) return (
      <div className="splash" style={{ flexDirection: "column", gap: 12 }}>
        <span>Ese bolso ya no existe.</span><button className="btn" onClick={() => ir({ k: "lista" })}>Ver todos los bolsos</button>
      </div>
    );
    return (
      <>
        <BolsoView key={b.id} b={b} bolsos={bolsos} user={user} gerencia={gerencia} chip={chip} onBack={() => ir({ k: "lista" })} toast={toast} />
        <div className={`toast ${toastMsg ? "show" : ""}`} role="status">{toastMsg}</div>
      </>
    );
  }

  return (
    <>
      {vista.k === "equipo" && gerencia
        ? <Equipo user={user} solicitudes={solicitudes} chip={chip} onBack={() => ir({ k: "lista" })} toast={toast} />
        : <Lista bolsos={bolsos} user={user} gerencia={gerencia} pendientes={solicitudes.length} chip={chip} alarmas={<AlarmasPush user={user} app="bolsos" />}
            onOpen={(id) => ir({ k: "bolso", id })} onEquipo={() => ir({ k: "equipo" })} toast={toast} />}
      <div className={`toast ${toastMsg ? "show" : ""}`} role="status">{toastMsg}</div>
    </>
  );
}

/* ---------- One bag: the same screen as Mi Bolso ---------- */
function BolsoView({ b, bolsos, user, gerencia, chip, onBack, toast }: {
  b: BolsoInst; bolsos: BolsoInst[]; user: User; gerencia: boolean; chip: React.ReactNode; onBack: () => void; toast: (m: string) => void;
}) {
  const store = useMemo(() => bolsoStore(b.id, user), [b.id, user]);
  const datosDe = (x: BolsoInst): DatosBolso => ({ nombre: x.nombre, ubicacion: x.ubicacion, direccion: x.direccion, entrecalles: x.entrecalles, barrio: x.barrio, horario: x.horario });
  const [datos, setDatos] = useState<DatosBolso>(datosDe(b));
  const [borrar, setBorrar] = useState(false);
  const [igualar, setIgualar] = useState(false);
  const otros = bolsos.length - 1;
  // the other bags as they are right now, for replaying list changes
  const bolsosRef = useRef(bolsos);
  bolsosRef.current = bolsos;
  const onListaChange = useCallback((ch: CambioLista) => {
    aplicarListaEnOtros(bolsosRef.current, b.id, ch)
      .then((n) => { if (n) toast(`Lista actualizada en ${n === 1 ? "1 bolso más" : `${n} bolsos más`}`); })
      .catch(() => toast("No se pudo actualizar la lista en los otros bolsos"));
  }, [b.id, toast]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDatos(datosDe(b)); }, [b.nombre, b.ubicacion, b.direccion, b.entrecalles, b.barrio, b.horario]);

  const guardarDatos = (d: DatosBolso = datos) => {
    if (!d.nombre.trim()) { setDatos((x) => ({ ...x, nombre: b.nombre })); return; }
    const antes = datosDe(b);
    if ((Object.keys(d) as (keyof DatosBolso)[]).every((k) => d[k].trim() === antes[k])) return;
    editarBolso(b.id, d).then(() => toast("Datos del bolso guardados")).catch(() => toast("No se pudo guardar"));
  };

  const editExtra = gerencia ? (
    <section className="cat bag-admin">
      <div className="cat-head"><h3>Datos del bolso</h3></div>
      <CamposBolso id="bag" datos={datos} bolsos={bolsos} onChange={setDatos} onCommit={guardarDatos} />
      <div className="equipos-edit">
        <h4>Equipamiento del lugar</h4>
        <p className="small-note">Marcá lo que hay. Se ve con su logo arriba a la derecha de la tarjeta.</p>
        <div className="equipos-opts">
          {EQUIPOS.map((e) => {
            const tiene = b.equipos.includes(e.id);
            return (
              <label key={e.id} className={`equipo-opt ${tiene ? "on" : ""}`}>
                <input type="checkbox" checked={tiene} onChange={() => {
                  const next = EQUIPOS.map((x) => x.id).filter((id) => (id === e.id ? !tiene : b.equipos.includes(id)));
                  cambiarEquipos(b.id, next).then(() => toast(`${e.nombre}: ${tiene ? "no hay" : "hay"}`)).catch(() => toast("No se pudo guardar"));
                }} />
                <img src={`${BASE}/equipos/${e.id}.png`} alt="" width={40} height={40} />
                <span>{e.nombre}</span>
              </label>
            );
          })}
        </div>
      </div>
      {borrar ? (
        <div className="confirm">
          <span>¿Eliminar <b>{b.nombre}</b>? Se borra su inventario y deja de aparecer para todos.</span>
          <div className="acts">
            <button className="btn danger" onClick={() => { borrarBolso(b.id).then(() => toast("Bolso eliminado")).catch(() => toast("No se pudo eliminar")); onBack(); }}>Sí, eliminar</button>
            <button className="btn" onClick={() => setBorrar(false)}>Cancelar</button>
          </div>
        </div>
      ) : <div className="acts"><button className="btn danger" onClick={() => setBorrar(true)}>Eliminar este bolso</button></div>}
      {otros > 0 && (igualar ? (
        <div className="confirm">
          <span>Los otros {otros} bolsos van a quedar con la misma lista que <b>{b.nombre}</b>. Se mantiene lo cargado en los elementos que ya tienen; lo que no esté en esta lista se borra.</span>
          <div className="acts">
            <button className="btn primary" onClick={() => {
              setIgualar(false);
              copiarListaATodos(bolsosRef.current, b).then((n) => toast(`Lista copiada a ${n === 1 ? "1 bolso" : `${n} bolsos`}`)).catch(() => toast("No se pudo copiar la lista"));
            }}>Sí, copiar a todos</button>
            <button className="btn" onClick={() => setIgualar(false)}>Cancelar</button>
          </div>
        </div>
      ) : <div className="acts"><button className="btn" onClick={() => setIgualar(true)}>Copiar esta lista a todos los bolsos</button></div>)}
    </section>
  ) : null;

  return (
    <InventoryApp
      store={store} title={b.nombre} top={chip}
      subtitle={<>
        {b.direccion && <a className="maps" href={linkMaps(b)} target="_blank" rel="noopener noreferrer">📍 {b.direccion}</a>}
        {b.entrecalles && <span className="entrecalles">{b.entrecalles}</span>}
        {[b.ubicacion, b.horario && `Horario: ${b.horario}`].filter(Boolean).join(" · ")}
        <Disponible d={disponibilidad(leerHorario(b.horario))} />
        {b.equipos.length > 0 && <Equipos ids={b.equipos} conNombre />}
      </>}
      back={{ label: "Todos los bolsos", onClick: onBack }}
      canEditList={gerencia} editExtra={editExtra} copyTitle={b.nombre}
      onListaChange={gerencia && otros > 0 ? onListaChange : undefined}
      editNote={otros > 0 ? `Los cambios en la lista (agregar, quitar, renombrar, tipo o mínimo) se aplican también en los otros ${otros === 1 ? "bolso" : `${otros} bolsos`}. Las cantidades y vencimientos de cada bolso no cambian.` : undefined}
      savedText={b.actualizado ? `Revisado ${hace(b.actualizado)}${b.por ? ` por ${b.por}` : ""} · lo ve todo el equipo` : "Lo que cargues lo ve todo el equipo"}
      loadingText="Cargando el bolso…" tabKey="bolsos-tab"
      bandExtra={<>
        <div className={`servicio-fila ${b.fueraDeServicio ? "off" : ""}`}>
          <span>{b.fueraDeServicio
            ? <><b>Fuera de servicio</b> · no contar con este bolso{b.servicioPor ? ` · marcado por ${b.servicioPor}` : ""}{b.servicioDesde ? ` ${hace(b.servicioDesde)}` : ""}</>
            : "Disponible para emergencias"}</span>
          <ServicioBoton b={b} user={user} toast={toast} grande />
        </div>
        <AlarmasPush user={user} app="bolsos" />
      </>}
    />
  );
}

/* ---------- List of bags = state of every bag ---------- */
function Lista({ bolsos, user, gerencia, pendientes, chip, alarmas, onOpen, onEquipo, toast }: {
  bolsos: BolsoInst[]; user: User; gerencia: boolean; pendientes: number; chip: React.ReactNode; alarmas: React.ReactNode;
  onOpen: (id: string) => void; onEquipo: () => void; toast: (m: string) => void;
}) {
  const [nuevo, setNuevo] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  // the clock: availability is recomputed every 30 s
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 30_000); return () => clearInterval(t); }, []);
  const base = useMemo(() => bolsos.map((b) => ({ b, r: resumen(b.bolso), av: alertasVenc(b.bolso), h: leerHorario(b.horario) })), [bolsos]);
  const datos: Dato[] = useMemo(() => base.map(({ h, ...x }) => ({ ...x, disp: disponibilidad(h, ahora) })), [base, ahora]);
  const barrioDe = (x: Dato) => x.b.barrio.trim() || "Sin barrio";
  const rank = (k: string) => { const i = BARRIOS.findIndex((x) => x.toLowerCase() === k.toLowerCase()); return k === "Sin barrio" ? 1e4 : i < 0 ? 1e3 : i; };
  const todosLosBarrios = useMemo(() => [...new Set(datos.map(barrioDe))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "es")), [datos]);

  // view settings, remembered on each phone
  const [cols, setCols] = useState<1 | 2 | 4>(1);
  const [barrio, setBarrio] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    try {
      const c = localStorage.getItem("bolsos-columnas"); if (c === "2" || c === "4") setCols(Number(c) as 2 | 4);
      const b = localStorage.getItem("bolsos-barrio"); if (b) setBarrio(b);
    } catch {}
  }, []);
  const elegirCols = (n: 1 | 2 | 4) => { setCols(n); try { localStorage.setItem("bolsos-columnas", String(n)); } catch {} };
  const elegirBarrio = (b: string) => { setBarrio(b); try { localStorage.setItem("bolsos-barrio", b); } catch {} };
  const barrioActivo = barrio && todosLosBarrios.includes(barrio) ? barrio : "";

  // filter: neighborhood chip + search box (neighborhood, name or address; "11" finds Once)
  const visibles = useMemo(() => {
    const t = normalizar(q).replace(/^barrio\s+/, "");
    const claves = t ? [t, ...(SINONIMOS[t] ?? [])] : [];
    return datos.filter((x) => {
      if (barrioActivo && barrioDe(x) !== barrioActivo) return false;
      if (!claves.length) return true;
      const texto = normalizar([x.b.barrio, x.b.nombre, x.b.direccion, x.b.ubicacion].join(" "));
      return claves.some((k) => texto.includes(k));
    });
  }, [datos, barrioActivo, q]);

  // out of service or incomplete → on top, once (taken out of their neighborhood)
  const cerradoAhora = (x: Dato) => !x.b.fueraDeServicio && x.disp.estado === "cerrado";
  const necesitaAtencion = (x: Dato) => x.b.fueraDeServicio || (!cerradoAhora(x) && x.r.cargados > 0 && x.r.faltan > 0);
  const cerrados = useMemo(() => visibles.filter(cerradoAhora)
    .sort((a, b) => rank(barrioDe(a)) - rank(barrioDe(b)) || a.b.nombre.localeCompare(b.b.nombre, "es")), [visibles]);
  const atencion = useMemo(() => visibles.filter(necesitaAtencion)
    .sort((a, b) => Number(b.b.fueraDeServicio) - Number(a.b.fueraDeServicio) || b.r.faltan - a.r.faltan || a.b.nombre.localeCompare(b.b.nombre, "es")), [visibles]);
  // grouped by neighborhood, in the spreadsheet's order; unknown ones after, bags without one last
  const grupos = useMemo(() => {
    const m = new Map<string, Dato[]>();
    for (const x of visibles) { if (necesitaAtencion(x) || cerradoAhora(x)) continue; const k = barrioDe(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }
    return [...m.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "es")).map(([barrio, items]) => ({ barrio, items }));
  }, [visibles]);
  const filtrando = !!barrioActivo || !!q.trim();
  const claseCols = cols === 4 ? "cuatro" : cols === 2 ? "dos" : "";
  const card = (x: Dato, conBarrio = false) => <BagCard key={x.b.id} x={x} user={user} toast={toast} onOpen={onOpen} conBarrio={conBarrio} />;
  const activos = datos.filter((x) => !x.b.fueraDeServicio);
  const fueraN = datos.length - activos.length;
  const conFaltantes = activos.filter((x) => x.r.cargados && x.r.faltan).length;
  const sinCargar = activos.filter((x) => !x.r.cargados).length;
  // "complete" only when every item was checked and nothing is missing
  const ok = activos.filter((x) => x.r.cargados === x.r.total && !x.r.faltan && !x.r.leves.length).length;

  async function copiar() {
    const txt = buildCopyTextVarios(bolsos.map((b) => ({ nombre: b.nombre, ubicacion: b.ubicacion, bolso: b.bolso, fueraDeServicio: b.fueraDeServicio })));
    try { await navigator.clipboard.writeText(txt); setCopyFallback(""); toast("Lista copiada"); }
    catch { setCopyFallback(txt); toast("Seleccioná y copiá el texto"); }
  }

  return (
    <div className="wrap ancho">
      <header className="band">
        <div className="band-top">
          <div className="titles"><h1>Bolsos</h1><span className="subtitle">{gerencia ? "Gerencia · estado de todos los bolsos" : "Bolsos de la institución"}</span></div>
          {chip}
        </div>
        <div className={`meter ${fueraN ? "cuatro" : ""}`}>
          <div className="tile bad"><b className="num">{conFaltantes}</b><span>Faltan vitales</span></div>
          <div className="tile ok"><b className="num">{ok}</b><span>Completos</span></div>
          <div className="tile"><b className="num">{sinCargar}</b><span>Sin cargar</span></div>
          {fueraN > 0 && <div className="tile fuera"><b className="num">{fueraN}</b><span>Fuera de servicio</span></div>}
        </div>
        {alarmas}
      </header>

      {gerencia && (
        <div className="toolbar">
          <button className="btn primary" onClick={() => setNuevo(!nuevo)}>{nuevo ? "Cancelar" : "Agregar bolso"}</button>
          <button className="btn" onClick={onEquipo}>Equipo{pendientes > 0 && <span className="cnt">{pendientes}</span>}</button>
          <button className="btn" onClick={copiar} disabled={!bolsos.length}>Copiar lista para reponer</button>
        </div>
      )}
      {gerencia && pendientes > 0 && (
        <button className="notice notice-btn" onClick={onEquipo}>
          {pendientes === 1 ? "1 persona pide acceso" : `${pendientes} personas piden acceso`} a los bolsos. Tocá para aprobar.
        </button>
      )}
      {copyFallback && <textarea className="copy-fallback" readOnly value={copyFallback} onFocus={(e) => e.target.select()} />}
      {nuevo && <NuevoBolso bolsos={bolsos} onDone={(id) => { setNuevo(false); toast("Bolso creado"); onOpen(id); }} toast={toast} />}

      {!bolsos.length && !nuevo && (
        <p className="none" style={{ marginTop: 16 }}>
          {gerencia ? "Todavía no hay bolsos. Tocá “Agregar bolso” para cargar el primero (por ejemplo, el de la sede o el de un vehículo)." : "Todavía no hay bolsos cargados. La gerencia los agrega desde su cuenta."}
        </p>
      )}

      {bolsos.length > 1 && (<>
        <div className="filtros">
          <div className="buscar">
            <input type="search" id="bolsos-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar barrio, bolso o dirección" aria-label="Buscar barrio, bolso o dirección" />
          </div>
          <div className="chips" role="group" aria-label="Filtrar por barrio">
            <button className="chip" aria-pressed={!barrioActivo} onClick={() => elegirBarrio("")}>Todos</button>
            {todosLosBarrios.map((b) => <button key={b} className="chip" aria-pressed={barrioActivo === b} onClick={() => elegirBarrio(barrioActivo === b ? "" : b)}>{b}</button>)}
          </div>
        </div>
        <div className="toolbar vista">
          <span className="vista-label">
            {filtrando ? `${visibles.length} de ${bolsos.length} bolsos` : todosLosBarrios.length > 1 ? `${bolsos.length} bolsos en ${todosLosBarrios.length} barrios` : `${bolsos.length} bolsos`}
            {filtrando && <> · <button className="link-btn" onClick={() => { setQ(""); elegirBarrio(""); }}>ver todos</button></>}
          </span>
          <div className="seg-filter" role="group" aria-label="Bolsos por fila">
            <button aria-pressed={cols === 1} onClick={() => elegirCols(1)} aria-label="1 por fila">1</button>
            <button aria-pressed={cols === 2} onClick={() => elegirCols(2)} aria-label="2 por fila">2</button>
            <button aria-pressed={cols === 4} onClick={() => elegirCols(4)} aria-label="4 por fila">4</button>
            <span className="seg-label" aria-hidden="true">por fila</span>
          </div>
        </div>
      </>)}

      {filtrando && !visibles.length && <p className="none" style={{ marginTop: 16 }}>No hay bolsos que coincidan con la búsqueda.</p>}

      {atencion.length > 0 && (
        <section className="barrio atencion">
          <h2 className="barrio-head"><span>Atención</span><span className="barrio-n">{atencion.length}</span></h2>
          <p className="atencion-nota">Fuera de servicio o con faltantes vitales (en rojo)</p>
          <ul className={`bags ${claseCols}`}>{atencion.map((x) => card(x, true))}</ul>
        </section>
      )}

      {grupos.map((g) => (
        <section className="barrio" key={g.barrio}>
          {(grupos.length > 1 || atencion.length > 0 || cerrados.length > 0) && <h2 className="barrio-head"><span>{g.barrio}</span><span className="barrio-n">{g.items.length}</span></h2>}
          <ul className={`bags ${claseCols}`}>{g.items.map((x) => card(x))}</ul>
        </section>
      ))}

      {cerrados.length > 0 && (
        <section className="barrio cerrados">
          <h2 className="barrio-head"><span>No disponibles en este horario</span><span className="barrio-n">{cerrados.length}</span></h2>
          <p className="atencion-nota">Según el horario de cada lugar. Vuelven solos arriba cuando abren.</p>
          <ul className={`bags ${claseCols}`}>{cerrados.map((x) => card(x, true))}</ul>
        </section>
      )}
    </div>
  );
}

function NuevoBolso({ bolsos, onDone, toast }: { bolsos: BolsoInst[]; onDone: (id: string) => void; toast: (m: string) => void }) {
  const [datos, setDatos] = useState<DatosBolso>({ nombre: "", ubicacion: "", direccion: "", entrecalles: "", barrio: "", horario: "" });
  // new bags start with the list the other bags use (most recently checked bag)
  const ultimo = [...bolsos].sort((a, b) => (b.actualizado?.getTime() ?? 0) - (a.actualizado?.getTime() ?? 0))[0];
  const [base, setBase] = useState(ultimo?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form className="summary clear new-bag" onSubmit={async (e) => {
      e.preventDefault(); if (!datos.nombre.trim()) return;
      setBusy(true);
      try {
        const copia: Bolso | undefined = bolsos.find((x) => x.id === base)?.bolso;
        onDone(await crearBolso(datos, copia));
      } catch { toast("No se pudo crear el bolso"); } finally { setBusy(false); }
    }}>
      <h2>Nuevo bolso</h2>
      <CamposBolso id="nb" datos={datos} bolsos={bolsos} onChange={setDatos} />
      <div className="form-grid">
        <label htmlFor="nb-base">Lista de elementos
          <select id="nb-base" value={base} onChange={(e) => setBase(e.target.value)}>
            {bolsos.map((b) => <option key={b.id} value={b.id}>La misma lista que {b.nombre}</option>)}
            <option value="">Lista estándar de Mi Bolso</option>
          </select>
        </label>
      </div>
      <div className="acts"><button className="btn primary" disabled={busy || !datos.nombre.trim()}>{busy ? "Creando…" : "Crear bolso"}</button></div>
    </form>
  );
}

type Dato = { b: BolsoInst; r: ReturnType<typeof resumen>; av: ReturnType<typeof alertasVenc>; disp: Disponibilidad };
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** What people type for a neighborhood (speech-to-text writes "Once" as "11"). */
const SINONIMOS: Record<string, string[]> = { "11": ["once"], "once": ["11"], "v crespo": ["villa crespo"], "chaca": ["chacarita"] };

/** One bag in the list. In 4-per-row mode the CSS shows only name, status and the service dot. */
function BagCard({ x, user, toast, onOpen, conBarrio }: { x: Dato; user: User; toast: (m: string) => void; onOpen: (id: string) => void; conBarrio?: boolean }) {
  const { b, r, av, disp } = x;
  const cerrado = !b.fueraDeServicio && disp.estado === "cerrado";
  const dias = diasDesde(b.actualizado);
  const viejo = r.cargados > 0 && dias !== null && dias >= STALE_DAYS;
  const parcial = r.cargados > 0 && r.cargados < r.total;
  const fuera = b.fueraDeServicio;
  const estado = fuera ? "fuera" : !r.cargados ? "none" : r.faltan ? "bad" : r.leves.length || r.atencion || parcial ? "warn" : "ok";
  const nl = r.leves.length;
  const vencidos = av.filter((a) => a.dias < 0).length, porVencer = av.length - vencidos;
  const T = ({ largo, corto }: { largo: string; corto: string }) => <><span className="t-largo">{largo}</span><span className="t-corto">{corto}</span></>;
  return (
    <li>
      {/* the whole card opens the bag (stretched button); the service switch sits on top of it */}
      <div className={`bag ${estado} ${cerrado ? "cerrado" : ""}`}>
        <span className="bag-main">
          {conBarrio && b.barrio && <span className="bag-barrio">{b.barrio}</span>}
          <span className="bag-top">
            <button className="bag-open bag-name" onClick={() => onOpen(b.id)}>{b.nombre}</button>
            <span className="bag-side">
              {b.equipos.length > 0 && <Equipos ids={b.equipos} />}
              <ServicioBoton b={b} user={user} toast={toast} />
              {b.horario && <span className="bag-horario">{b.horario}</span>}
            </span>
          </span>
          {cerrado && <span className="bag-cerrado"><b>No disponible en este horario</b>{textoDisponibilidad(disp) && <> · {textoDisponibilidad(disp)}</>}</span>}
          {!cerrado && !b.fueraDeServicio && <Disponible d={disp} />}
          {b.direccion && <a className="maps bag-where" href={linkMaps(b)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>📍 {b.direccion}</a>}
          {b.entrecalles && <span className="entrecalles">{b.entrecalles}</span>}
          {b.ubicacion && <span className="bag-where">{b.ubicacion}</span>}
          {/* big, readable status: what a dispatcher needs in an emergency */}
          {fuera && (<>
            <span className="bag-estado fuera"><span className="bag-estado-icon" aria-hidden="true">⛔</span><T largo="Fuera de servicio" corto="Fuera" /></span>
            <span className="bag-when">No contar con este bolso{b.servicioDesde ? ` · desde ${hace(b.servicioDesde)}` : ""}{b.servicioPor ? ` · marcado por ${b.servicioPor}` : ""}</span>
          </>)}
          {!fuera && <>
            {!r.cargados && <span className="bag-estado none">Sin cargar</span>}
            {r.cargados > 0 && r.faltan > 0 && (
              <span className="bag-estado bad"><span className="bag-estado-icon" aria-hidden="true">✕</span>
                <T largo={r.faltan === 1 ? "Falta 1 vital" : `Faltan ${r.faltan} vitales`} corto={`Faltan ${r.faltan}`} /></span>
            )}
            {r.cargados > 0 && !r.faltan && nl > 0 && (
              <span className="bag-estado warn"><span className="bag-estado-icon" aria-hidden="true">!</span>
                <T largo={nl === 1 ? "Falta 1 no vital" : `Faltan ${nl} no vitales`} corto={`Faltan ${nl}`} /></span>
            )}
            {r.cargados > 0 && !r.faltan && !nl && !parcial && <span className="bag-estado ok"><span className="bag-estado-icon" aria-hidden="true">✓</span>Completo</span>}
            {!r.faltan && !nl && parcial && <span className="bag-estado warn"><span className="bag-estado-icon" aria-hidden="true">!</span>
              <T largo={`Revisado ${r.cargados} de ${r.total}`} corto={`${r.cargados}/${r.total}`} /></span>}
            {r.faltan > 0 && (
              <ul className="bag-miss">
                {r.bad.slice(0, 6).map((y) => <li key={y.it.id}><span>{y.it.nombre}</span><span className="bag-miss-motivo">{y.st.motivo}</span></li>)}
                {r.faltan > 6 && <li className="mas">y {r.faltan - 6} más</li>}
              </ul>
            )}
            {nl > 0 && (
              <ul className="bag-miss leve">
                {r.faltan > 0 && <li className="leve-head">{nl === 1 ? "Falta 1 no vital" : `Faltan ${nl} no vitales`}</li>}
                {r.leves.slice(0, 6).map((y) => <li key={y.it.id}><span>{y.it.nombre}</span><span className="bag-miss-motivo">{y.st.motivo}</span></li>)}
                {nl > 6 && <li className="mas">y {nl - 6} más</li>}
              </ul>
            )}
            <span className="bag-pills">
              {vencidos > 0 && <span className="pill bad">{vencidos} vencido{vencidos > 1 ? "s" : ""}</span>}
              {porVencer > 0 && <span className="pill warn">{porVencer} por vencer</span>}
              {r.atencion > 0 && <span className="pill warn">{r.atencion} atención</span>}
              {(r.faltan > 0 || nl > 0) && parcial && <span className="pill warn">Revisado {r.cargados} de {r.total}</span>}
              {viejo && <span className="pill warn">Sin revisar hace {dias} días</span>}
            </span>
            <span className="bag-when">{b.actualizado ? `Revisado ${hace(b.actualizado)}${b.por ? ` por ${b.por}` : ""}` : "Nadie lo revisó todavía"}</span>
          </>}
        </span>
        <span className="chev" aria-hidden="true">›</span>
      </div>
    </li>
  );
}

/** Small "available now · until 22:00" line; nothing when the schedule is unknown. */
function Disponible({ d }: { d: Disponibilidad }) {
  if (d.estado === "desconocido") return null;
  return <span className={`disp ${d.estado}`}><span className="disp-dot" aria-hidden="true" />{d.estado === "cerrado" ? `No disponible en este horario · ${textoDisponibilidad(d)}` : textoDisponibilidad(d)}</span>;
}

/** "En servicio" (green) ⇄ "Fuera de servicio" (red). Any team member can switch it; it is logged. */
function ServicioBoton({ b, user, toast, grande }: { b: BolsoInst; user: User; toast: (m: string) => void; grande?: boolean }) {
  const [busy, setBusy] = useState(false);
  const fuera = b.fueraDeServicio;
  return (
    <button
      className={`servicio ${fuera ? "off" : "on"} ${grande ? "grande" : ""}`} aria-pressed={!fuera} disabled={busy}
      aria-label={`${b.nombre}: ${fuera ? "fuera de servicio. Tocá para ponerlo en servicio" : "en servicio. Tocá para marcarlo fuera de servicio"}`}
      onClick={async (e) => {
        e.stopPropagation(); setBusy(true);
        try { await cambiarServicio(b.id, !fuera, user); toast(`${b.nombre}: ${fuera ? "en servicio" : "fuera de servicio"}`); }
        catch { toast("No se pudo cambiar. Revisá la conexión."); }
        finally { setBusy(false); }
      }}
    >
      <span className="servicio-dot" aria-hidden="true" /><span className="servicio-txt">{fuera ? "Fuera de servicio" : "En servicio"}</span>
    </button>
  );
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** The logos of the extra equipment a place has (DEA, silla, tabla, chaleco, bolso REM). */
function Equipos({ ids, conNombre }: { ids: EquipoId[]; conNombre?: boolean }) {
  return (
    <span className={`equipos ${conNombre ? "con-nombre" : ""}`} aria-label={`Equipamiento: ${ids.map((id) => EQUIPOS.find((e) => e.id === id)!.nombre).join(", ")}`}>
      {EQUIPOS.filter((e) => ids.includes(e.id)).map((e) => (
        <span key={e.id} className="equipo" title={e.nombre}>
          <img src={`${BASE}/equipos/${e.id}.png`} alt={e.nombre} width={34} height={34} />
          {conNombre && <span>{e.nombre}</span>}
        </span>
      ))}
    </span>
  );
}

/** Name, neighborhood, address, place inside the building and opening hours of a bag. */
function CamposBolso({ id, datos, bolsos, onChange, onCommit }: {
  id: string; datos: DatosBolso; bolsos: BolsoInst[]; onChange: (d: DatosBolso) => void; onCommit?: (d: DatosBolso) => void;
}) {
  const set = (k: keyof DatosBolso) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...datos, [k]: e.target.value });
  const barrios = [...new Set([...BARRIOS, ...bolsos.map((b) => b.barrio).filter(Boolean)])];
  const blur = () => onCommit?.(datos);
  return (
    <div className="form-grid">
      <label htmlFor={`${id}-nombre`}>Nombre<input id={`${id}-nombre`} required value={datos.nombre} placeholder="Ej.: Beit Jabad Central" onChange={set("nombre")} onBlur={blur} /></label>
      <label htmlFor={`${id}-barrio`}>Barrio
        <input id={`${id}-barrio`} list={`${id}-barrios`} value={datos.barrio} placeholder="Elegí o escribí uno" onChange={set("barrio")} onBlur={blur} />
        <datalist id={`${id}-barrios`}>{barrios.map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <label htmlFor={`${id}-dir`}>Dirección<input id={`${id}-dir`} value={datos.direccion} placeholder="Ej.: Agüero 1164" onChange={set("direccion")} onBlur={blur} /></label>
      <label htmlFor={`${id}-entre`}>Entrecalles<input id={`${id}-entre`} value={datos.entrecalles} placeholder="Ej.: entre Av. Córdoba y Paraguay" onChange={set("entrecalles")} onBlur={blur} /></label>
      <label htmlFor={`${id}-ubic`}>Dónde está adentro<input id={`${id}-ubic`} value={datos.ubicacion} placeholder="Ej.: Recepción, planta baja" onChange={set("ubicacion")} onBlur={blur} /></label>
      <label htmlFor={`${id}-horario`}>Horario<input id={`${id}-horario`} value={datos.horario} placeholder="Ej.: L a V de 9 a 17 · 24 hs" onChange={set("horario")} onBlur={blur} /></label>
    </div>
  );
}

/* ---------- Team: who can use the shared bags ---------- */
function Equipo({ user, solicitudes, chip, onBack, toast }: {
  user: User; solicitudes: Solicitud[]; chip: React.ReactNode; onBack: () => void; toast: (m: string) => void;
}) {
  const [miembros, setMiembros] = useState<Miembro[] | null>(null);
  const [email, setEmail] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [rolNuevo, setRolNuevo] = useState<Rol>("voluntario");
  const [quitar, setQuitar] = useState<string | null>(null);
  const [linkFallback, setLinkFallback] = useState(false);
  useEffect(() => subscribeEquipo(setMiembros, () => setMiembros([])), []);
  const link = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
  const yo = emailDe(user);
  const err = () => toast("No se pudo guardar. Revisá la conexión.");
  const nombreDeEquipo = (e: string) => miembros?.find((m) => m.email === e)?.nombre ?? "";
  /** Name field: saves when leaving it or pressing Enter. */
  const campoNombre = (e: string, actual: string, pista = "") => (
    <input className="nombre-edit" type="text" defaultValue={actual} key={`${e}-${actual}`} placeholder={pista || "Escribí su nombre"} aria-label={`Nombre de ${e}`}
      onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
      onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== actual) cambiarNombre(e, v).then(() => toast(v ? `Nombre guardado: ${v}` : "Nombre borrado")).catch(err); }} />
  );

  return (
    <div className="wrap">
      <header className="band">
        <button className="backlink" onClick={onBack}>‹ Todos los bolsos</button>
        <div className="band-top"><div className="titles"><h1>Equipo</h1><span className="subtitle">Quién puede usar los bolsos</span></div>{chip}</div>
      </header>

      <section className="summary clear">
        <h2>Invitar</h2>
        <p className="empty-note">Mandá este link. Cada persona entra con su cuenta de Google y te aparece abajo para aprobarla.</p>
        <div className="share-row">
          <input readOnly value={link} aria-label="Link de la app" onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); toast("Link copiado"); } catch { setLinkFallback(true); } }}>Copiar link</button>
        </div>
        {linkFallback && <p className="empty-note">Seleccioná el link y copialo.</p>}
      </section>

      <section className="cat">
        <div className="cat-head"><h3>Piden acceso</h3><span className="num">{solicitudes.length}</span></div>
        {!solicitudes.length && <p className="none">Nadie está esperando aprobación.</p>}
        <ul className="rows">
          {solicitudes.map((s) => (
            <li className="row" key={s.email}>
              <div className="name"><span>{s.nombre || s.email}</span><span className="sub"><span className="of">{s.email}</span></span></div>
              <div className="opts">
                <button className="btn primary" onClick={() => aprobar(s, "voluntario", user).then(() => toast(`${s.nombre || s.email} ya tiene acceso`)).catch(err)}>Aprobar</button>
                <button className="btn" onClick={() => aprobar(s, "gerencia", user).then(() => toast(`${s.nombre || s.email} es gerencia`)).catch(err)}>Como gerencia</button>
                <button className="btn danger" onClick={() => rechazar(s.email).then(() => toast("Pedido rechazado")).catch(err)}>Rechazar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="cat">
        <div className="cat-head"><h3>Con acceso</h3><span className="num">{miembros ? miembros.filter((m) => !ADMINS.includes(m.email)).length + ADMINS.length : ""}</span></div>
        <ul className="rows">
          {ADMINS.map((a) => (
            <li className="row" key={a}>
              <div className="name">{campoNombre(a, nombreDeEquipo(a), a === yo ? user.displayName ?? "" : "")}<span className="sub"><span className="of">{a}{a === yo ? " · vos" : ""}</span></span></div>
              <span className="pill info">Administrador</span>
            </li>
          ))}
          {miembros?.filter((m) => !ADMINS.includes(m.email)).map((m) => (
            <li className="row" key={m.email}>
              <div className="name">{campoNombre(m.email, m.nombre)}<span className="sub"><span className="of">{m.email}</span></span></div>
              <div className="opts">
                <select aria-label={`Rol de ${m.email}`} value={m.rol} onChange={(e) => cambiarRol(m.email, e.target.value as Rol).then(() => toast("Rol actualizado")).catch(err)}>
                  <option value="voluntario">Voluntario</option>
                  <option value="gerencia">Gerencia</option>
                </select>
                {quitar === m.email
                  ? <><button className="btn danger" onClick={() => { quitarMiembro(m.email).then(() => toast("Acceso quitado")).catch(err); setQuitar(null); }}>Confirmar</button><button className="btn" onClick={() => setQuitar(null)}>No</button></>
                  : <button className="btn danger" onClick={() => setQuitar(m.email)}>Quitar</button>}
              </div>
            </li>
          ))}
        </ul>
        <p className="empty-note small-note"><b>Voluntario:</b> ve todos los bolsos, registra usos y reposiciones. <b>Gerencia:</b> además agrega o elimina bolsos, edita las listas y maneja el equipo.</p>
      </section>

      <form className="cat" onSubmit={(e) => {
        e.preventDefault();
        const v = email.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast("Escribí un email válido");
        agregarMiembro(v, rolNuevo, user, nombreNuevo).then(() => { toast(`${nombreNuevo.trim() || v} ya tiene acceso`); setEmail(""); setNombreNuevo(""); }).catch(err);
      }}>
        <div className="cat-head"><h3>Agregar por email</h3></div>
        <p className="empty-note small-note">Si ya sabés el Gmail de la persona, dale acceso directo sin esperar el pedido.</p>
        <div className="share-row">
          <input type="text" id="eq-nombre" placeholder="Nombre y apellido" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} aria-label="Nombre" />
          <input type="email" id="eq-email" placeholder="nombre@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <select id="eq-rol" value={rolNuevo} onChange={(e) => setRolNuevo(e.target.value as Rol)} aria-label="Rol">
            <option value="voluntario">Voluntario</option>
            <option value="gerencia">Gerencia</option>
          </select>
          <button className="btn primary">Agregar</button>
        </div>
      </form>
    </div>
  );
}
