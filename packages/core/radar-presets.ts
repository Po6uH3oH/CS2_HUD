import type { RadarMap } from '../shared/types.js';

// Valve overview data, pinned source and hashes: assets/maps/sources.json.
export const builtInRadarMaps: RadarMap[] = [
  {
    "id": "de_nuke",
    "name": "Nuke",
    "originX": -3453,
    "originY": 2887,
    "scale": 7,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Верхний",
        "image": "/assets/maps/de_nuke_radar_psd.png",
        "minZ": -495.0,
        "maxZ": 10000.0
      },
      {
        "id": "lower",
        "name": "Нижний",
        "image": "/assets/maps/de_nuke_lower_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": -495.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 41,
      "y": 258,
      "width": 980,
      "height": 534
    }
  },
  {
    "id": "de_mirage",
    "name": "Mirage",
    "originX": -3230,
    "originY": 1713,
    "scale": 5,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Основной",
        "image": "/assets/maps/de_mirage_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 10000.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 83,
      "y": 135,
      "width": 883,
      "height": 813
    }
  },
  {
    "id": "de_dust2",
    "name": "Dust II",
    "originX": -2476,
    "originY": 3239,
    "scale": 4.4,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Основной",
        "image": "/assets/maps/de_dust2_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 10000.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 32,
      "y": 0,
      "width": 963,
      "height": 1024
    }
  },
  {
    "id": "de_inferno",
    "name": "Inferno",
    "originX": -2087,
    "originY": 3870,
    "scale": 4.9,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Основной",
        "image": "/assets/maps/de_inferno_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 10000.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 48,
      "y": 44,
      "width": 947,
      "height": 927
    }
  },
  {
    "id": "de_ancient",
    "name": "Ancient",
    "originX": -2953,
    "originY": 2164,
    "scale": 5,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Основной",
        "image": "/assets/maps/de_ancient_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 10000.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 106,
      "y": 55,
      "width": 789,
      "height": 903
    }
  },
  {
    "id": "de_anubis",
    "name": "Anubis",
    "originX": -2796,
    "originY": 3328,
    "scale": 5.22,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Основной",
        "image": "/assets/maps/de_anubis_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 10000.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 132,
      "y": 6,
      "width": 774,
      "height": 1001
    }
  },
  {
    "id": "de_overpass",
    "name": "Overpass",
    "originX": -4831,
    "originY": 1781,
    "scale": 5.2,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Основной",
        "image": "/assets/maps/de_overpass_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 10000.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 141,
      "y": 0,
      "width": 816,
      "height": 1024
    }
  },
  {
    "id": "de_train",
    "name": "Train",
    "originX": -2308,
    "originY": 2078,
    "scale": 4.082077,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Верхний",
        "image": "/assets/maps/de_train_radar_psd.png",
        "minZ": -50.0,
        "maxZ": 20000.0
      },
      {
        "id": "lower",
        "name": "Нижний",
        "image": "/assets/maps/de_train_lower_radar_psd.png",
        "minZ": -5000.0,
        "maxZ": -50.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 7,
      "y": 47,
      "width": 1017,
      "height": 931
    }
  },
  {
    "id": "de_vertigo",
    "name": "Vertigo",
    "originX": -3168,
    "originY": 1762,
    "scale": 4,
    "rotation": 0,
    "size": 1024,
    "calibrated": true,
    "layers": [
      {
        "id": "upper",
        "name": "Верхний",
        "image": "/assets/maps/de_vertigo_radar_psd.png",
        "minZ": 11700.0,
        "maxZ": 20000.0
      },
      {
        "id": "lower",
        "name": "Нижний",
        "image": "/assets/maps/de_vertigo_lower_radar_psd.png",
        "minZ": -10000.0,
        "maxZ": 11700.0
      }
    ],
    "regions": [],
    "sites": [],
    "viewBounds": {
      "x": 106,
      "y": 123,
      "width": 734,
      "height": 765
    }
  },
{
  "id": "de_cache",
  "name": "Cache",
  "originX": -2000,
  "originY": 3250,
  "scale": 5.5,
  "rotation": 0,
  "size": 1024,
  "calibrated": true, "viewBounds": {"x": 9, "y": 154, "width": 979, "height": 744},
  "layers": [
    {
      "id": "upper",
      "name": "Основной",
      "image": "/assets/maps/de_cache_radar_psd.png",
      "minZ": -10000,
      "maxZ": 10000
    }
  ],
  "regions": [],
  "sites": []
}
];
