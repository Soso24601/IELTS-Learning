import React from 'react';
export default function Brand() {
  return <span className="brand"><span className="brand-word">开口<span>.</span></span><span className="brand-tagline">SPEAK EVERY DAY</span></span>;
}
export function SceneArt({ kind = 'speech', className = '', eager = false }: { kind?: string; className?: string; eager?: boolean }) {
  return <img src={`/art/${kind}.png`} alt="" aria-hidden="true" className={`scene-art ${className}`} loading={eager ? 'eager' : 'lazy'} decoding="async" />;
}
export function domainArt(domain: string) {
  if (/居住|社区/.test(domain)) return 'home';
  if (/饮食|购物/.test(domain)) return 'coffee';
  if (/旅行|出行/.test(domain)) return 'map';
  if (/学习|工作|科技|成长/.test(domain)) return 'book';
  return 'speech';
}
