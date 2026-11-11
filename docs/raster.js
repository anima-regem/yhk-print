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

export function render(canvas, text, photo, settings) {
  const {size, align, typeface, rotation, imageWidth, brightness, tone} = settings;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  const family = typeface === "mono" ? "ui-monospace, monospace" : "system-ui, sans-serif";
  const font = `${size}px ${family}`;
  const lineHeight = Math.ceil(size * 1.35);
  context.font = font;
  const lines = text ? wrap(context, text) : [];
  const textHeight = lines.length * lineHeight;
  const gap = photo && textHeight ? 14 : 0;
  const remainingHeight = maxHeight - 2 * inset - textHeight - gap;
  if (remainingHeight < 0 || (photo && remainingHeight < 32)) {
    throw new Error("This slip is too long. Use smaller text or split it into two prints.");
  }

  const sideways = rotation % 180 !== 0;
  const naturalWidth = sideways ? photo?.naturalHeight : photo?.naturalWidth;
  const naturalHeight = sideways ? photo?.naturalWidth : photo?.naturalHeight;
  const scale = photo ? Math.min(contentWidth / naturalWidth, remainingHeight / naturalHeight, 1) * imageWidth / 100 : 0;
  const photoWidth = photo ? Math.max(1, Math.floor(naturalWidth * scale)) : 0;
  const photoHeight = photo ? Math.max(1, Math.floor(naturalHeight * scale)) : 0;
  const photoTop = inset + textHeight + gap;
  const photoLeft = Math.floor((width - photoWidth) / 2);
  canvas.height = photoTop + photoHeight + inset;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "#000";
  context.font = font;
  context.textBaseline = "top";
  context.textAlign = align;
  const textX = {left: inset, center: width / 2, right: width - inset}[align];
  lines.forEach((line, index) => context.fillText(line, textX, inset + index * lineHeight));
  if (photo) {
    context.save();
    context.imageSmoothingQuality = "high";
    context.translate(photoLeft + photoWidth / 2, photoTop + photoHeight / 2);
    context.rotate(rotation * Math.PI / 180);
    const drawWidth = sideways ? photoHeight : photoWidth;
    const drawHeight = sideways ? photoWidth : photoHeight;
    context.drawImage(photo, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
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
      const photoPixel = photoRow && x >= photoLeft && x < photoLeft + photoWidth;
      if (photoPixel) shade += brightness;
      if (photoPixel && tone === "photo") {
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
