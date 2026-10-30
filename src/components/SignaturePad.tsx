"use client";
import { useRef } from "react";

// Draw-to-sign pad. Emits a PNG data URL after each stroke.
export function SignaturePad({
  onChange,
  label,
}: {
  onChange: (png: string | null) => void;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        aria-label={label}
        width={360}
        height={120}
        style={{
          border: "1px solid #888",
          borderRadius: 4,
          touchAction: "none",
          background: "#fff",
        }}
        onPointerDown={(e) => {
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          drawing.current = true;
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#0d1a4d";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <div>
        <button
          type="button"
          onClick={() => {
            ref.current!.getContext("2d")!.clearRect(0, 0, 360, 120);
            dirty.current = false;
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
