"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TIPOS, addItem, applySheet, buildCopyText, fmtWhen, groupBySection, mergeCambio, parseLegacyBackup,
  aplicarLista, copiarLista, difLista, esVital, mismaLista, rows, setCant, setValue, setVenc,
  type Bolso, type Catalog, type Cambio, type CambioLista, type Draft, type Movimiento, type Tipo,
} from "@/lib/inventory";
import type { MovIn, Store } from "@/lib/data";
import { Options, Stepper } from "./Controls";
import Sheet from "./Sheet";
import History from "./History";
import AlarmaVenc from "./AlarmaVenc";

const AJUSTE_WINDOW = 5 * 60_000; // manual edits within 5 min are grouped in one history entry
const PAGE = 50;

type Props = {
  store: Store;
  /** Big title in the status band. */
  title: string;
  /** Right side of the band (who is signed in, "Salir"). */
  top: ReactNode;
  /** Shown above the title, e.g. a link back to the list of bags. */
  back?: { label: string; onClick: () => void };
  subtitle?: ReactNode;
  /** Whether "Editar lista" is offered (shared bags: management only). */
  canEditList?: boolean;
  /** Extra controls at the top of the list while editing (bag name, delete…). */
  editExtra?: ReactNode;
  copyTitle?: string;
  savedText?: string;
  loadingText?: string;
  tabKey?: string;
  /** Called after each change to the list of items (shared bags replay it on the other bags). */
  onListaChange?: (ch: CambioLista) => void;
  /** Note shown while editing the list. */
  editNote?: string;
  /** Extra row at the bottom of the status band (push alarms). */
  bandExtra?: ReactNode;
  /** Personal bag: the institution's list, offered when this bag's list is different. */
  listaEquipo?: Catalog | null;
};

