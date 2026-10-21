import React, { useEffect, useRef } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';

/** Layered curved fills, with continuity when hover changes mid-animation. */
export default function WaveSubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const paths = useRef<Array<SVGPathElement | null>>([]);
  const positions = useRef([[112, 112, 112], [112, 112, 112], [112, 112, 112]]);
  const frame = useRef<number | null>(null);
  const draw = (layer: number, edge: number[]) => {
    const [left, center, right] = edge;
    paths.current[layer]?.setAttribute('d', `M0 ${left} C25 ${left} 25 ${center} 50 ${center} C75 ${center} 75 ${right} 100 ${right} V120 H0 Z`);
  };
  const cancel = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  const animate = (open: boolean) => {
    if (busy) return;
    cancel();
    button.current?.setAttribute('data-wave', open ? 'open' : 'closed');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      positions.current = [0, 0, 0].map(() => [0, 0, 0].map(() => open ? -20 : 112));
      positions.current.forEach((value, index) => draw(index, value));
      return;
    }
    const from = positions.current.map(edge => [...edge]), start = performance.now(), target = open ? -20 : 112;
    const step = (now: number) => {
      let done = true;
      from.forEach((edge, layer) => {
        edge.forEach((value, point) => {
          // Each control point has its own phase; the surface bends as it rises.
          const delay = (open ? layer : 2 - layer) * 75 + (open ? [0, 90, 35] : [45, 0, 70])[point];
          const t = Math.min(1, Math.max(0, (now - start - delay) / (open ? 520 : 400)));
          const ease = t * t * (3 - 2 * t);
          positions.current[layer][point] = value + (target - value) * ease;
          if (t < 1) done = false;
        });
        draw(layer, positions.current[layer]);
      });
      frame.current = done ? null : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  useEffect(() => {
    if (busy) { cancel(); positions.current = [[112, 112, 112], [112, 112, 112], [112, 112, 112]]; positions.current.forEach((value, index) => draw(index, value)); }
    return cancel;
  }, [busy]);
  return <button ref={button} type="submit" disabled={busy} aria-busy={busy} className="auth-wave-submit"
    onPointerEnter={event => { if (event.pointerType !== 'touch') animate(true); }}
    onPointerLeave={() => { if (!button.current?.matches(':focus-visible')) animate(false); }}
    onFocus={event => { if (event.currentTarget.matches(':focus-visible')) animate(true); }}
    onBlur={() => { if (!button.current?.matches(':hover')) animate(false); }}>
    <svg className="auth-button-waves" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{['#ffb200', '#ff5c38', '#0072e3'].map((color, index) => <path key={color} ref={node => { paths.current[index] = node; }} fill={color} d="M0 112 H100 V120 H0 Z"/>)}</svg>
    <span className="auth-button-copy">{busy && <Loader2 size={18} className="animate-spin" aria-hidden="true"/>}{busy ? busyLabel : label}</span>
    <span className="auth-button-arrow" aria-hidden="true"><ArrowUpRight size={23} strokeWidth={1.8}/><ArrowUpRight className="auth-arrow-next" size={23} strokeWidth={1.8}/></span>
  </button>;
}
