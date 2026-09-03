# Geil the Game 👻 (3D Horror Game)
*De donkere gangen van de stoomboot van Sinterklaas*

A 3D first-person horror web game built with Three.js and Web Audio API. 
The entire game is 100% self-contained with **zero build steps** — ready to be pushed to GitHub and hosted on **GitHub Pages** immediately!

---

## 📖 The Story

You find yourself trapped in the dark, creaking corridors of **de stoomboot van Sinterklaas**.
A menacing creature known as **Mr. Geil** follows you through the shadows. 
**He needs to eat you to become *extra geil*!**

### How do you escape?
1. Explore the dark steamship corridors.
2. Find wrapped **Sint presents** scattered around the ship.
3. Unwrap the presents to uncover **5 legendary anime body pillows** (*dakimakura*).
4. Bring all 5 anime body pillows to the **Sacred Tribute Altar** located in the central hold.
5. Place the pillows as an offering: **Mr. Geil is very pleased with the anime body pillows**, which allows you to escape into the night!

---

## 🎮 Controls

Strictly designed per requirements:
- **`W`** or **`↑` (Up Arrow)**: Move Forward
- **`S`** or **`↓` (Down Arrow)**: Move Backward
- **`A`** or **`←` (Left Arrow)**: Turn Camera Left
- **`D`** or **`→` (Right Arrow)**: Turn Camera Right
- **`Shift`**: Sprint (uses stamina meter)
- **`E`** / **`Space`** / **`Click`**: Interact (Unwrap Sint presents & activate the Tribute Altar)

---

## 🚀 How to Deploy on GitHub Pages

Because this game requires **zero build steps**, you can publish it in seconds:

1. **Commit and Push** this entire folder to your GitHub repository:
   ```bash
   git add .
   git commit -m "Add Geil the Game"
   git push origin main
   ```
2. On GitHub, go to your repository **Settings**.
3. In the left sidebar, click **Pages** (under "Code and automation").
4. Under **Build and deployment**:
   - Source: `Deploy from a branch`
   - Branch: `main` (or `master`) and folder: `/ (root)`
   - Click **Save**.
5. Within 1 minute, GitHub will give you your live URL (e.g. `https://<username>.github.io/<repo-name>/`).
6. Open the link and play!

---

## 💻 Local Testing

To test the game locally on your computer:
```bash
# In the project directory:
python3 -m http.server 8000
```
Then visit `http://localhost:8000` in your web browser.

---

## 🎨 Features & Tech Stack
- **Three.js (r128)**: 3D corridors, real-time lighting, dynamic shadows, volumetric fog, and 3D item models.
- **Web Audio API**: 100% procedural audio engine (no external audio files to break on GitHub Pages!). Includes steam engine rumble, footstep creaks, minor-key Sinterklaas music box melody, proximity heartbeat, unwrapping chimes, and terrifying jumpscare stingers.
- **Custom Mr. Geil Monster**: Animated 3D billboard sprite created directly from the hand-drawn sketch with stalking/chasing AI.
- **5 Unique Waifu Body Pillows**: Procedurally illustrated dakimakura textures with funny anime quotes.
- **Enhanced Lighting System**: Calibrated global illumination with warm flashlight, brushed metal walls, and clear visibility optimized for dark monitors without eye strain.
