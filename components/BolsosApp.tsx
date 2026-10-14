"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, type User } from "firebase/auth";
import { fb } from "@/lib/firebase";
import { alertasVenc, buildCopyTextVarios, resumen, type Bolso } from "@/lib/inventory";
import {
  ADMINS, agregarMiembro, aprobar, bolsoStore, borrarBolso, cambiarRol, crearBolso, editarBolso, emailDe,
  quitarMiembro, rechazar, subscribeAcceso, subscribeBolsos, subscribeEquipo, subscribeSolicitudes,
  type Acceso, type BolsoInst, type Miembro, type Rol, type Solicitud,
} from "@/lib/bolsos";
import InventoryApp from "./InventoryApp";
import { UserChip } from "./Login";
import AlarmasPush from "./AlarmasPush";

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
    return <BolsoView key={b.id} b={b} user={user} gerencia={gerencia} chip={chip} onBack={() => ir({ k: "lista" })} toast={toast} />;
  }

  return (
    <>
      {vista.k === "equipo" && gerencia
        ? <Equipo user={user} solicitudes={solicitudes} chip={chip} onBack={() => ir({ k: "lista" })} toast={toast} />
        : <Lista bolsos={bolsos} gerencia={gerencia} pendientes={solicitudes.length} chip={chip} alarmas={<AlarmasPush user={user} app="bolsos" />}
            onOpen={(id) => ir({ k: "bolso", id })} onEquipo={() => ir({ k: "equipo" })} toast={toast} />}
      <div className={`toast ${toastMsg ? "show" : ""}`} role="status">{toastMsg}</div>
    </>
  );
}

/* ---------- One bag: the same screen as Mi Bolso ---------- */
function BolsoView({ b, user, gerencia, chip, onBack, toast }: {
  b: BolsoInst; user: User; gerencia: boolean; chip: React.ReactNode; onBack: () => void; toast: (m: string) => void;
}) {
  const store = useMemo(() => bolsoStore(b.id, user), [b.id, user]);
  const [nombre, setNombre] = useState(b.nombre);
  const [ubic, setUbic] = useState(b.ubicacion);
  const [borrar, setBorrar] = useState(false);
  useEffect(() => { setNombre(b.nombre); setUbic(b.ubicacion); }, [b.nombre, b.ubicacion]);

  const guardarDatos = () => {
    if (!nombre.trim()) { setNombre(b.nombre); return; }
    if (nombre.trim() === b.nombre && ubic.trim() === b.ubicacion) return;
    editarBolso(b.id, { nombre, ubicacion: ubic }).then(() => toast("Datos del bolso guardados")).catch(() => toast("No se pudo guardar"));
  };

  const editExtra = gerencia ? (
    <section className="cat bag-admin">
      <div className="cat-head"><h3>Datos del bolso</h3></div>
      <div className="form-grid">
        <label htmlFor="bag-nombre">Nombre<input id="bag-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={guardarDatos} /></label>
        <label htmlFor="bag-ubic">Ubicación<input id="bag-ubic" value={ubic} placeholder="Dónde está guardado" onChange={(e) => setUbic(e.target.value)} onBlur={guardarDatos} /></label>
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
    </section>
  ) : null;

  return (
    <InventoryApp
      store={store} title={b.nombre} subtitle={b.ubicacion} top={chip}
      back={{ label: "Todos los bolsos", onClick: onBack }}
      canEditList={gerencia} editExtra={editExtra} copyTitle={b.nombre}
      savedText={b.actualizado ? `Revisado ${hace(b.actualizado)}${b.por ? ` por ${b.por}` : ""} · lo ve todo el equipo` : "Lo que cargues lo ve todo el equipo"}
      loadingText="Cargando el bolso…" tabKey="bolsos-tab" bandExtra={<AlarmasPush user={user} app="bolsos" />}
    />
  );
}

