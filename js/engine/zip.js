// Archivo .zip sin compresión (método «store»), sin dependencias.
// Basta para descargar un proyecto (tres archivos de texto pequeños) y lo abren el Explorador de
// Windows, el Finder de macOS y cualquier descompresor. Los nombres van en UTF-8 (bit 11).
// tests/zip.test.mjs lo descomprime con Expand-Archive (PowerShell) y con tar.

import { FILES, LANGS } from "./projects.js";

let crcTable = null;

export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fecha y hora en formato MS-DOS (resolución de 2 s, desde 1980).
function dosDateTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// entries: [{ name: "carpeta/index.html", data: string | Uint8Array }]. Los nombres que acaban en
// «/» son carpetas. Devuelve un Uint8Array con el .zip.
export function makeZip(entries, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const isDir = entry.name.endsWith("/");
    const data = isDir ? new Uint8Array(0) : typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versión necesaria (2.0)
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin compresión
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // creado con la versión 2.0 (MS-DOS)
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true); // extra
    central.setUint16(32, 0, true); // comentario
    central.setUint16(34, 0, true); // disco
    central.setUint16(36, 0, true); // atributos internos
    central.setUint32(38, isDir ? 0x10 : 0, true); // atributos externos (0x10 = carpeta)
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// .zip de un proyecto: la carpeta `project.folder` con index.html, style.css y script.js.
export function projectZip(project, files, date = new Date()) {
  const folder = project?.folder || "my-project";
  const entries = [{ name: `${folder}/` }];
  for (const lang of LANGS) entries.push({ name: `${folder}/${FILES[lang]}`, data: String(files?.[lang] ?? "") });
  return makeZip(entries, date);
}
