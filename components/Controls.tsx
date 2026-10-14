"use client";
import { useEffect, useState } from "react";
import { OPTS } from "@/lib/inventory";

/** − [n] + control. Typing commits on blur/Enter; empty means "not loaded". */
export function Stepper({ id, value, bad, onChange }: { id: string; value: number | null | undefined; bad?: boolean; onChange: (n: number | null) => void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => onChange(text.trim() === "" ? null : Math.max(0, Number(text) || 0));
  return (
    <div className={`step ${bad ? "bad" : ""}`}>
      <button type="button" aria-label="Restar" onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}>−</button>
      <input id={id} type="number" inputMode="numeric" min={0} placeholder="—" aria-label="Cantidad" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <button type="button" aria-label="Sumar" onClick={() => onChange((value ?? 0) + 1)}>+</button>
    </div>
  );
}

/** SÍ/NO or ALTO/MEDIO/BAJO/NO buttons. */
export function Options({ kind, value, label, onPick }: { kind: "sn" | "nivel"; value: string | null | undefined; label: string; onPick: (v: string) => void }) {
  return (
    <div className="opts" role="group" aria-label={`Estado de ${label}`}>
      {OPTS[kind].map(([o, cls]) => (
        <button key={o} className={`opt ${cls} ${value === o ? "on" : ""}`} aria-pressed={value === o} onClick={() => onPick(o)}>
          {o === "SI" ? "SÍ" : o}
        </button>
      ))}
    </div>
  );
}
