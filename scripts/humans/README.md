# The people's kit

The 3D view's people are MakeHuman's parametric human, rebuilt for the browser. MakeHuman's assets (the hm08
base mesh, its targets, the default skeleton's weights, and the CC0 system asset pack: clothes, hair,
eyebrows, eyelashes, eyes, skins, proxy meshes) are CC0 1.0; only the data is used, none of its (AGPL) code.

```
bun scripts/humans/fetch.ts        # data/makehuman: the repository at a fixed commit, the asset pack
python3 scripts/humans/build.py    # src/client/render3d/assets/people/: kit.bin and the textures
```

(Python 3 with numpy and Pillow; about 40 s.)

- `mh.py` reads MakeHuman's files and evaluates a body as MakeHuman does (macro targets by sex, age,
  muscle, weight and ancestry).
- `build.py` writes the kit: the vertices the client needs, the macro targets (dense or sparse, 16-bit)
  and face and body detail targets, each with the joints' displacement; the skeleton (MakeHuman joints are
  means of vertex sets, so every target moves them) and weights merged onto the animator's bones (fingers
  kept for the rest pose's relaxed curl); proxies with their bindings and weights: eyes, eyebrows,
  eyelashes, hair, clothes (MakeHuman's outfits cut into garments, plus shorts cut from the jeans,
  MakeHuman's tights and skirt helpers as a onesie, skirts and a coat's tails, and hats from the earlier
  model, `hats.json`), and the light bodies for distance with each garment's coverage.
- `skin.py` makes the skin maps: two photographs' colour relative to their own tone (light and dark skin,
  log2 in 8 bits), the scalp cleared of painted hair and the inside of the mouth darkened; and the fields
  (hair on the scalp, beard, age lines and the receding order, the grain of short hair).
- `clothes.py` cuts outfits into garments, shares out the body each hides, and keeps each garment's
  texture as shading (prints painted out) for any colour.
- `preview_blend.py` renders bodies in Blender (a check without the client).

The client (`src/client/render3d/body/`, `humans.ts`) shapes each person from the kit (a few milliseconds),
poses the body into the animator's rest pose about its own joints, scales it to the person's height, and
fits the proxies the way MakeHuman does. `scripts/poselab/` shows it: `index.html?scene=ages|faces|wardrobe|
walk|stand|sit|talk`, `bodies.html` for bare shapes.
