// The six classical shapes, drawn centred at (0,0) with "radius" r on an
// already-translated canvas context. Shared by the map renderer, the legend
// and the list glyphs (via an SVG path twin).
import type { Shape } from '../../sim/types';

export function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'square': {
      const s = r * 0.9;
      ctx.rect(-s, -s, s * 2, s * 2);
      break;
    }
    case 'triangle':
      ctx.moveTo(0, -r * 1.15);
      ctx.lineTo(r * 1.05, r * 0.8);
      ctx.lineTo(-r * 1.05, r * 0.8);
      ctx.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = Math.cos(a) * r * 1.05;
        const y = Math.sin(a) * r * 1.05;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(0, -r * 1.2);
      ctx.lineTo(r * 0.95, 0);
      ctx.lineTo(0, r * 1.2);
      ctx.lineTo(-r * 0.95, 0);
      ctx.closePath();
      break;
    case 'pentagon':
      for (let i = 0; i < 5; i++) {
        const a = ((Math.PI * 2) / 5) * i - Math.PI / 2;
        const x = Math.cos(a) * r * 1.05;
        const y = Math.sin(a) * r * 1.05;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
  }
}

/** SVG path data for the same shapes (for React lists / legend), centred in a 20×20 box. */
export function svgPath(shape: Shape, r = 8): string {
  const cx = 10;
  const cy = 10;
  const pts = (n: number, rot: number, k = 1.05) => Array.from({ length: n }, (_, i) => {
    const a = ((Math.PI * 2) / n) * i + rot;
    return `${(cx + Math.cos(a) * r * k).toFixed(2)},${(cy + Math.sin(a) * r * k).toFixed(2)}`;
  }).join(' ');
  switch (shape) {
    case 'circle':
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
    case 'square': {
      const s = r * 0.9;
      return `M ${cx - s} ${cy - s} h ${s * 2} v ${s * 2} h ${-s * 2} Z`;
    }
    case 'triangle':
      return `M ${cx} ${cy - r * 1.15} L ${cx + r * 1.05} ${cy + r * 0.8} L ${cx - r * 1.05} ${cy + r * 0.8} Z`;
    case 'hexagon':
      return `M ${pts(6, -Math.PI / 6).split(' ').join(' L ')} Z`;
    case 'diamond':
      return `M ${cx} ${cy - r * 1.2} L ${cx + r * 0.95} ${cy} L ${cx} ${cy + r * 1.2} L ${cx - r * 0.95} ${cy} Z`;
    case 'pentagon':
      return `M ${pts(5, -Math.PI / 2).split(' ').join(' L ')} Z`;
  }
}
