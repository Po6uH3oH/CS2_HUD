import sharp from 'sharp';
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';

const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'title', 'desc', 'text', 'tspan']);
const attributes = new Set(['xmlns', 'id', 'version', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'd', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'clip-path', 'clip-rule', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits', 'preserveAspectRatio', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'dx', 'dy']);
const styleKeys = new Set(['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'stop-color', 'stop-opacity']);

/** Вектор никогда не отдаётся браузеру: разрешаем только геометрию и превращаем её в PNG. */
export function safeSvg(input: Buffer): Buffer {
  const source = input.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|[\u0000]/i.test(source) || XMLValidator.validate(source) !== true) throw new Error('Некорректный SVG');
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false }).parse(source);
  if (!parsed.svg || Object.keys(parsed).some(key => !['svg', '?xml'].includes(key))) throw new Error('Требуется SVG с корневым элементом svg');
  let nodes = 0;
  const cleanValue = (value: unknown): string => {
    const result = String(value);
    if (result.length > 100_000 || /[\\&<>]|javascript:|data:|https?:|file:|@import|expression/i.test(result)) throw new Error('SVG содержит внешние или неподдерживаемые ссылки');
    if (/url\s*\(/i.test(result) && !/^url\(#[a-zA-Z_][\w.-]*\)$/.test(result)) throw new Error('SVG допускает только локальные ссылки на градиенты');
    return result;
  };
  const walk = (node: unknown, depth = 0): unknown => {
    if (++nodes > 10000 || depth > 60) throw new Error('SVG слишком сложный');
    if (Array.isArray(node)) return node.map(v => walk(v, depth + 1));
    if (node === null || typeof node !== 'object') return String(node ?? '');
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '#text') { result[key] = String(value); continue; }
      if (key === '@_xmlns') { if (value !== 'http://www.w3.org/2000/svg') throw new Error('Неподдерживаемый SVG namespace'); result[key] = value; continue; }
      if (key === '@_style') {
        for (const property of String(value).split(';').filter(v => v.trim())) {
          const separator = property.indexOf(':'); const name = property.slice(0, separator).trim();
          if (separator < 0 || !styleKeys.has(name)) throw new Error('Экспортируйте SVG без CSS, скриптов и внешних ресурсов');
          result['@_' + name] = cleanValue(property.slice(separator + 1).trim());
        }
      } else if (key.startsWith('@_')) {
        if (!attributes.has(key.slice(2))) throw new Error('SVG содержит неподдерживаемый атрибут');
        result[key] = cleanValue(value);
      } else {
        if (!tags.has(key)) throw new Error('SVG содержит неподдерживаемый элемент');
        result[key] = walk(value, depth + 1);
      }
    }
    return result;
  };
  return Buffer.from(new XMLBuilder({ ignoreAttributes: false, processEntities: true }).build({ svg: walk(parsed.svg) }));
}

export async function decodeUpload(dataUrl: string): Promise<Buffer> {
  const match = /^data:image\/(png|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Поддерживаются PNG, WebP и SVG до 2 МБ');
  let data: Buffer = Buffer.from(match[2], 'base64');
  if (data.length > 2 * 1024 * 1024) throw new Error('Размер файла больше 2 МБ');
  if (match[1] === 'svg+xml') data = safeSvg(data);
  const source = sharp(data, { failOn: 'warning', limitInputPixels: 16_777_216 });
  const meta = await source.metadata();
  if (!['png', 'webp', 'svg'].includes(meta.format ?? '') || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) throw new Error('Изображение должно быть не больше 4096 × 4096');
  if (meta.format === 'svg' && match[1] !== 'svg+xml') throw new Error('Содержимое не соответствует типу изображения');
  return source.png().toBuffer();
}
