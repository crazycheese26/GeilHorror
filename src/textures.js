// Procedural canvas textures for the stoomboot.
// Everything except the Mr. Geil sketch and the pillow art is drawn at
// runtime, so there are few image files to go missing on a static host.

const TAU = Math.PI * 2;

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function makeCtx(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// Speckled grain pass. Keeps flat fills from reading as plastic.
function grain(ctx, w, h, count, dark, light) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = rnd(0.5, 2.6);
    ctx.fillStyle = Math.random() > 0.5 ? dark : light;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// Vertical grime running down from the top edge.
function drips(ctx, w, h, count, style, maxLen) {
  ctx.strokeStyle = style;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    ctx.lineWidth = rnd(1, 4);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + rnd(-6, 6), rnd(maxLen * 0.25, maxLen));
    ctx.stroke();
  }
}

export class TextureFactory {
  // Set by the renderer once it exists; sharpens floors at grazing angles.
  static maxAnisotropy = 1;

  static _finish(canvas, repeatX = 1, repeatY = 1) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = TextureFactory.maxAnisotropy;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  // --- Deck ------------------------------------------------------------

  static createDeckPlanks() {
    const { canvas, ctx } = makeCtx(512, 512);

    ctx.fillStyle = '#241811';
    ctx.fillRect(0, 0, 512, 512);

    const plankH = 64;
    for (let y = 0; y < 512; y += plankH) {
      const r = 44 + rnd(-9, 9);
      const g = 30 + rnd(-6, 6);
      const b = 22 + rnd(-5, 5);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(0, y, 512, plankH - 3);

      ctx.strokeStyle = 'rgba(10, 6, 3, 0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const lineY = y + Math.random() * (plankH - 6);
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.bezierCurveTo(150, lineY + rnd(-3, 3), 350, lineY + rnd(-3, 3), 512, lineY);
        ctx.stroke();
      }

      // Caulked seam between planks.
      ctx.fillStyle = '#0b0704';
      ctx.fillRect(0, y + plankH - 3, 512, 3);

      for (let x = 32; x < 512; x += 128) {
        ctx.fillStyle = '#0a0705';
        ctx.beginPath();
        ctx.arc(x + rnd(-3, 3), y + 12, 2.5, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + rnd(-3, 3), y + plankH - 16, 2.5, 0, TAU);
        ctx.fill();
      }
    }

    // Standing bilge water pooling in the low spots.
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const grd = ctx.createRadialGradient(x, y, 4, x, y, rnd(50, 110));
      grd.addColorStop(0, 'rgba(8, 12, 12, 0.55)');
      grd.addColorStop(1, 'rgba(8, 12, 12, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 512, 512);
    }

