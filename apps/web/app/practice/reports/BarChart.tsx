'use client';

/**
 * A bar chart, drawn as SVG, with no charting library.
 *
 * WHY NOT A LIBRARY. Recharts or Chart.js would draw a nicer chart and cost a
 * dependency that ships to every visitor, styles itself, and has to be kept
 * current. What is wanted here is "let us see the shape of it" — bars of
 * proportional height with readable labels — which is about forty lines of SVG.
 * If charts become a real part of the product, that is the point to reach for
 * one, having learned what people actually look at.
 *
 * IT IS A SECOND VIEW OF THE TABLE ABOVE IT, never a different query. A chart
 * that fetched its own data is a chart that can disagree with the numbers
 * beside it, and the reader has no way to tell which is wrong.
 */

import { strings } from '../../strings';
import styles from '../manage.module.css';

export type Bar = { label: string; value: number };

export function BarChart({ bars, caption }: { bars: Bar[]; caption: string }) {
  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.value), 1);

  /*
   * Sized in the SVG's own coordinates and scaled by CSS, so it stays sharp at
   * any width without measuring the container. The viewBox does the work.
   */
  const barWidth = 100 / bars.length;
  const height = 160;
  const labelEvery = Math.ceil(bars.length / 12);

  return (
    <figure className={styles.chartFigure}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className={styles.chartSvg}
        role="img"
        aria-label={caption}
      >
        {/*
          A baseline, because bars floating with no axis read as decoration.
          Drawn first so the bars sit on top of it.
        */}
        <line x1="0" y1={height - 24} x2="100" y2={height - 24} className={styles.chartAxis} vectorEffect="non-scaling-stroke" />
        {bars.map((bar, i) => {
          const barHeight = Math.max((bar.value / max) * (height - 40), bar.value > 0 ? 1 : 0);
          return (
            <rect
              key={i}
              x={i * barWidth + barWidth * 0.15}
              y={height - 24 - barHeight}
              width={barWidth * 0.7}
              height={barHeight}
              className={styles.chartBar}
            >
              {/* Every bar is readable on hover, so the chart is not a picture
                  of numbers you then have to find in the table. */}
              <title>{`${bar.label}: ${bar.value}`}</title>
            </rect>
          );
        })}
      </svg>

      {/*
        Labels in HTML rather than SVG text, so they inherit the page's font and
        can be rotated or hidden by CSS without touching the drawing. Thinned
        when there are many, because overlapping labels are worse than fewer.
      */}
      <div className={styles.chartLabels}>
        {bars.map((bar, i) => (
          <span key={i} className={styles.chartLabel} title={bar.label}>
            {i % labelEvery === 0 ? bar.label : ''}
          </span>
        ))}
      </div>

      <figcaption className={styles.chartCaption}>
        {caption} · {strings.reports.chartPeak.replace('{n}', String(max))}
      </figcaption>
    </figure>
  );
}
