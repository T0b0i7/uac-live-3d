/**
 * Style cartographique sombre — apps/web/src/lib/map-style.ts
 *
 * Le style est écrit ici, en TypeScript, plutôt que référencé par URL : cela
 * évite une dépendance réseau à un style hébergé qui pourrait disparaître ou
 * changer de rendu sans préavis, et permet d'accorder exactement le fond de
 * plan à la palette de l'application.
 *
 * Fond de plan : CARTO Dark Matter (tuiles raster, attribution obligatoire).
 */

import type { StyleSpecification } from "maplibre-gl";

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributeurs';

export const darkStyle: StyleSpecification = {
  version: 8,
  name: "UAC-Live 3D — sombre",
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    // Tuiles raster OpenStreetMap : gratuites et sans clé.
    // Le rendu sombre est obtenu par traitement CSS/SVG (filtre) sur le canvas
    // des tuiles, pas en modifiant la donnée.
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#070B14" } },
    {
      id: "osm-layer",
      type: "raster",
      source: "osm",
      paint: {
        "raster-opacity": 0.35,
        "raster-saturation": -0.9,
        "raster-contrast": 0.15,
        "raster-brightness-min": 0.02,
        "raster-brightness-max": 0.55,
      },
    },
  ],
};

/** Vue initiale : campus d'Abomey-Calavi. */
export const INITIAL_VIEW = {
  center: [2.3395, 6.4145] as [number, number],
  zoom: 15.4,
  pitch: 0,
  bearing: 0,
};

/** Paramètres 3D : inclinaison suffisante pour lire les volumes, sans vertige. */
export const VIEW_3D = { pitch: 58, bearing: -18, zoom: 16.1 };
export const VIEW_2D = { pitch: 0, bearing: 0, zoom: 15.4 };