/* ---------- List of bags = state of every bag ---------- */
function Lista({ bolsos, gerencia, pendientes, chip, alarmas, onOpen, onEquipo, toast }: {
  bolsos: BolsoInst[]; gerencia: boolean; pendientes: number; chip: React.ReactNode; alarmas: React.ReactNode;
  onOpen: (id: string) => void; onEquipo: () => void; toast: (m: string) => void;
}) {
  const [nuevo, setNuevo] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const datos = useMemo(() => bolsos.map((b) => ({ b, r: resumen(b.bolso), av: alertasVenc(b.bolso) })), [bolsos]);
  const conFaltantes = datos.filter((x) => x.r.cargados && x.r.faltan).length;
  const sinCargar = datos.filter((x) => !x.r.cargados).length;
  const ok = datos.filter((x) => x.r.cargados && !x.r.faltan).length;

  async function copiar() {
    const txt = buildCopyTextVarios(bolsos.map((b) => ({ nombre: b.nombre, ubicacion: b.ubicacion, bolso: b.bolso })));
    try { await navigator.clipboard.writeText(txt); setCopyFallback(""); toast("Lista copiada"); }
    catch { setCopyFallback(txt); toast("Seleccioná y copiá el texto"); }
  }

  return (
    <div className="wrap">
      <header className="band">
        <div className="band-top">
          <div className="titles"><h1>Bolsos</h1><span className="subtitle">{gerencia ? "Gerencia · estado de todos los bolsos" : "Bolsos de la institución"}</span></div>
          {chip}
        </div>
        <div className="meter">
          <div className="tile bad"><b className="num">{conFaltantes}</b><span>Con faltantes</span></div>
          <div className="tile ok"><b className="num">{ok}</b><span>Completos</span></div>
          <div className="tile"><b className="num">{sinCargar}</b><span>Sin cargar</span></div>
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

      <ul className="bags">
        {datos.map(({ b, r, av }) => {
          const dias = diasDesde(b.actualizado);
          const viejo = r.cargados > 0 && dias !== null && dias >= STALE_DAYS;
          const estado = !r.cargados ? "none" : r.faltan ? "bad" : r.atencion ? "warn" : "ok";
          return (
            <li key={b.id}>
              <button className={`bag ${estado}`} onClick={() => onOpen(b.id)}>
                <span className="bag-main">
                  <span className="bag-name">{b.nombre}</span>
                  {b.ubicacion && <span className="bag-where">{b.ubicacion}</span>}
                  <span className="bag-pills">
                    {!r.cargados && <span className="pill none">Sin cargar</span>}
                    {r.cargados > 0 && r.faltan > 0 && <span className="pill bad">{r.faltan === 1 ? "1 faltante" : `${r.faltan} faltantes`}</span>}
                    {r.cargados > 0 && !r.faltan && <span className="pill ok">Completo</span>}
                    {av.some((a) => a.dias < 0) && <span className="pill bad">{av.filter((a) => a.dias < 0).length} vencido{av.filter((a) => a.dias < 0).length > 1 ? "s" : ""}</span>}
                    {av.some((a) => a.dias >= 0) && <span className="pill warn">{av.filter((a) => a.dias >= 0).length} por vencer</span>}
                    {r.atencion > 0 && <span className="pill warn">{r.atencion} atención</span>}
                    {r.cargados > 0 && r.cargados < r.total && <span className="pill info">{r.cargados}/{r.total} cargados</span>}
                    {viejo && <span className="pill warn">Sin revisar hace {dias} días</span>}
                  </span>
                  {gerencia && r.faltan > 0 && (
                    <span className="bag-miss">{r.bad.slice(0, 4).map((x) => x.it.nombre).join(" · ")}{r.faltan > 4 ? ` · y ${r.faltan - 4} más` : ""}</span>
                  )}
                  <span className="bag-when">{b.actualizado ? `Revisado ${hace(b.actualizado)}${b.por ? ` por ${b.por}` : ""}` : "Nadie lo revisó todavía"}</span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NuevoBolso({ bolsos, onDone, toast }: { bolsos: BolsoInst[]; onDone: (id: string) => void; toast: (m: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [ubic, setUbic] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="summary clear new-bag" onSubmit={async (e) => {
      e.preventDefault(); if (!nombre.trim()) return;
      setBusy(true);
      try {
        const copia: Bolso | undefined = bolsos.find((x) => x.id === base)?.bolso;
        onDone(await crearBolso(nombre, ubic, copia));
      } catch { toast("No se pudo crear el bolso"); } finally { setBusy(false); }
    }}>
      <h2>Nuevo bolso</h2>
      <div className="form-grid">
        <label htmlFor="nb-nombre">Nombre<input id="nb-nombre" required value={nombre} placeholder="Ej.: Bolso Sede Central" onChange={(e) => setNombre(e.target.value)} /></label>
        <label htmlFor="nb-ubic">Ubicación<input id="nb-ubic" value={ubic} placeholder="Ej.: Recepción, planta baja" onChange={(e) => setUbic(e.target.value)} /></label>
        <label htmlFor="nb-base">Lista de elementos
          <select id="nb-base" value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">Lista estándar de Mi Bolso</option>
            {bolsos.map((b) => <option key={b.id} value={b.id}>Copiar la lista de {b.nombre}</option>)}
          </select>
        </label>
      </div>
      <div className="acts"><button className="btn primary" disabled={busy || !nombre.trim()}>{busy ? "Creando…" : "Crear bolso"}</button></div>
    </form>
  );
}

/* ---------- Team: who can use the shared bags ---------- */
function Equipo({ user, solicitudes, chip, onBack, toast }: {
  user: User; solicitudes: Solicitud[]; chip: React.ReactNode; onBack: () => void; toast: (m: string) => void;
}) {
  const [miembros, setMiembros] = useState<Miembro[] | null>(null);
  const [email, setEmail] = useState("");
  const [rolNuevo, setRolNuevo] = useState<Rol>("voluntario");
  const [quitar, setQuitar] = useState<string | null>(null);
  const [linkFallback, setLinkFallback] = useState(false);
  useEffect(() => subscribeEquipo(setMiembros, () => setMiembros([])), []);
  const link = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
  const yo = emailDe(user);
  const err = () => toast("No se pudo guardar. Revisá la conexión.");

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
        <div className="cat-head"><h3>Con acceso</h3><span className="num">{miembros ? miembros.length + ADMINS.length : ""}</span></div>
        <ul className="rows">
          {ADMINS.map((a) => (
            <li className="row" key={a}>
              <div className="name"><span>{a === yo ? `${user.displayName ?? a} (vos)` : a}</span><span className="sub"><span className="of">{a}</span></span></div>
              <span className="pill info">Administrador</span>
            </li>
          ))}
          {miembros?.filter((m) => !ADMINS.includes(m.email)).map((m) => (
            <li className="row" key={m.email}>
              <div className="name"><span>{m.nombre || m.email}</span><span className="sub"><span className="of">{m.email}</span></span></div>
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
        agregarMiembro(v, rolNuevo, user).then(() => { toast(`${v} ya tiene acceso`); setEmail(""); }).catch(err);
      }}>
        <div className="cat-head"><h3>Agregar por email</h3></div>
        <p className="empty-note small-note">Si ya sabés el Gmail de la persona, dale acceso directo sin esperar el pedido.</p>
        <div className="share-row">
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
