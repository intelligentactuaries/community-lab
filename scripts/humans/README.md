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
  texture as shading (prints painted out) for any colour. The suit is one garment in three colours: which
  of them (jacket, shirt, tie) each texel takes is read from its texture and kept in the atlas's green.
  The women's tops are lengthened (their hems and the rows above them moved down the body and bound
  again) so they reach over the waistband of jeans and shorts, not only a high skirt; the knee-length
  skirt and the coat's tails are cut after a whole ring of MakeHuman's skirt tube (a clean hem), the
  tails open down the front.
- `preview_blend.py` renders bodies in Blender (a check without the client).

The client (`src/client/render3d/body/`, `humans.ts`) shapes each person from the kit (a few milliseconds),
poses the body into the animator's rest pose about its own joints, scales it to the person's height, and
fits the proxies the way MakeHuman does. Then it dresses them (`body/dressing.ts`): the garments, which
come from different outfits and so cross wherever they meet, are laid from the skin out, each lifted
clear of the skin and of what is worn under it, and what lies well under an outer layer is not drawn.
`scripts/poselab/` shows it: `index.html?scene=ages|faces|wardrobe|walk|stand|sit|talk`, `scene=fit` for
any outfit standing, walking and sitting (`&wear=f_blouse,f_jeans,shoes01&sex=F&arms=crossed`, `&orbit=`
degrees round a figure), `bodies.html` for bare shapes.
