// Procedural canvas textures for the stoomboot.
// Everything except the Mr. Geil sketch is drawn at runtime, so there are no
// image files to go missing on a static host.

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

  // Deliberately garish. The joke only lands if they clash with the ship.
  static createAnimePillows() {
    const waifus = [
      { name: 'Catgirl Sakura-chan',    bg: ['#ffd1dc', '#ff9bb2'], hair: '#ff77a9', eye: '#00b4d8', ears: true,  mitre: false, quote: 'Nya~! Mr. Geil, wees voorzichtig!' },
      { name: 'Tsundere Asuka Maid',    bg: ['#d8e2dc', '#b8c0ff'], hair: '#f77f00', eye: '#2b9348', ears: false, mitre: false, quote: "B-baka! It's not like I like Geil!" },
      { name: 'Sint-chan',              bg: ['#ffccd5', '#c9184a'], hair: '#ffb703', eye: '#023e8a', ears: false, mitre: true,  quote: 'Wie zoet is krijgt lekkers~' },
      { name: 'Goth Demon Senpai',      bg: ['#240046', '#5a189a'], hair: '#9d4edd', eye: '#ff0054', ears: true,  mitre: false, quote: 'Ara ara, Geil-kun...' },
      { name: 'Cyber Idol Miku-san',    bg: ['#cbf3f0', '#2ec4b6'], hair: '#00f5d4', eye: '#ff006e', ears: false, mitre: false, quote: '100% EXTRA GEIL POWER!' },
      { name: 'Pepernoot Onee-san',     bg: ['#f6e2c8', '#c98f4a'], hair: '#6b3410', eye: '#a3320b', ears: false, mitre: false, quote: 'Strooi mij, senpai!' },
      { name: 'Stoomboot Kapitein-chan',bg: ['#cfe3f2', '#4a6fa5'], hair: '#123a63', eye: '#ffd166', ears: false, mitre: false, quote: 'Volle kracht vooruit, Geil-sama!' },
      { name: 'Marsepein Mahou-shoujo', bg: ['#ffe9f0', '#f7a8c4'], hair: '#ffd6e8', eye: '#c04a7a', ears: false, mitre: false, quote: 'Transformatie: EXTRA GEIL!' },
      { name: 'Chocoladeletter Senpai', bg: ['#e8d3bd', '#6b4224'], hair: '#3b2113', eye: '#c98f4a', ears: false, mitre: false, quote: 'Ik ben een S. Voor Senpai.' },
      { name: 'Stroopwafel Yandere',    bg: ['#f4dfa8', '#a8762c'], hair: '#7a4a18', eye: '#d92b2b', ears: false, mitre: false, quote: 'Je gaat nergens heen, Geil-kun.' }
    ];

    return waifus.map((w, idx) => {
      const { canvas, ctx } = makeCtx(512, 1024);

      const grad = ctx.createLinearGradient(0, 0, 0, 1024);
      grad.addColorStop(0, w.bg[0]);
      grad.addColorStop(1, w.bg[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 1024);

      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 14;
      ctx.strokeRect(10, 10, 492, 1004);

      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let s = 0; s < 30; s++) {
        ctx.beginPath();
        ctx.arc(rnd(30, 482), rnd(30, 994), rnd(3, 7), 0, TAU);
        ctx.fill();
      }

      ctx.fillStyle = w.hair;
      ctx.beginPath();
      ctx.ellipse(256, 320, 160, 200, 0, 0, TAU);
      ctx.fill();

      if (w.ears) {
        const ear = (x1, y1, x2, y2, x3, y3, ix1, iy1, ix2, iy2, ix3, iy3) => {
          ctx.fillStyle = w.hair;
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
          ctx.fill();
          ctx.fillStyle = '#ffb3c6';
          ctx.beginPath();
          ctx.moveTo(ix1, iy1); ctx.lineTo(ix2, iy2); ctx.lineTo(ix3, iy3);
          ctx.fill();
        };
        ear(140, 220, 100, 100, 200, 160, 145, 200, 120, 120, 185, 165);
        ear(372, 220, 412, 100, 312, 160, 367, 200, 392, 120, 327, 165);
      }

      if (w.mitre) {
        ctx.fillStyle = '#b7094c';
        ctx.beginPath();
        ctx.moveTo(180, 220); ctx.lineTo(256, 60); ctx.lineTo(332, 220);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffb703';
        ctx.fillRect(248, 90, 16, 110);
        ctx.fillRect(216, 130, 80, 16);
      }

      ctx.fillStyle = '#ffeedd';
      ctx.beginPath();
      ctx.ellipse(256, 350, 125, 140, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(160, 390);
      ctx.quadraticCurveTo(256, 520, 352, 390);
      ctx.fill();

      ctx.fillStyle = w.hair;
      for (let b = 150; b <= 350; b += 35) {
        ctx.beginPath();
        ctx.moveTo(b, 240);
        ctx.lineTo(b + 18, 340 + Math.sin(b) * 20);
        ctx.lineTo(b + 38, 240);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(255, 105, 180, 0.45)';
      ctx.beginPath(); ctx.ellipse(190, 390, 28, 16, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(322, 390, 28, 16, 0, 0, TAU); ctx.fill();

      const drawEye = (cx, cy) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx, cy, 32, 42, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = w.eye;
        ctx.beginPath(); ctx.ellipse(cx, cy + 4, 24, 32, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#111111';
        ctx.beginPath(); ctx.arc(cx, cy + 4, 12, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - 8, cy - 8, 8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 8, cy + 12, 4, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(cx, cy - 8, 34, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      };
      drawEye(205, 340);
      drawEye(307, 340);

      ctx.strokeStyle = '#c9184a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(256, 420, 14, 0.2, Math.PI - 0.2);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(170, 520); ctx.lineTo(256, 480); ctx.lineTo(342, 520);
      ctx.lineTo(380, 850); ctx.lineTo(132, 850);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = w.hair;
      ctx.fillRect(180, 580, 152, 24);
      ctx.beginPath(); ctx.arc(256, 592, 20, 0, TAU); ctx.fill();

      ctx.fillStyle = '#222';
      ctx.fillRect(180, 850, 60, 150);
      ctx.fillRect(272, 850, 60, 150);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
      ctx.fillRect(20, 918, 472, 74);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 918, 472, 74);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(w.name, 256, 948);
      ctx.fillStyle = '#ffb3c6';
      ctx.font = 'italic 16px sans-serif';
      ctx.fillText(`"${w.quote}"`, 256, 976);

      const texture = new THREE.CanvasTexture(canvas);
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = TextureFactory.maxAnisotropy;

      return { id: idx, name: w.name, quote: w.quote, texture, canvas };
    });
  }
}