export default function InventoryApp({
  store, title, top, back, subtitle, canEditList = true, editExtra, copyTitle,
  savedText = "Guardado en tu cuenta", loadingText = "Cargando tu bolso…", tabKey = "mibolso-tab", bandExtra, onListaChange, editNote, listaEquipo,
}: Props) {
  const [verLista, setVerLista] = useState(false);
  const [listaOculta, setListaOculta] = useState("");
  const [bolso, setBolso] = useState<Bolso | null>(null);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [movLimit, setMovLimit] = useState(PAGE);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("frontal");
  const [filtro, setFiltro] = useState<"todos" | "faltan" | "sin">("todos");
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"uso" | "repo" | null>(null);
  const [copyFallback, setCopyFallback] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [online, setOnline] = useState(true);
  const ajuste = useRef<{ id: string; at: number; cambios: Cambio[] } | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout>>();

  const toast = useCallback((m: string) => {
    setToastMsg(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(""), 2400);
  }, []);

  useEffect(() => { setBolso(null); setLoadError(""); return store.subscribe(setBolso, (e) => setLoadError(e.message)); }, [store]);
  useEffect(() => store.subscribeMovs(movLimit, setMovs, () => {}), [store, movLimit]);
  useEffect(() => {
    try { const t = localStorage.getItem(tabKey); if (t) setTab(t); setListaOculta(localStorage.getItem(`${tabKey}-lista-oculta`) ?? ""); } catch {}
    const upd = () => setOnline(navigator.onLine); upd();
    window.addEventListener("online", upd); window.addEventListener("offline", upd);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); };
  }, [tabKey]);

  // Writes go to Firestore's local cache first (the snapshot updates right away), then sync.
  const persist = useCallback((next: Bolso, mov?: MovIn, fields?: Cambio[]) => {
    setBolso(next);
    store.save(next, mov, fields).catch(() => toast("No se pudo guardar. Revisá la conexión."));
  }, [store, toast]);

  const manual = useCallback((r: { next: Bolso; cambio: Cambio } | null) => {
    if (!r) return;
    const now = Date.now();
    let a = ajuste.current;
    if (!a || now - a.at > AJUSTE_WINDOW) a = { id: store.newMovId(), at: now, cambios: [] };
    a = { ...a, at: now, cambios: mergeCambio(a.cambios, r.cambio) };
    ajuste.current = a;
    persist(r.next, { id: a.id, tipo: "ajuste", cambios: a.cambios }, [r.cambio]);
  }, [store, persist]);

  const editLista = useCallback((b: Bolso, ch: CambioLista) => {
    const next = aplicarLista(b, ch);
    if (next === b) return;
    persist(next);
    onListaChange?.(ch);
  }, [persist, onListaChange]);

  const all = useMemo(() => (bolso ? rows(bolso) : []), [bolso]);

  if (loadError) return (
    <div className="splash" style={{ padding: 16, textAlign: "center", flexDirection: "column", gap: 12 }}>
      <span>No se pudo cargar el bolso ({loadError}).</span>
      {back ? <button className="btn" onClick={back.onClick}>{back.label}</button> : top}
    </div>
  );
  if (!bolso) return <div className="splash">{loadingText}</div>;

  // red: vital missing / expired · yellow: non-vital missing · attention: expiring soon, O₂ half
  const bad = all.filter((x) => x.st.level === "bad"), leves = all.filter((x) => x.st.level === "warn" && x.st.falta);
  const warn = all.filter((x) => x.st.level === "warn" && !x.st.falta);
  const cargados = all.filter((x) => x.st.level !== "none").length;
  const seccion = bolso.catalog.secciones.find((s) => s.id === tab);

  function pickTab(t: string) { setTab(t); try { localStorage.setItem(tabKey, t); } catch {} }

  async function copy() {
    const txt = buildCopyText(bolso!, new Date(), copyTitle);
    try { await navigator.clipboard.writeText(txt); setCopyFallback(""); toast("Lista copiada"); }
    catch { setCopyFallback(txt); toast("Seleccioná y copiá el texto"); }
  }

  function saveSheet(draft: Draft, draftVenc: Record<string, string>, nota: string) {
    const kind = sheet!;
    const { next, cambios } = applySheet(bolso!, kind, draft, draftVenc);
    setSheet(null);
    if (!cambios.length) return toast("No hubo cambios");
    ajuste.current = null;
    persist(next, { tipo: kind, nota, cambios }, cambios);
    toast(kind === "uso" ? "Uso registrado" : "Reposición registrada");
  }

  async function doImport(text: string) {
    if (!store.importBackup) return;
    try {
      const { bolso: b, historial } = parseLegacyBackup(text);
      await store.importBackup(b, historial);
      toast(`Importado: inventario y ${historial.length} movimientos`);
    } catch { toast("Esa copia no es válida"); }
  }

  const li = (x: (typeof all)[number], cls: string) => (
    <li key={x.it.id}><span><span>{x.it.nombre}</span> <span className="where">· {x.c.nombre}</span></span><span className={`pill ${cls}`}>{x.st.motivo}</span></li>
  );

  return (
    <>
      <div className="wrap">
        <header className="band">
          {back && <button className="backlink" onClick={back.onClick}>‹ {back.label}</button>}
          <div className="band-top">
            <div className="titles"><h1>{title}</h1>{subtitle && <span className="subtitle">{subtitle}</span>}</div>
            {top}
          </div>
          <div className="meter">
            <div className="tile bad"><b className="num">{bad.length}</b><span>Faltan vitales</span></div>
            <div className="tile warn"><b className="num">{leves.length + warn.length}</b><span>{leves.length ? "Otros faltantes" : "Atención"}</span></div>
            <div className="tile"><b className="num">{cargados}/{all.length}</b><span>Cargados</span></div>
          </div>
          <div className="sync" style={{ marginTop: 6 }}>{online ? savedText : "Sin conexión: se guarda en el celular y se sincroniza al volver la señal"}</div>
          {bandExtra}
        </header>

        <AlarmaVenc bolso={bolso} clave={`${tabKey}-${title}`} />

        {listaEquipo && !mismaLista(bolso.catalog, listaEquipo) && listaOculta !== JSON.stringify(listaEquipo).length + "" && (() => {
          const dif = difLista(bolso, listaEquipo);
          const usar = () => {
            persist(copiarLista(bolso, { ...bolso, catalog: listaEquipo }), { tipo: "ajuste", nota: "Lista copiada de los bolsos de la institución", cambios: [] });
            setVerLista(false); toast("Lista actualizada");
          };
          return (
            <section className="lista-equipo">
              <div className="lista-equipo-txt"><b>Lista de los bolsos de la institución</b>
                <span>Tu lista es distinta{dif.nuevos.length ? ` · ${dif.nuevos.length} elemento${dif.nuevos.length > 1 ? "s" : ""} nuevo${dif.nuevos.length > 1 ? "s" : ""}` : ""}{dif.quitados.length ? ` · ${dif.quitados.length} que ellos no tienen` : ""}. Lo que ya cargaste se mantiene.</span></div>
              {verLista && (dif.nuevos.length > 0 || dif.quitados.length > 0) && (
                <div className="lista-equipo-dif">
                  {dif.nuevos.length > 0 && <p><b>Se agregan:</b> {dif.nuevos.join(", ")}</p>}
                  {dif.quitados.length > 0 && <p><b>Se quitan:</b> {dif.quitados.join(", ")}</p>}
                </div>
              )}
              <div className="lista-equipo-btns">
                {verLista
                  ? <><button className="btn primary" id="usar-lista" onClick={usar}>Usar esta lista</button><button className="btn" onClick={() => setVerLista(false)}>Cancelar</button></>
                  : <><button className="btn primary" id="ver-lista" onClick={() => setVerLista(true)}>Ver y actualizar</button>
                    <button className="btn" onClick={() => { const k = JSON.stringify(listaEquipo).length + ""; setListaOculta(k); try { localStorage.setItem(`${tabKey}-lista-oculta`, k); } catch {} }}>Ahora no</button></>}
              </div>
            </section>
          );
        })()}

        {cargados === 0 && <p className="notice">Primera vez: recorré cada compartimento y cargá lo que tenés. Después sólo usás “Registrar uso” y “Reponer”.</p>}

        <section className={`summary ${bad.length ? "" : leves.length ? "leve" : "clear"}`} aria-live="polite">
          <div className="sum-head">
            <h2>{bad.length + leves.length ? `Faltantes (${bad.length + leves.length})` : "Bolso completo"}</h2>
            <button className="btn" id="copy" disabled={!bad.length && !leves.length && !warn.length} onClick={copy}>Copiar lista para reponer</button>
          </div>
          {!bad.length && !leves.length && !warn.length && <p className="empty-note">No hay nada en falta, vencido ni con carga baja.</p>}
          {groupBySection(bad).map((g) => (
            <div className="sum-group" key={g.s.id}><h3>{g.s.nombre}</h3><ul className="sum-list">{g.items.map((x) => li(x, "bad"))}</ul></div>
          ))}
          {!!leves.length && <div className="sum-group leves"><h3>No vitales</h3><ul className="sum-list">{leves.map((x) => li(x, "warn"))}</ul></div>}
          {!!warn.length && <div className="sum-group"><h3>Atención</h3><ul className="sum-list">{warn.map((x) => li(x, "warn"))}</ul></div>}
          {copyFallback && <textarea className="copy-fallback" readOnly value={copyFallback} onFocus={(e) => e.target.select()} />}
        </section>

        <nav className="tabs" role="tablist">
          {bolso.catalog.secciones.map((s) => {
            const n = all.filter((x) => x.s.id === s.id && x.st.level === "bad").length;
            const nl = all.filter((x) => x.s.id === s.id && x.st.level === "warn" && x.st.falta).length;
            return <button key={s.id} className="tab" role="tab" aria-selected={tab === s.id} onClick={() => pickTab(s.id)}>{s.nombre}
              {n > 0 ? <span className="cnt">{n}</span> : nl > 0 && <span className="cnt warn">{nl}</span>}</button>;
          })}
          <button className="tab" role="tab" aria-selected={tab === "historial"} onClick={() => pickTab("historial")}>Historial</button>
        </nav>

        {tab === "historial" ? (
          <History movs={movs} hasMore={movs.length >= movLimit} onMore={() => setMovLimit((n) => n + PAGE)} onImport={store.importBackup ? doImport : undefined} />
        ) : (
          <>
            <div className="toolbar">
              <div className="seg-filter" role="group" aria-label="Filtrar">
                {([["todos", "Todo"], ["faltan", "Faltantes"], ["sin", "Sin cargar"]] as const).map(([k, l]) => (
                  <button key={k} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{l}</button>
                ))}
              </div>
              {canEditList && <button className="btn" id="edit-toggle" onClick={() => { setEditing(!editing); setConfirmDel(null); if (!editing) setFiltro("todos"); }}>{editing ? "Listo" : "Editar lista"}</button>}
            </div>
            <main>
              {editing && editNote && <p className="notice">{editNote}</p>}
              {editing && editExtra}
              {(seccion ?? bolso.catalog.secciones[0]).categorias.map((c) => {
                let items = all.filter((x) => x.c.id === c.id);
                const nb = items.filter((x) => x.st.level === "bad" || x.st.falta).length;
                if (!editing) {
                  if (filtro === "faltan") items = items.filter((x) => x.st.level === "bad" || x.st.level === "warn");
                  if (filtro === "sin") items = items.filter((x) => x.st.level === "none");
                  if (!items.length && filtro !== "todos") return null;
                }
                return (
                  <section className="cat" key={c.id}>
                    <div className="cat-head"><h3>{c.nombre}</h3><span className="num">{nb ? `${nb} faltan · ` : ""}{c.items.length} ítems</span></div>
                    <ul className="rows">
                      {items.map(({ it, st }) => editing ? (
                        <li className="row" key={it.id}><div className="edit-row">
                          <input type="text" defaultValue={it.nombre} aria-label="Nombre" onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.nombre) editLista(bolso, { op: "rename", id: it.id, nombre: e.target.value.trim() }); }} />
                          <select value={it.tipo} aria-label="Tipo" onChange={(e) => editLista(bolso, { op: "tipo", id: it.id, tipo: e.target.value as Tipo })}>
                            {Object.entries(TIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                          <label className="vital-toggle" title="Si falta, se ve en rojo"><input type="checkbox" checked={esVital(it, c)} onChange={(e) => editLista(bolso, { op: "vital", id: it.id, vital: e.target.checked })} /> Vital</label>
                          {it.tipo === "cant" && <label>Mínimo <input type="number" min={0} defaultValue={it.min ?? ""} onBlur={(e) => { const min = e.target.value === "" ? null : Number(e.target.value); if ((min || undefined) !== it.min) editLista(bolso, { op: "min", id: it.id, min }); }} /></label>}
                          {confirmDel === it.id
                            ? <><button className="btn danger" onClick={() => { editLista(bolso, { op: "remove", id: it.id }); setConfirmDel(null); }}>Confirmar</button><button className="btn" onClick={() => setConfirmDel(null)}>No</button></>
                            : <button className="btn danger" onClick={() => setConfirmDel(it.id)}>Quitar</button>}
                        </div></li>
                      ) : (
                        <li className={`row ${st.level === "bad" ? "is-bad" : st.falta ? "is-warn" : ""}`} key={it.id}>
                          <div className="name">
                            <span>{it.nombre}</span>
                            {(it.tipo === "cant" || c.vence || st.level === "bad" || st.level === "warn") && (
                              <span className="sub">
                                {it.tipo === "cant" && <span className="of">{it.min ? `mínimo ${it.min}` : "sin mínimo"}</span>}
                                {c.vence && <><label htmlFor={`v-${it.id}`}>Vence</label>
                                  <input type="date" id={`v-${it.id}`} value={bolso.venc[it.id] ?? ""} onChange={(e) => manual(setVenc(bolso, it.id, e.target.value))} /></>}
                                {(st.level === "bad" || st.level === "warn") && <span className={`pill ${st.level}`}>{st.motivo}</span>}
                              </span>
                            )}
                          </div>
                          {it.tipo === "cant"
                            ? <div className="opts"><Stepper id={`q-${it.id}`} value={bolso.cant[it.id]} bad={st.level === "bad"} warn={st.level === "warn" && st.falta} onChange={(n) => manual(setCant(bolso, it.id, n))} /></div>
                            : <Options kind={it.tipo} value={bolso.valores[it.id]} label={it.nombre} leve={!esVital(it, c)} onPick={(v) => manual(setValue(bolso, it.id, v))} />}
                        </li>
                      ))}
                    </ul>
                    {editing && (
                      <form className="add-row" onSubmit={(e) => {
                        e.preventDefault(); const input = e.currentTarget.elements.namedItem("nuevo") as HTMLInputElement;
                        if (input.value.trim()) { editLista(bolso, { op: "add", catId: c.id, id: `${c.id}-${Date.now().toString(36)}`, nombre: input.value.trim() }); input.value = ""; }
                      }}>
                        <input name="nuevo" placeholder={`Agregar elemento a ${c.nombre}`} aria-label="Nuevo elemento" />
                        <button className="btn primary">Agregar</button>
                      </form>
                    )}
                  </section>
                );
              })}
            </main>
          </>
        )}
      </div>

      <div className="actionbar">
        <button className="btn use" id="open-uso" onClick={() => setSheet("uso")}>Registrar uso</button>
        <button className="btn repo" id="open-repo" onClick={() => setSheet("repo")}>Reponer</button>
      </div>
      {sheet && <Sheet bolso={bolso} kind={sheet} onClose={() => setSheet(null)} onSave={saveSheet} />}
      <div className={`toast ${toastMsg ? "show" : ""}`} role="status">{toastMsg}</div>
    </>
  );
}
