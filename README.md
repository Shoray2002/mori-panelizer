# Mori Panelizer

IFC viewer and CLT panelization tool. Load a building model, isolate it by
storey, and extract flat panelizable surfaces (floor/roof slabs and walls) for
the grid-layout stage.

Built on [That Open Engine](https://github.com/ThatOpen/engine_components) v3,
React 18, Three.js, Zustand, and Tailwind 4.

Deployed at https://mori-panelizer.surge.sh/

## Requirements

- Node 18+ and npm

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

Open the URL, drop an `.ifc` file onto the page (or click to browse).

## Using it

1. **Load** an IFC — the model frames itself in an isometric ortho view.
2. **Camera / Filters** — toggle ortho/perspective; show/hide structural
   categories. The lower-right gimbal snaps the view to any axis.
3. **Extract surfaces** — fits each slab and wall to a flat plate and merges
   coplanar pieces into whole surfaces.
4. **Storeys** — click a level to isolate it. Expand it for nested
   **Horizontal** (slab/roof, blue) and **Vertical** (wall, green) groups; click
   a surface to isolate, frame, and flatten the camera onto it. The two type
   toggles show/hide each orientation's overlay. **Show all** clears the focus.

Click a surface directly in the 3D view to select it (same as the list).

## Other commands

```bash
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
npm test         # run the geometry/plate-fit unit tests
```
