// Attachments: the images and videos a plain note carries (coreban
// ADR-0004). The phone prepares each file (images re-encoded to WebP, a
// poster frame taken from each video), asks coreban for upload links, and
// uploads straight to the bucket; the note then names the uploads.
import { apiBaseUrl } from "@/lib/api";
import { NoteRequestError, SessionExpiredError } from "@/lib/feed";

// coreban's limits, in bytes, and how many attachments one note holds.
export const MAX_IMAGE_BYTES = 5 << 20;
export const MAX_VIDEO_BYTES = 25 << 20;
export const MAX_POSTER_BYTES = 1 << 20;
export const MAX_ATTACHMENTS = 10;

// What the picker offers.
export const ATTACH_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

// The longest side a re-encoded image keeps, and a poster's.
export const MAX_IMAGE_EDGE = 2048;
const POSTER_EDGE = 640;
const WEBP_QUALITY = 0.85;

export type AttachmentKind = "image" | "video";

// Attachment mirrors an attachment as coreban shows it in a note. url and
// poster_url are signed links that work for an hour; they are absent on an
// admin's read of someone else's Feed.
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  content_type: string;
  size: number;
  width?: number;
  height?: number;
  // What Download saves the file as.
  filename: string;
  url?: string;
  poster_url?: string;
}

// What to do with a picked file before uploading it.
export type Plan =
  | { action: "encode" }
  | { action: "keep"; kind: AttachmentKind; contentType: string }
  | { action: "refuse"; reason: string };

const videoTypes: Record<string, string> = {
  "video/mp4": "video/mp4",
  "video/webm": "video/webm",
  "video/quicktime": "video/quicktime",
};
const videoExtensions: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const encodable = new Set(["image/jpeg", "image/png", "image/webp"]);

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

// planFile decides what happens to a picked file: JPEG, PNG and WebP are
// re-encoded to WebP (which also drops their location data), a GIF is kept
// as it is so it stays animated, and a video goes up as recorded. HEIC and
// anything else is refused, as is a GIF or video over its limit.
export function planFile(f: { type: string; size: number; name: string }): Plan {
  const ext = extension(f.name);
  const type = f.type.toLowerCase();
  if (f.size <= 0) return { action: "refuse", reason: `${f.name || "This file"} is empty.` };
  if (type === "image/heic" || type === "image/heif" || ext === "heic" || ext === "heif") {
    return {
      action: "refuse",
      reason: "HEIC photos aren't supported. Set the camera to Most Compatible (JPEG), or share a screenshot instead.",
    };
  }
  if (encodable.has(type)) return { action: "encode" };
  if (type === "image/gif") {
    return f.size > MAX_IMAGE_BYTES
      ? { action: "refuse", reason: "A GIF may be at most 5 MB." }
      : { action: "keep", kind: "image", contentType: "image/gif" };
  }
  const video = videoTypes[type] ?? (type === "" ? videoExtensions[ext] : undefined);
  if (video) {
    return f.size > MAX_VIDEO_BYTES
      ? { action: "refuse", reason: "A video may be at most 25 MB." }
      : { action: "keep", kind: "video", contentType: video };
  }
  return { action: "refuse", reason: "Only images (JPEG, PNG, WebP, GIF) and videos (MP4, WebM, MOV) can be attached." };
}

// checkEncodedImage refuses a re-encoded image coreban won't take: one the
// browser couldn't make WebP (it hands back PNG), or one still over 5 MB.
export function checkEncodedImage(b: { type: string; size: number }): string | null {
  if (b.type !== "image/webp") return "This browser can't convert images to WebP; try another browser.";
  if (b.size > MAX_IMAGE_BYTES) return "This image is still over 5 MB once compressed.";
  return null;
}

// checkPoster says whether a taken poster frame can go up with its video.
export const checkPoster = (b: { type: string; size: number }) =>
  b.type === "image/webp" && b.size <= MAX_POSTER_BYTES;

// fitWithin scales width × height down so the longer side is at most max.
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// roomFor says how many more picked files fit on a note already holding
// count, and how many are left out.
export function roomFor(count: number, picked: number) {
  const take = Math.max(0, Math.min(picked, MAX_ATTACHMENTS - count));
  return { take, dropped: picked - take };
}

// --- In the browser ---------------------------------------------------

function canvasBlob(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser can't prepare images."));
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare this image."))), "image/webp", WEBP_QUALITY),
  );
}

