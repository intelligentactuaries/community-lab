import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, CustomChart, GraphChart, LineChart, PieChart, SankeyChart, ScatterChart } from 'echarts/charts';
import { GridComponent, GraphicComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent, DataZoomComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../lib/theme';

echarts.use([GraphChart, BarChart, LineChart, PieChart, ScatterChart, SankeyChart, CustomChart, GridComponent, GraphicComponent, LegendComponent, TooltipComponent, MarkLineComponent, MarkPointComponent, MarkAreaComponent, DataZoomComponent, VisualMapComponent, CanvasRenderer]);

/** The only chart component (house rule from apps/web/AGENTS.md). */
export function EChart({ option, className, height }: { option: Record<string, unknown>; className?: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  // The user's pan/zoom outlives re-renders: options are rebuilt every tick, so
  // without this the data-zoom window would snap back to its default mid-drag.
  const zoom = useRef<{ start?: number; end?: number; startValue?: number; endValue?: number; follow: boolean } | null>(null);
  const { resolved } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    inst.current = chart;
    chart.on('datazoom', () => {
      const dz = (chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number; startValue?: number; endValue?: number }> }).dataZoom?.[0];
      if (dz) zoom.current = { start: dz.start, end: dz.end, startValue: dz.startValue, endValue: dz.endValue, follow: (dz.end ?? 100) > 99.5 };
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      inst.current = null;
    };
  }, []);
  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    const z = zoom.current;
    if (z && Array.isArray((option as { dataZoom?: unknown[] }).dataZoom) && ((option as { dataZoom?: unknown[] }).dataZoom?.length ?? 0) > 0) {
      // Zoomed to the live edge: follow it. Anywhere else: hold the exact window the user chose.
      if (z.follow && z.start !== undefined) chart.dispatchAction({ type: 'dataZoom', start: z.start, end: 100 });
      else if (z.startValue !== undefined && z.endValue !== undefined) chart.dispatchAction({ type: 'dataZoom', startValue: z.startValue, endValue: z.endValue });
      else if (z.start !== undefined) chart.dispatchAction({ type: 'dataZoom', start: z.start, end: z.end });
    }
  }, [option, resolved]);
  return <div ref={ref} className={className ?? 'chart'} style={height ? { height } : undefined} />;
}
