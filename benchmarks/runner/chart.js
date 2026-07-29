'use strict';
// Grouped bar charts as hand-rolled SVG. No chart library, no build step —
// the file you get is text you can read and diff.

// Colors are assigned by arm, not hard-coded to any particular plugin name:
// baseline stays neutral grey, hush its blue, any extra arm gets the next hue.
const FIXED = { baseline: '#8a8f98', hush: '#4c9be8' };
const EXTRA = ['#e8a04c', '#6ac47a', '#b07be8', '#e86a8a'];

function armColors(arms) {
  const colors = {};
  let i = 0;
  for (const a of arms) colors[a] = FIXED[a] || EXTRA[i++ % EXTRA.length];
  return colors;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * values: category -> arm -> number. Returns a standalone <svg> element
 * (namespaced, so it works as a file as well as inline in a page).
 */
function barChartSvg(title, unit, values, arms, opts = {}) {
  const cats = Object.keys(values);
  const colors = opts.colors || armColors(arms);
  const W = opts.width || 940, H = opts.height || 340;
  const padL = 70, padB = 100, padT = 46;
  const max = Math.max(...cats.flatMap((c) => arms.map((a) => values[c][a] || 0)), 1);
  const plotW = W - padL - 20, plotH = H - padT - padB;
  const groupW = plotW / Math.max(cats.length, 1);
  const barW = Math.min(30, (groupW - 14) / Math.max(arms.length, 1));
  const round = (v) => (v >= 100 ? Math.round(v) : Number(v.toPrecision(3)));

  let bars = '', labels = '';
  cats.forEach((c, i) => {
    arms.forEach((a, j) => {
      const v = values[c][a] || 0;
      const h = (v / max) * plotH;
      const x = padL + i * groupW + (groupW - barW * arms.length) / 2 + j * barW;
      bars += `<rect x="${x.toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${h.toFixed(1)}" fill="${colors[a] || '#999'}"><title>${esc(c)} · ${esc(a)}: ${round(v)}</title></rect>`;
    });
    const cx = padL + i * groupW + groupW / 2;
    labels += `<text x="${cx.toFixed(1)}" y="${H - padB + 16}" transform="rotate(28 ${cx.toFixed(1)} ${H - padB + 16})" font-size="11" fill="#444" text-anchor="start">${esc(c)}</text>`;
  });

  let axis = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, y = padT + plotH - (plotH / 4) * k;
    axis += `<line x1="${padL}" x2="${W - 20}" y1="${y}" y2="${y}" stroke="#e5e5e5"/><text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#777" text-anchor="end">${round(v)}</text>`;
  }
  const legend = arms.map((a, j) =>
    `<rect x="${padL + j * 130}" y="24" width="10" height="10" fill="${colors[a] || '#999'}"/><text x="${padL + j * 130 + 15}" y="33" font-size="11" fill="#333">${esc(a)}</text>`).join('');
  // A standalone file needs its own title; an inline chart already sits under
  // an <h3>, so it can turn the baked-in one off.
  const heading = opts.heading === false ? ''
    : `<text x="${padL}" y="16" font-size="13" fill="#1a1a1a">${esc(title)}</text><text x="${padL + title.length * 7 + 12}" y="16" font-size="11" fill="#888">${esc(unit)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${title} (${unit})`)}"><rect width="${W}" height="${H}" fill="#fafafa"/>${heading}${axis}${bars}${labels}${legend}</svg>`;
}

module.exports = { barChartSvg, armColors, esc };
