import type { ImageVersionName } from "./image-renditions.js";

type Photon = typeof import("@cf-wasm/photon");
type PhotonImage = InstanceType<Photon["PhotonImage"]>;

let photonModule: Promise<Photon> | undefined;
function loadPhoton(): Promise<Photon> {
  photonModule ??= import("@cf-wasm/photon").then(async photon => {
    await photon.initPhoton.ensure();
    return photon;
  }).catch(error => {
    photonModule = undefined;
    throw error;
  });
  return photonModule;
}

const ENCODABLE = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function canResize(ext: string): boolean {
  return ENCODABLE.has(ext);
}

function scaled(side: number, scale: number): number {
  return Math.max(1, Math.floor(side * scale + 0.5));
}

function fitDimensions(w: number, h: number, maxW: number, maxH: number): [number, number] {
  const scale = Math.min(maxW / w, maxH / h);
  return [scaled(w, scale), scaled(h, scale)];
}

function resizeTo(p: Photon, img: PhotonImage, w: number, h: number): PhotonImage {
  const enlarging = w > img.get_width() || h > img.get_height();
  return p.resize(img, w, h, enlarging ? p.SamplingFilter.CatmullRom : p.SamplingFilter.Lanczos3);
}

function resizeToLimit(p: Photon, img: PhotonImage, maxW: number, maxH: number): PhotonImage {
  const w = img.get_width();
  const h = img.get_height();
  if (w <= maxW && h <= maxH) return resizeTo(p, img, w, h);
  const [nw, nh] = fitDimensions(w, h, maxW, maxH);
  return resizeTo(p, img, nw, nh);
}

function resizeToFit(p: Photon, img: PhotonImage, maxW: number, maxH: number): PhotonImage {
  const [nw, nh] = fitDimensions(img.get_width(), img.get_height(), maxW, maxH);
  return resizeTo(p, img, nw, nh);
}

function resizeAndPad(p: Photon, img: PhotonImage, w: number, h: number): PhotonImage {
  const fitted = resizeToFit(p, img, w, h);
  const clear = () => new p.Rgba(0, 0, 0, 0);
  let out = fitted;
  const padX = w - fitted.get_width();
  const padY = h - fitted.get_height();
  const steps: [(i: PhotonImage, n: number, c: InstanceType<Photon["Rgba"]>) => PhotonImage, number][] = [
    [p.padding_left, Math.floor(padX / 2)],
    [p.padding_right, padX - Math.floor(padX / 2)],
    [p.padding_top, Math.floor(padY / 2)],
    [p.padding_bottom, padY - Math.floor(padY / 2)],
  ];
  for (const [pad, n] of steps) {
    if (n <= 0) continue;
    const next = pad(out, n, clear());
    if (out !== fitted) out.free();
    out = next;
  }
  if (out !== fitted) fitted.free();
  return out;
}

function encode(img: PhotonImage, ext: string): Uint8Array {
  if (ext === ".jpg" || ext === ".jpeg") return img.get_bytes_jpeg(92);
  if (ext === ".webp") return img.get_bytes_webp();
  return img.get_bytes();
}

export async function imageDecodes(bytes: Uint8Array): Promise<boolean> {
  const p = await loadPhoton();
  try {
    p.PhotonImage.new_from_byteslice(bytes).free();
    return true;
  } catch {
    return false;
  }
}

export async function imageVersionBytes(
  original: Uint8Array,
  ext: string,
): Promise<Record<ImageVersionName, Uint8Array> | undefined> {
  if (!canResize(ext)) return undefined;
  const p = await loadPhoton();
  let source: PhotonImage;
  try {
    source = p.PhotonImage.new_from_byteslice(original);
  } catch {
    return undefined;
  }
  const made: PhotonImage[] = [];
  try {
    const medium = resizeToLimit(p, source, 200, 200);
    made.push(medium);
    const large = resizeToLimit(p, source, 500, 500);
    made.push(large);
    const small = resizeToFit(p, medium, 75, 75);
    made.push(small);
    const icon = resizeAndPad(p, small, 16, 16);
    made.push(icon);
    return {
      icon: encode(icon, ext),
      small: encode(small, ext),
      medium: encode(medium, ext),
      large: encode(large, ext),
    };
  } finally {
    for (const img of made) img.free();
    source.free();
  }
}
