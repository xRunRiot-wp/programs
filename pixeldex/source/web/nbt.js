// Minimal NBT reader for Pixelmon's .pokedex files (plain or gzipped, big-endian).
window.PixelNBT = (() => {
  async function maybeGunzip(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0x1f && b[1] === 0x8b) {
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([b]).stream().pipeThrough(ds);
      return await new Response(stream).arrayBuffer();
    }
    return buf;
  }

  function parse(buf) {
    const v = new DataView(buf);
    const dec = new TextDecoder('utf-8');
    let o = 0;
    const str = () => { const n = v.getUint16(o); o += 2; const s = dec.decode(new Uint8Array(buf, o, n)); o += n; return s; };
    function payload(t) {
      switch (t) {
        case 1: return v.getInt8(o++);
        case 2: { const x = v.getInt16(o); o += 2; return x; }
        case 3: { const x = v.getInt32(o); o += 4; return x; }
        case 4: { const x = Number(v.getBigInt64(o)); o += 8; return x; }
        case 5: { const x = v.getFloat32(o); o += 4; return x; }
        case 6: { const x = v.getFloat64(o); o += 8; return x; }
        case 7: { const n = v.getInt32(o); o += 4; const a = Array.from(new Int8Array(buf, o, n)); o += n; return a; }
        case 8: return str();
        case 9: { const et = v.getInt8(o++); const n = v.getInt32(o); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
        case 10: {
          const obj = {};
          for (;;) {
            const tt = v.getInt8(o++);
            if (tt === 0) return obj;
            const name = str();
            obj[name] = payload(tt);
          }
        }
        case 11: { const n = v.getInt32(o); o += 4; const a = []; for (let i = 0; i < n; i++) { a.push(v.getInt32(o)); o += 4; } return a; }
        case 12: { const n = v.getInt32(o); o += 4; const a = []; for (let i = 0; i < n; i++) { a.push(Number(v.getBigInt64(o))); o += 8; } return a; }
        default: throw new Error('Unknown NBT tag ' + t);
      }
    }
    const rootType = v.getInt8(o++);
    if (rootType !== 10) throw new Error('Not an NBT file');
    str();
    return payload(10);
  }

  // Returns [{ndex, form, palette, gender, caught, seen}]
  async function readPokedex(arrayBuffer) {
    const root = parse(await maybeGunzip(arrayBuffer));
    const out = [];
    for (const dex of root.pokedexes || []) {
      for (const st of dex.statuses || []) {
        const sd = st.status_data || {};
        out.push({
          ndex: Number(st.ndex),
          form: String(st.Variant || 'base').toLowerCase(),
          palette: String(st.palette || 'none').toLowerCase(),
          gender: Number(st.Gender || 0),
          caught: !!Number(sd.caught || 0),
          seen: !!Number(sd.seen || 0),
        });
      }
    }
    return out;
  }

  return { parse, readPokedex };
})();
