"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TIPOS, addItem, applySheet, buildCopyText, fmtWhen, groupBySection, mergeCambio, parseLegacyBackup,
  removeItem, renameItem, rows, setCant, setMin, setTipo, setValue, setVenc,
  type Bolso, type Cambio, type Draft, type Movimiento, type Tipo,
} from "@/lib/inventory";
import type { MovIn, Store } from "@/lib/data";
import { Options, Stepper } from "./Controls";
import Sheet from "./Sheet";
import History from "./History";

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
  subtitle?: string;
  /** Whether "Editar lista" is offered (shared bags: management only). */
  canEditList?: boolean;
  /** Extra controls at the top of the list while editing (bag name, delete…). */
  editExtra?: ReactNode;
  copyTitle?: string;
  savedText?: string;
  loadingText?: string;
  tabKey?: string;
};

export default function InventoryApp({
  store, title, top, back, subtitle, canEditList = true, editExtra, copyTitle,
  savedText = "Guardado en tu cuenta", loadingText = "Cargando tu bolso…", tabKey = "mibolso-tab",
}: Props) {
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
    try { const t = localStorage.getItem(tabKey); if (t) setTab(t); } catch {}
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

  const all = useMemo(() => (bolso ? rows(bolso) : []), [bolso]);

  if (loadError) return (
    <div className="splash" style={{ padding: 16, textAlign: "center", flexDirection: "column", gap: 12 }}>
      <span>No se pudo cargar el bolso ({loadError}).</span>
      {back ? <button className="btn" onClick={back.onClick}>{back.label}</button> : top}
    </div>
  );
  if (!bolso) return <div className="splash">{loadingText}</div>;

  const bad = all.filter((x) => x.st.level === "bad"), warn = all.filter((x) => x.st.level === "warn");
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
            <div className="tile bad"><b className="num">{bad.length}</b><span>Faltan</span></div>
            <div className="tile warn"><b className="num">{warn.length}</b><span>Atención</span></div>
            <div className="tile"><b className="num">{cargados}/{all.length}</b><span>Cargados</span></div>
          </div>
          <div className="sync" style={{ marginTop: 6 }}>{online ? savedText : "Sin conexión: se guarda en el celular y se sincroniza al volver la señal"}</div>
        </header>

        {cargados === 0 && <p className="notice">Primera vez: recorré cada compartimento y cargá lo que tenés. Después sólo usás “Registrar uso” y “Reponer”.</p>}

        <section className={`summary ${bad.length ? "" : "clear"}`} aria-live="polite">
          <div className="sum-head">
            <h2>{bad.length ? `Faltantes (${bad.length})` : "Bolso completo"}</h2>
            <button className="btn" id="copy" disabled={!bad.length && !warn.length} onClick={copy}>Copiar lista para reponer</button>
          </div>
          {!bad.length && !warn.length && <p className="empty-note">No hay nada en falta, vencido ni con carga baja.</p>}
          {groupBySection(bad).map((g) => (
            <div className="sum-group" key={g.s.id}><h3>{g.s.nombre}</h3><ul className="sum-list">{g.items.map((x) => li(x, "bad"))}</ul></div>
          ))}
          {!!warn.length && <div className="sum-group"><h3>Atención</h3><ul className="sum-list">{warn.map((x) => li(x, "warn"))}</ul></div>}
          {copyFallback && <textarea className="copy-fallback" readOnly value={copyFallback} onFocus={(e) => e.target.select()} />}
        </section>

        <nav className="tabs" role="tablist">
          {bolso.catalog.secciones.map((s) => {
            const n = all.filter((x) => x.s.id === s.id && x.st.level === "bad").length;
            return <button key={s.id} className="tab" role="tab" aria-selected={tab === s.id} onClick={() => pickTab(s.id)}>{s.nombre}{n > 0 && <span className="cnt">{n}</span>}</button>;
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
              {editing && editExtra}
              {(seccion ?? bolso.catalog.secciones[0]).categorias.map((c) => {
                let items = all.filter((x) => x.c.id === c.id);
                const nb = items.filter((x) => x.st.level === "bad").length;
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
                          <input type="text" defaultValue={it.nombre} aria-label="Nombre" onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.nombre) persist(renameItem(bolso, it.id, e.target.value)); }} />
                          <select value={it.tipo} aria-label="Tipo" onChange={(e) => persist(setTipo(bolso, it.id, e.target.value as Tipo))}>
                            {Object.entries(TIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                          {it.tipo === "cant" && <label>Mínimo <input type="number" min={0} defaultValue={it.min ?? ""} onBlur={(e) => persist(setMin(bolso, it.id, e.target.value === "" ? null : Number(e.target.value)))} /></label>}
                          {confirmDel === it.id
                            ? <><button className="btn danger" onClick={() => { persist(removeItem(bolso, it.id)); setConfirmDel(null); }}>Confirmar</button><button className="btn" onClick={() => setConfirmDel(null)}>No</button></>
                            : <button className="btn danger" onClick={() => setConfirmDel(it.id)}>Quitar</button>}
                        </div></li>
                      ) : (
                        <li className={`row ${st.level === "bad" ? "is-bad" : ""}`} key={it.id}>
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
                            ? <div className="opts"><Stepper id={`q-${it.id}`} value={bolso.cant[it.id]} bad={st.level === "bad"} onChange={(n) => manual(setCant(bolso, it.id, n))} /></div>
                            : <Options kind={it.tipo} value={bolso.valores[it.id]} label={it.nombre} onPick={(v) => manual(setValue(bolso, it.id, v))} />}
                        </li>
                      ))}
                    </ul>
                    {editing && (
                      <form className="add-row" onSubmit={(e) => {
                        e.preventDefault(); const input = e.currentTarget.elements.namedItem("nuevo") as HTMLInputElement;
                        if (input.value.trim()) { persist(addItem(bolso, c.id, input.value, `${c.id}-${Date.now().toString(36)}`)); input.value = ""; }
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
