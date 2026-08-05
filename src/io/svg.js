/**
 * SVG backend for the export scene.
 *
 * Emits a standalone, self-contained SVG document: no external fonts, no CSS
 * variables, nothing that depends on the application being present. The file
 * opens correctly in a browser, Illustrator, Inkscape or Visio, and is also
 * the source the PNG/JPEG rasteriser draws from.
 *
 * Imports: scene (for metrics only).
 */

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

function num(n) {
  return Math.round(n * 100) / 100;
}

const FONT_STACKS = {
  ui: "Archivo, 'Segoe UI', system-ui, -apple-system, sans-serif",
  mono: "'Roboto Mono', 'SF Mono', Consolas, monospace",
};

/**
 * Render a scene to SVG markup.
 * @param {{width:number, height:number, items:Array}} scene
 * @param {{title?:string, description?:string}} [opts]
 */
export function sceneToSvg(scene, opts = {}) {
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" ` +
      `font-family="${esc(FONT_STACKS.ui)}">`
  );
  if (opts.title) parts.push(`<title>${esc(opts.title)}</title>`);
  if (opts.description) parts.push(`<desc>${esc(opts.description)}</desc>`);

  for (const item of scene.items) {
    parts.push(renderItem(item));
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function renderItem(item) {
  const opacity = item.opacity != null && item.opacity !== 1 ? ` opacity="${num(item.opacity)}"` : '';

  switch (item.type) {
    case 'rect': {
      const radius = item.radius ? ` rx="${num(item.radius)}" ry="${num(item.radius)}"` : '';
      const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
      const dash = item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : '';
      return `<rect x="${num(item.x)}" y="${num(item.y)}" width="${num(Math.max(0, item.w))}" height="${num(Math.max(0, item.h))}"${radius} fill="${esc(item.fill || 'none')}"${stroke}${dash}${opacity}/>`;
    }

    case 'line': {
      const dash = item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : '';
      return `<line x1="${num(item.x1)}" y1="${num(item.y1)}" x2="${num(item.x2)}" y2="${num(item.y2)}" stroke="${esc(item.stroke || '#000')}" stroke-width="${num(item.strokeWidth || 1)}"${dash}${opacity}/>`;
    }

    case 'text': {
      const anchor = item.anchor && item.anchor !== 'start' ? ` text-anchor="${item.anchor}"` : '';
      const weight = item.weight ? ` font-weight="${item.weight}"` : '';
      const family = item.family === 'mono' ? ` font-family="${esc(FONT_STACKS.mono)}"` : '';
      const spacing = item.family === 'mono' ? ' letter-spacing="0.4"' : '';
      return `<text x="${num(item.x)}" y="${num(item.y)}" font-size="${num(item.size || 10)}" fill="${esc(item.fill || '#000')}"${weight}${anchor}${family}${spacing}${opacity}>${esc(item.text)}</text>`;
    }

    case 'circle': {
      const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
      return `<circle cx="${num(item.cx)}" cy="${num(item.cy)}" r="${num(item.r)}" fill="${esc(item.fill || 'none')}"${stroke}${opacity}/>`;
    }

    case 'polygon': {
      const points = item.points.map((p) => `${num(p[0])},${num(p[1])}`).join(' ');
      const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
      return `<polygon points="${points}" fill="${esc(item.fill || 'none')}"${stroke}${opacity}/>`;
    }

    case 'path': {
      const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
      const dash = item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : '';
      return `<path d="${esc(item.d)}" fill="${esc(item.fill || 'none')}"${stroke}${dash} stroke-linejoin="round" stroke-linecap="round"${opacity}/>`;
    }

    case 'image':
      return `<image x="${num(item.x)}" y="${num(item.y)}" width="${num(item.w)}" height="${num(item.h)}" xlink:href="${esc(item.href)}"${opacity}/>`;

    default:
      return '';
  }
}

/**
 * Rasterise SVG markup to a canvas, then to a Blob.
 *
 * The SVG is loaded through a blob: URL rather than a data: URL — Safari
 * refuses large data: URLs in <img>, and blob: has no length limit.
 *
 * @param {string} svg
 * @param {{scale?:number, type?:string, quality?:number, background?:string}} opts
 * @returns {Promise<Blob>}
 */
export function svgToRaster(svg, { scale = 2, type = 'image/png', quality = 0.94, background = null, width, height } = {}) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round((width || img.naturalWidth || 800) * scale);
        canvas.height = Math.round((height || img.naturalHeight || 600) * scale);
        const ctx = canvas.getContext('2d');

        // JPEG has no alpha channel; without a fill it renders transparent
        // pixels as black, which looks like a broken export.
        if (background || type === 'image/jpeg') {
          ctx.fillStyle = background || '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (out) => (out ? resolve(out) : reject(new Error('Canvas produced no image data'))),
          type,
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The exported SVG could not be rasterised.'));
    };

    img.src = url;
  });
}
