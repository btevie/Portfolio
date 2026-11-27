/**
 * Minimal reader for a saved email (.eml): finds the readable body and any PDF attachment, so "save the email and drop it
 * here" works without any mailbox access or server. Only what invoice extraction needs is decoded.
 */
export interface EmlContent { subject: string; from: string; text: string; pdfs: { name: string; data: ArrayBuffer }[] }

const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };
const toBytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

function splitHeaders(part: string): { headers: Record<string, string>; body: string } {
  const m = /\r?\n\r?\n/.exec(part);
  const head = m ? part.slice(0, m.index) : part;
  const body = m ? part.slice(m.index + m[0].length) : "";
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

const param = (value: string | undefined, name: string) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(value ?? "")?.slice(2, 3)[0] ?? new RegExp(`${name}\\s*=\\s*([^;\\s"]+)`, "i").exec(value ?? "")?.[1];

function decodeBody(body: string, encoding: string | undefined): Uint8Array {
  const enc = (encoding ?? "").toLowerCase();
  if (enc === "base64") { try { return toBytes(atob(body.replace(/\s+/g, ""))); } catch { return new Uint8Array(); } }
  if (enc === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return toBytes(s);
  }
  return toBytes(body);
}

const stripHtml = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ");

function walk(raw: string, out: EmlContent, depth = 0): void {
  if (depth > 6) return;
  const { headers, body } = splitHeaders(raw);
  const type = (headers["content-type"] ?? "text/plain").toLowerCase();
  const boundary = param(headers["content-type"], "boundary");
  if (type.startsWith("multipart/") && boundary) {
    const parts: string[] = [];
    for (const part of body.split(`--${boundary}`).slice(1)) { if (part.startsWith("--")) break; parts.push(part.replace(/^\r?\n/, "")); }
    if (type.startsWith("multipart/alternative")) {
      // Alternatives are the same message in several formats: read one (plain text preferred), never both, or every line doubles.
      const subs = parts.map((p) => { const sub: EmlContent = { subject: "", from: "", text: "", pdfs: [] }; walk(p, sub, depth + 1); return { sub, html: /html/i.test(splitHeaders(p).headers["content-type"] ?? "") }; });
      const pick = subs.find((s) => !s.html && s.sub.text.trim()) ?? subs.find((s) => s.sub.text.trim());
      if (pick) out.text += (out.text ? "\n" : "") + pick.sub.text;
      for (const s of subs) out.pdfs.push(...s.sub.pdfs);
      return;
    }
    for (const p of parts) walk(p, out, depth + 1);
    return;
  }
  const bytes = decodeBody(body, headers["content-transfer-encoding"]);
  const name = param(headers["content-disposition"], "filename") ?? param(headers["content-type"], "name") ?? "";
  if (type.includes("application/pdf") || /\.pdf$/i.test(name)) {
    if (bytes.length) out.pdfs.push({ name: name || "attachment.pdf", data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
    return;
  }
  if (type.startsWith("text/")) {
    const charset = (param(headers["content-type"], "charset") ?? "utf-8").toLowerCase();
    let decoded: string;
    try { decoded = new TextDecoder(charset).decode(bytes); } catch { decoded = latin1(bytes); }
    const text = type.includes("html") ? stripHtml(decoded) : decoded;
    out.text += (out.text ? "\n" : "") + text;
  }
}

export function parseEml(buffer: ArrayBuffer): EmlContent {
  const raw = latin1(new Uint8Array(buffer));
  const { headers } = splitHeaders(raw);
  const out: EmlContent = { subject: headers["subject"] ?? "", from: headers["from"] ?? "", text: "", pdfs: [] };
  walk(raw, out);
  out.text = out.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