// A file ready to upload: its bytes, what coreban is told about it, and a
// poster for a video when one could be taken.
export interface Prepared {
  kind: AttachmentKind;
  blob: Blob;
  contentType: string;
  width?: number;
  height?: number;
  poster?: Blob;
}

// encodeImage re-encodes an image to WebP at most MAX_IMAGE_EDGE on its
// longer side, upright as the camera meant it.
async function encodeImage(file: File): Promise<Prepared> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`Couldn't read ${file.name || "this image"}.`);
  }
  const size = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
  const blob = await canvasBlob(bitmap, size.width, size.height);
  bitmap.close();
  const refused = checkEncodedImage(blob);
  if (refused) throw new Error(refused);
  return { kind: "image", blob, contentType: "image/webp", ...size };
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

// videoPoster takes a frame from early in a video as its poster, with the
// video's size. A video this browser can't decode goes up without one.
function videoPoster(file: File): Promise<{ poster?: Blob; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (r: { poster?: Blob; width?: number; height?: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(r);
    };
    const timer = setTimeout(() => done({}), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => done({});
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 0) / 2);
    };
    video.onseeked = async () => {
      const width = video.videoWidth || undefined;
      const height = video.videoHeight || undefined;
      if (!width || !height) return done({});
      try {
        const size = fitWithin(width, height, POSTER_EDGE);
        const poster = await canvasBlob(video, size.width, size.height);
        done({ poster: checkPoster(poster) ? poster : undefined, width, height });
      } catch {
        done({ width, height });
      }
    };
    video.src = url;
  });
}

// prepare turns a picked file into what is uploaded, or throws why not.
export async function prepare(file: File): Promise<Prepared> {
  const plan = planFile(file);
  if (plan.action === "refuse") throw new Error(plan.reason);
  if (plan.action === "encode") return encodeImage(file);
  if (plan.kind === "image") return { kind: "image", blob: file, contentType: plan.contentType, ...(await imageSize(file)) };
  return { kind: "video", blob: file, contentType: plan.contentType, ...(await videoPoster(file)) };
}

// A signed request to make straight to the bucket.
interface Link {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface Reservation {
  id: string;
  upload: Link;
  poster_upload?: Link;
  expires_at: string;
}

// reserve asks coreban for upload links for a prepared file. Refusals the
// owner can act on (too large, over quota, a demo account) carry coreban's
// own message.
export async function reserve(p: Prepared, signal?: AbortSignal): Promise<Reservation> {
  const res = await fetch(`${apiBaseUrl}/api/coreban/attachments`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      kind: p.kind,
      content_type: p.contentType,
      size: p.blob.size,
      width: p.width,
      height: p.height,
      poster: p.poster ? { size: p.poster.size } : undefined,
    }),
  });
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (typeof body?.error === "string" && res.status < 500) throw new NoteRequestError(body.error);
    if (res.status === 503) throw new Error("Attachments aren't set up on this server yet.");
    throw new Error(`Couldn't start this upload (error ${res.status})`);
  }
  return res.json();
}

// put uploads blob to a signed link, reporting progress from 0 to 1.
export function put(link: Link, blob: Blob, onProgress: (done: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Upload cancelled", "AbortError"));
    const xhr = new XMLHttpRequest();
    xhr.open(link.method, link.url);
    for (const [k, v] of Object.entries(link.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (error ${xhr.status})`));
    xhr.onerror = () => reject(new Error(navigator.onLine ? "Upload failed" : "You're offline"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

// upload prepares a picked file, reserves it, and uploads it (and its
// poster), reporting overall progress; it resolves to the upload's id.
export async function upload(file: File, onProgress: (done: number) => void, signal?: AbortSignal): Promise<string> {
  const p = await prepare(file);
  signal?.throwIfAborted();
  const r = await reserve(p, signal);
  const total = p.blob.size + (p.poster?.size ?? 0);
  await put(r.upload, p.blob, (d) => onProgress((d * p.blob.size) / total), signal);
  if (p.poster && r.poster_upload) {
    const poster = p.poster;
    await put(r.poster_upload, poster, (d) => onProgress((p.blob.size + d * poster.size) / total), signal);
  }
  onProgress(1);
  return r.id;
}

// download saves an attachment under its filename. It fetches the file
// itself, since not every S3-compatible store honours a "save as" link,
// and throws when it can't.
export async function download(a: Attachment): Promise<void> {
  if (!a.url) return;
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`Couldn't download this (error ${res.status})`);
  const href = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = href;
  link.download = a.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
