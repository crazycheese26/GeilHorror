// Procedural Canvas Texture Generators for Steamboat Horror
// Zero external asset dependencies - Crisp, light, and 100% reliable!

export class TextureFactory {
  // 1. Dark Steamboat Wooden Deck Planks
  static createWoodDeck() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base dark weathered wood color (brightened for dark screen clarity)
    ctx.fillStyle = '#3c281c';
    ctx.fillRect(0, 0, 512, 512);

    const plankHeight = 64;
    for (let y = 0; y < 512; y += plankHeight) {
      // Individual plank shade variation
      const r = 58 + (Math.random() * 16 - 8);
      const g = 38 + (Math.random() * 12 - 6);
      const b = 28 + (Math.random() * 10 - 5);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, y, 512, plankHeight - 3);

      // Wood grain lines
      ctx.strokeStyle = 'rgba(15, 10, 5, 0.25)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const lineY = y + Math.random() * (plankHeight - 6);
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.bezierCurveTo(150, lineY + (Math.random() * 6 - 3), 350, lineY + (Math.random() * 6 - 3), 512, lineY);
        ctx.stroke();
      }

      // Plank seams / dark gaps
      ctx.fillStyle = '#140c06';
      ctx.fillRect(0, y + plankHeight - 3, 512, 3);

      // Iron nails
      for (let x = 32; x < 512; x += 128) {
        ctx.fillStyle = '#080503';
        ctx.beginPath();
        ctx.arc(x + (Math.random() * 6 - 3), y + 12, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + (Math.random() * 6 - 3), y + plankHeight - 16, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  // 2. Rusted Steamboat Metal Bulkhead Walls
  static createSteelWall() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base steamboat iron bulkhead
    ctx.fillStyle = '#323a42';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle brushed metal grain
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 200; i++) {
      const y = Math.random() * 512;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // Subtle rust & grime spots
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = 1 + Math.random() * 3.5;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(95, 48, 22, 0.14)' : 'rgba(12, 16, 20, 0.18)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Metal panel seams (vertical seams)
    ctx.strokeStyle = '#161b20';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 504, 504);
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.stroke();

    // Rivets along the edges
    const rivet = (x, y) => {
      ctx.fillStyle = '#111518';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#455058';
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 2, 0, Math.PI * 2);
      ctx.fill();
    };

    for (let y = 16; y < 512; y += 32) {
      rivet(12, y);
      rivet(250, y);
      rivet(262, y);
      rivet(500, y);
    }

    // Water grime drips from ceiling
    ctx.strokeStyle = 'rgba(25, 18, 12, 0.35)';
    ctx.lineWidth = 2;
    for (let x = 20; x < 500; x += 40) {
      if (Math.random() < 0.6) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() * 8 - 4), 60 + Math.random() * 120);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  // 3. Steamboat Industrial Ceiling
  static createCeiling() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#17191d';
    ctx.fillRect(0, 0, 512, 512);

    // Cross beams
    ctx.fillStyle = '#0f1114';
    ctx.fillRect(0, 240, 512, 32);
    ctx.fillRect(240, 0, 32, 512);

    // Copper pipe running across
    ctx.fillStyle = '#6e3c1b';
    ctx.fillRect(80, 0, 18, 512);
    ctx.fillStyle = '#a65d2c';
    ctx.fillRect(84, 0, 6, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  // 4. Sinterklaas Gift Wrap (Festive Red & Gold Dutch Present)
  static createPresentWrap() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Royal Sint Crimson
    ctx.fillStyle = '#990012';
    ctx.fillRect(0, 0, 512, 512);

    // Gold Sint star patterns
    ctx.fillStyle = '#d4af37';
    for (let x = 32; x < 512; x += 64) {
      for (let y = 32; y < 512; y += 64) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Thick Golden Ribbon Cross
    ctx.fillStyle = '#f3cf55';
    ctx.fillRect(220, 0, 72, 512);
    ctx.fillRect(0, 220, 512, 72);

    // Shiny gold ribbon highlights
    ctx.fillStyle = '#fff4a3';
    ctx.fillRect(240, 0, 12, 512);
    ctx.fillRect(0, 240, 512, 12);

    // Sinterklaas Gift Tag
    ctx.fillStyle = '#fdf8e2';
    ctx.fillRect(120, 120, 100, 60);
    ctx.strokeStyle = '#c5a059';
    ctx.lineWidth = 3;
    ctx.strokeRect(120, 120, 100, 60);
    ctx.fillStyle = '#8b0000';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('Van: SINT', 128, 145);
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText('Voor: Lief kind', 128, 165);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  // 5. Anime Body Pillow (Dakimakura) Textures (5 Distinct Waifus)
  static createAnimePillows() {
    const waifus = [
      {
        name: "Catgirl Sakura-chan",
        bg: ["#ffd1dc", "#ff9bb2"],
        hairColor: "#ff77a9",
        eyeColor: "#00b4d8",
        ears: true,
        dialogue: "NYA~! MR. GEIL PLEASE BE GENTLE!",
        mitre: false
      },
      {
        name: "Tsundere Asuka Maid",
        bg: ["#d8e2dc", "#b8c0ff"],
        hairColor: "#f77f00",
        eyeColor: "#2b9348",
        ears: false,
        dialogue: "B-BAKA! It's not like I like Geil!",
        mitre: false
      },
      {
        name: "Sint-chan (De Heilige Waifu)",
        bg: ["#ffccd5", "#c9184a"],
        hairColor: "#ffb703",
        eyeColor: "#023e8a",
        ears: false,
        dialogue: "Wie zoet is krijgt lekkers~",
        mitre: true
      },
      {
        name: "Goth Demon Senpai",
        bg: ["#240046", "#5a189a"],
        hairColor: "#9d4edd",
        eyeColor: "#ff0054",
        ears: true,
        dialogue: "Ara ara, Geil-kun...",
        mitre: false
      },
      {
        name: "Cyber Idol Miku-san",
        bg: ["#cbf3f0", "#2ec4b6"],
        hairColor: "#00f5d4",
        eyeColor: "#ff006e",
        ears: false,
        dialogue: "100% EXTRA GEIL POWER!",
        mitre: false
      }
    ];

    return waifus.map((waifu, idx) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 1024; // Tall Dakimakura ratio 1:2
      const ctx = canvas.getContext('2d');

      // Pillow gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, 1024);
      grad.addColorStop(0, waifu.bg[0]);
      grad.addColorStop(1, waifu.bg[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 1024);

      // Pillow seam / soft edge glow
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 14;
      ctx.strokeRect(10, 10, 492, 1004);

      // Sparkles in background
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let s = 0; s < 30; s++) {
        const sx = 30 + Math.random() * 452;
        const sy = 30 + Math.random() * 964;
        ctx.beginPath();
        ctx.arc(sx, sy, 3 + Math.random() * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Anime Character Head and Torso
      // Hair Backing
      ctx.fillStyle = waifu.hairColor;
      ctx.beginPath();
      ctx.ellipse(256, 320, 160, 200, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cat Ears if applicable
      if (waifu.ears) {
        ctx.fillStyle = waifu.hairColor;
        // Left ear
        ctx.beginPath();
        ctx.moveTo(140, 220);
        ctx.lineTo(100, 100);
        ctx.lineTo(200, 160);
        ctx.fill();
        ctx.fillStyle = '#ffb3c6';
        ctx.beginPath();
        ctx.moveTo(145, 200);
        ctx.lineTo(120, 120);
        ctx.lineTo(185, 165);
        ctx.fill();

        // Right ear
        ctx.fillStyle = waifu.hairColor;
        ctx.beginPath();
        ctx.moveTo(372, 220);
        ctx.lineTo(412, 100);
        ctx.lineTo(312, 160);
        ctx.fill();
        ctx.fillStyle = '#ffb3c6';
        ctx.beginPath();
        ctx.moveTo(367, 200);
        ctx.lineTo(392, 120);
        ctx.lineTo(327, 165);
        ctx.fill();
      }

      // Sinterklaas Mitre if Sint-chan
      if (waifu.mitre) {
        ctx.fillStyle = '#b7094c';
        ctx.beginPath();
        ctx.moveTo(180, 220);
        ctx.lineTo(256, 60);
        ctx.lineTo(332, 220);
        ctx.closePath();
        ctx.fill();

        // Gold cross on mitre
        ctx.fillStyle = '#ffb703';
        ctx.fillRect(248, 90, 16, 110);
        ctx.fillRect(216, 130, 80, 16);
      }

      // Face
      ctx.fillStyle = '#ffeedd';
      ctx.beginPath();
      ctx.ellipse(256, 350, 125, 140, 0, 0, Math.PI * 2);
      ctx.fill();

      // Chin taper
      ctx.beginPath();
      ctx.moveTo(160, 390);
      ctx.quadraticCurveTo(256, 520, 352, 390);
      ctx.fill();

      // Hair Bangs (Fringe)
      ctx.fillStyle = waifu.hairColor;
      for (let b = 150; b <= 350; b += 35) {
        ctx.beginPath();
        ctx.moveTo(b, 240);
        ctx.lineTo(b + 18, 340 + Math.sin(b) * 20);
        ctx.lineTo(b + 38, 240);
        ctx.fill();
      }

      // Blushing Cheeks
      ctx.fillStyle = 'rgba(255, 105, 180, 0.45)';
      ctx.beginPath();
      ctx.ellipse(190, 390, 28, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(322, 390, 28, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      // Anime Big Eyes
      const drawEye = (cx, cy) => {
        // White sclera
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 32, 42, 0, 0, Math.PI * 2);
        ctx.fill();

        // Iris
        ctx.fillStyle = waifu.eyeColor;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 4, 24, 32, 0, 0, Math.PI * 2);
        ctx.fill();

        // Pupil
        ctx.fillStyle = '#111111';
        ctx.beginPath();
        ctx.arc(cx, cy + 4, 12, 0, Math.PI * 2);
        ctx.fill();

        // Sparkle catchlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 8, cy - 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + 8, cy + 12, 4, 0, Math.PI * 2);
        ctx.fill();

        // Eyelashes
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy - 8, 34, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      };

      drawEye(205, 340);
      drawEye(307, 340);

      // Cute anime mouth
      ctx.strokeStyle = '#c9184a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(256, 420, 14, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Body / Dress
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(170, 520);
      ctx.lineTo(256, 480);
      ctx.lineTo(342, 520);
      ctx.lineTo(380, 850);
      ctx.lineTo(132, 850);
      ctx.closePath();
      ctx.fill();

      // Ribbon / Dress accents
      ctx.fillStyle = waifu.hairColor;
      ctx.fillRect(180, 580, 152, 24);
      ctx.beginPath();
      ctx.arc(256, 592, 20, 0, Math.PI * 2);
      ctx.fill();

      // Legs / Thigh-high socks
      ctx.fillStyle = '#222';
      ctx.fillRect(180, 850, 60, 150);
      ctx.fillRect(272, 850, 60, 150);

      // Dialogue Banner
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(20, 920, 472, 70);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 920, 472, 70);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(waifu.name, 256, 948);
      ctx.fillStyle = '#ffb3c6';
      ctx.font = 'italic 16px sans-serif';
      ctx.fillText(`"${waifu.dialogue}"`, 256, 974);

      const texture = new THREE.CanvasTexture(canvas);
      return {
        id: idx,
        name: waifu.name,
        quote: waifu.dialogue,
        texture: texture,
        canvas: canvas
      };
    });
  }

  // 6. Tribute Altar Texture
  static createAltarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Royal Red Velvet
    ctx.fillStyle = '#590d15';
    ctx.fillRect(0, 0, 512, 512);

    // Golden Embroidery Border
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 16;
    ctx.strokeRect(24, 24, 464, 464);

    // Inner gold filigree
    ctx.strokeStyle = '#f5df7a';
    ctx.lineWidth = 4;
    ctx.strokeRect(48, 48, 416, 416);

    // Golden Sinterklaas Insignia & "TRIBUTE TO MR. GEIL"
    ctx.fillStyle = '#f5df7a';
    ctx.font = 'bold 32px serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦ SINT & GEIL ✦', 256, 200);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#ffeedd';
    ctx.fillText('SACRED OFFERING SHRINE', 256, 260);

    ctx.font = 'italic 18px sans-serif';
    ctx.fillStyle = '#ff99aa';
    ctx.fillText('Place 5 Anime Body Pillows to appease Mr. Geil', 256, 310);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  // 7. Burlap Sinterklaas Sacks (Pepernoten Zakken)
  static createBurlapSack() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#9c7a4b';
    ctx.fillRect(0, 0, 256, 256);

    // Weave lines
    ctx.strokeStyle = 'rgba(70, 50, 25, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 6) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i); ctx.lineTo(256, i);
      ctx.stroke();
    }

    // Ink Stencil
    ctx.fillStyle = '#221508';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SINT', 128, 110);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('PEPERNOTEN', 128, 145);

    return new THREE.CanvasTexture(canvas);
  }
}