    grain(ctx, 512, 512, 900, 'rgba(0,0,0,0.22)', 'rgba(120,95,70,0.06)');
    return TextureFactory._finish(canvas);
  }

  // --- Bulkheads -------------------------------------------------------

  // One generator, five compartment looks. Each zone gets its own palette and
  // stencil so the corridors stop being interchangeable.
  static createBulkhead(zone) {
    const palettes = {
      fore:    { base: '#2b3239', seam: '#12161a', rivet: '#3c464e', rust: 'rgba(96, 48, 20, 0.16)', stencil: 'VOORDEK',      code: 'A-1' },
      engine:  { base: '#33261d', seam: '#150e09', rivet: '#4a382a', rust: 'rgba(140, 62, 18, 0.26)', stencil: 'MACHINEKAMER', code: 'B-2' },
      cargo:   { base: '#2f2a20', seam: '#141109', rivet: '#453d2e', rust: 'rgba(90, 66, 24, 0.16)', stencil: 'VRACHTRUIM',   code: 'C-3' },
      bilge:   { base: '#1e2724', seam: '#0a0f0d', rivet: '#2e3a35', rust: 'rgba(48, 74, 46, 0.22)', stencil: 'BILGE',        code: 'D-4' },
      shrine:  { base: '#2a1618', seam: '#120809', rivet: '#3d2124', rust: 'rgba(120, 20, 24, 0.20)', stencil: 'HET RUIM',    code: '†' }
    };
    const p = palettes[zone] || palettes.fore;

    const { canvas, ctx } = makeCtx(512, 512);

    ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, 512, 512);

    // Brushed grain.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const y = Math.random() * 512;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // Rust blooms.
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const grd = ctx.createRadialGradient(x, y, 1, x, y, rnd(14, 58));
      grd.addColorStop(0, p.rust);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 512, 512);
    }

    grain(ctx, 512, 512, 420, 'rgba(0,0,0,0.20)', 'rgba(255,255,255,0.035)');

    // Panel seams.
    ctx.strokeStyle = p.seam;
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, 506, 506);
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.stroke();

    const rivet = (x, y) => {
      ctx.fillStyle = p.seam;
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.rivet;
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 1.9, 0, TAU);
      ctx.fill();
    };
    for (let y = 16; y < 512; y += 32) {
      rivet(11, y);
      rivet(249, y);
      rivet(263, y);
      rivet(501, y);
    }

    // Compartment stencil. Worn, low contrast, never shouting.
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#e8dfcb';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px "Arial Narrow", Impact, sans-serif';
    ctx.fillText(p.stencil, 128, 300);
    ctx.font = 'bold 74px "Arial Narrow", Impact, sans-serif';
    ctx.fillText(p.code, 384, 300);
    ctx.restore();

    drips(ctx, 512, 512, 22, 'rgba(14, 10, 6, 0.30)', 190);

    return TextureFactory._finish(canvas);
  }

  // --- Overhead --------------------------------------------------------

  static createOverhead() {
    const { canvas, ctx } = makeCtx(512, 512);

    ctx.fillStyle = '#12151a';
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 238, 512, 36);
    ctx.fillRect(238, 0, 36, 512);

    // Copper steam line with a highlight so it reads as round.
    ctx.fillStyle = '#4a2a13';
    ctx.fillRect(78, 0, 20, 512);
    ctx.fillStyle = '#7d4a22';
    ctx.fillRect(83, 0, 7, 512);
    ctx.fillStyle = '#a9683a';
    ctx.fillRect(85, 0, 2, 512);

    // Conduit bundle.
    ctx.fillStyle = '#191d22';
    ctx.fillRect(400, 0, 6, 512);
    ctx.fillRect(410, 0, 6, 512);
    ctx.fillRect(420, 0, 6, 512);

    grain(ctx, 512, 512, 500, 'rgba(0,0,0,0.3)', 'rgba(255,255,255,0.02)');
    return TextureFactory._finish(canvas);
  }

  // --- Props -----------------------------------------------------------

  static createPresentWrap() {
    const { canvas, ctx } = makeCtx(512, 512);

    ctx.fillStyle = '#6d0a14';
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = 'rgba(196, 158, 66, 0.75)';
    for (let x = 32; x < 512; x += 64) {
      for (let y = 32; y < 512; y += 64) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, TAU);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#b8912f';
    ctx.fillRect(222, 0, 68, 512);
    ctx.fillRect(0, 222, 512, 68);
    ctx.fillStyle = '#d8b654';
    ctx.fillRect(240, 0, 10, 512);
    ctx.fillRect(0, 240, 512, 10);

    // Gift tag, foxed with age.
    ctx.fillStyle = '#ddd2b4';
    ctx.fillRect(118, 116, 104, 64);
    ctx.strokeStyle = '#8d7434';
    ctx.lineWidth = 3;
    ctx.strokeRect(118, 116, 104, 64);
    ctx.fillStyle = '#5c0a12';
    ctx.font = 'bold 16px Georgia, serif';
    ctx.fillText('Van: SINT', 128, 142);
    ctx.fillStyle = '#3a3128';
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillText('Voor: lief kind', 128, 164);

    grain(ctx, 512, 512, 700, 'rgba(0,0,0,0.30)', 'rgba(255,240,200,0.05)');
    return TextureFactory._finish(canvas);
  }

  static createBurlapSack() {
    const { canvas, ctx } = makeCtx(256, 256);

    ctx.fillStyle = '#6b5232';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(40, 28, 14, 0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i); ctx.lineTo(256, i);
      ctx.stroke();
    }

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1a1108';
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px "Arial Narrow", Impact, sans-serif';
    ctx.fillText('SINT', 128, 112);
    ctx.font = 'bold 19px "Arial Narrow", Impact, sans-serif';
    ctx.fillText('PEPERNOTEN', 128, 144);
    ctx.restore();

    grain(ctx, 256, 256, 400, 'rgba(0,0,0,0.28)', 'rgba(200,170,120,0.07)');
    return TextureFactory._finish(canvas);
  }

  static createAltarCloth() {
    const { canvas, ctx } = makeCtx(512, 512);

    ctx.fillStyle = '#3d0910';
    ctx.fillRect(0, 0, 512, 512);

    // Velvet nap.
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(120, 22, 34, 0.10)' : 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rnd(-4, 4), y + rnd(-4, 4));
      ctx.stroke();
    }

    ctx.strokeStyle = '#9c7a2c';
    ctx.lineWidth = 12;
    ctx.strokeRect(26, 26, 460, 460);
    ctx.strokeStyle = '#c2a049';
    ctx.lineWidth = 3;
    ctx.strokeRect(48, 48, 416, 416);

    ctx.fillStyle = '#c2a049';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillText('SINT † GEIL', 256, 216);
    ctx.font = 'italic 19px Georgia, serif';
    ctx.fillStyle = 'rgba(216, 210, 196, 0.7)';
    ctx.fillText('vijf offers, dan mag je gaan', 256, 268);

    grain(ctx, 512, 512, 500, 'rgba(0,0,0,0.3)', 'rgba(190,150,70,0.05)');
    return TextureFactory._finish(canvas);
  }

  // --- Mr. Geil --------------------------------------------------------

  // The source sketch is opaque pen-on-paper. Drop the paper to alpha and keep
  // only the ink, so he reads as a drawn thing loose in the dark rather than a
  // lit rectangle. Returns a texture whose ink is recolored to `inkColor`.
  static keyOutPaper(image, inkColor = [232, 226, 210]) {
    const { canvas, ctx } = makeCtx(image.width, image.height);
    ctx.drawImage(image, 0, 0);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    const [ir, ig, ib] = inkColor;

    for (let i = 0; i < px.length; i += 4) {
      // Perceptual luminance: paper is bright, ink is not.
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      // Fully opaque below 0.35, fully gone above 0.72, smooth between.
      const t = Math.min(1, Math.max(0, (lum - 0.35) / (0.72 - 0.35)));
      const alpha = 1 - t * t * (3 - 2 * t); // smoothstep
      px[i] = ir;
      px[i + 1] = ig;
      px[i + 2] = ib;
      px[i + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(data, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = TextureFactory.maxAnisotropy;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  // A crewmate's name, floating over their head. Drawn rather than modelled:
  // one small canvas per player, made once when they join.
  static createNameplate(text, colour = '#d9d3c4') {
    const label = String(text || '').slice(0, 14).toUpperCase();
    const { canvas, ctx } = makeCtx(256, 64);

    ctx.font = '600 30px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A dark outline first, so a pale name still reads against a lit bulkhead.
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(4, 6, 9, 0.9)';
    ctx.strokeText(label, 128, 34);
    ctx.fillStyle = colour;
    ctx.fillText(label, 128, 34);

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  // Soft radial blob for the contact shadow under Mr. Geil.
  static createBlobShadow() {
    const { canvas, ctx } = makeCtx(128, 128);
    const grd = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  // --- Anime body pillows -----------------------------------------------

  // Real character art, loaded from assets/pillows/. Deliberately garish
  // choices — the joke only lands if they clash with the ship.
  static createAnimePillows() {
    const waifus = [
      { name: 'Catgirl Sakura-chan',     file: 'catgirl-sakura.jpg',          quote: 'Nya~! Mr. Geil, wees voorzichtig!' },
      { name: 'Tsundere Asuka Maid',     file: 'tsundere-asuka-maid.jpg',     quote: "B-baka! It's not like I like Geil!" },
      { name: 'Sint-chan',               file: 'sint-chan.jpg',               quote: 'Wie zoet is krijgt lekkers~' },
      { name: 'Goth Demon Senpai',       file: 'goth-demon-senpai.jpg',       quote: 'Ara ara, Geil-kun...' },
      { name: 'Cyber Idol Miku-san',     file: 'cyber-idol-miku.jpg',         quote: '100% EXTRA GEIL POWER!' },
      { name: 'Pepernoot Onee-san',      file: 'pepernoot-oneesan.jpg',       quote: 'Strooi mij, senpai!' },
      { name: 'Stoomboot Kapitein-chan', file: 'stoomboot-kapitein.jpg',      quote: 'Volle kracht vooruit, Geil-sama!' },
      { name: 'Marsepein Mahou-shoujo',  file: 'marsepein-mahou-shoujo.png',  quote: 'Transformatie: EXTRA GEIL!' },
      { name: 'Chocoladeletter Senpai',  file: 'chocoladeletter-senpai.jpg',  quote: 'Ik ben een S. Voor Senpai.' },
      { name: 'Stroopwafel Yandere',     file: 'stroopwafel-yandere.jpg',     quote: 'Je gaat nergens heen, Geil-kun.' }
    ];

    return waifus.map((w, idx) => {
      // Texture exists immediately so callers can hand it to a material
      // before the image arrives; the image swap just updates it in place.
      const texture = new THREE.Texture();
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = TextureFactory.maxAnisotropy;

      const img = new Image();
      img.onload = () => {
        texture.image = img;
        texture.needsUpdate = true;
      };
      img.onerror = () => console.warn(`assets/pillows/${w.file} failed to load`);
      img.src = `assets/pillows/${w.file}`;

      return { id: idx, name: w.name, quote: w.quote, texture };
    });
  }
}
