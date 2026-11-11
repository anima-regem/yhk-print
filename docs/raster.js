export const width = 384;
export const rowBytes = width / 8;
export const maxHeight = 1600;
const inset = 12;
const contentWidth = width - 2 * inset;
const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;

function wrap(context, text) {
  const lines = [];
  for (const paragraph of text.split(/\r\n?|\n/)) {
    let line = "";
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (context.measureText(line + token).width <= contentWidth) {
        line += token;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = token.trimStart();
      if (context.measureText(line).width <= contentWidth) continue;
      const characters = graphemes
        ? Array.from(graphemes.segment(line), part => part.segment)
        : Array.from(line);
      line = "";
      for (const character of characters) {
        if (line && context.measureText(line + character).width > contentWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function render(canvas, text, photo, size) {
  const context = canvas.getContext("2d", {willReadFrequently: true});
  const font = `${size}px system-ui, sans-serif`;
  const lineHeight = Math.ceil(size * 1.35);
  context.font = font;
  const lines = text ? wrap(context, text) : [];
  const textHeight = lines.length * lineHeight;
  const gap = photo && textHeight ? 14 : 0;
  const remainingHeight = maxHeight - 2 * inset - textHeight - gap;
  if (remainingHeight < 0 || (photo && remainingHeight < 32)) {
    throw new Error("This slip is too long. Use smaller text or split it into two prints.");
  }

  const scale = photo ? Math.min(contentWidth / photo.naturalWidth, remainingHeight / photo.naturalHeight, 1) : 0;
  const photoWidth = photo ? Math.max(1, Math.floor(photo.naturalWidth * scale)) : 0;
  const photoHeight = photo ? Math.max(1, Math.floor(photo.naturalHeight * scale)) : 0;
  const photoTop = inset + textHeight + gap;
  const photoLeft = Math.floor((width - photoWidth) / 2);
  canvas.height = photoTop + photoHeight + inset;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "#000";
  context.font = font;
  context.textBaseline = "top";
  lines.forEach((line, index) => context.fillText(line, inset, inset + index * lineHeight));
  if (photo) {
    context.imageSmoothingQuality = "high";
    context.drawImage(photo, photoLeft, photoTop, photoWidth, photoHeight);
  }

  const image = context.getImageData(0, 0, width, canvas.height);
  const pixels = image.data;
  const raster = new Uint8Array(rowBytes * canvas.height);
  let errors = new Float32Array(width + 2);
  let nextErrors = new Float32Array(width + 2);
  for (let y = 0; y < canvas.height; y += 1) {
    const photoRow = y >= photoTop && y < photoTop + photoHeight;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let shade = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      if (photoRow && x >= photoLeft && x < photoLeft + photoWidth) {
        shade = Math.max(0, Math.min(255, shade + errors[x + 1]));
        const remainder = (shade - (shade < 128 ? 0 : 255)) / 16;
        errors[x + 2] += remainder * 7;
        nextErrors[x] += remainder * 3;
        nextErrors[x + 1] += remainder * 5;
        nextErrors[x + 2] += remainder;
      }
      const level = shade < 128 ? 0 : 255;
      if (level === 0) raster[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = level;
    }
    [errors, nextErrors] = [nextErrors, errors];
    nextErrors.fill(0);
  }
  context.putImageData(image, 0, 0);
  return raster;
}
