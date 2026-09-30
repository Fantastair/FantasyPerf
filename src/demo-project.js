// 设计者提供并验证的 555 LED 多谐振荡器，完整保留布局、布线和原理图。
export default {
  "format": "FantasyPerf",
  "version": "1.1.0",
  "meta": {
    "app": "FantasyPerf",
    "appVersion": "1.1.0",
    "savedAt": "2026-09-29T10:47:25.084Z"
  },
  "name": "基于555定时器的LED多谐振荡器",
  "board": {
    "cols": 10,
    "rows": 8,
    "pitch": 2.54
  },
  "defaults": {
    "start": 3,
    "end": 3
  },
  "objects": [
    {
      "id": "23d3b13e-ad5c-49d8-8221-5624e9d2b1d0",
      "type": "component",
      "name": "NE555",
      "x": 3,
      "y": 3,
      "rotation": 0,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "GND",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 0,
          "y": 1,
          "label": "TRIG",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 0,
          "y": 2,
          "label": "OUT",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 0,
          "y": 3,
          "label": "RESET",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 3,
          "label": "CONT",
          "labelDx": 0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 2,
          "label": "THRES",
          "labelDx": 0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 1,
          "label": "DISCH",
          "labelDx": 0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 0,
          "label": "VCC",
          "labelDx": 0.45,
          "labelDy": 0
        }
      ]
    },
    {
      "id": "fe8ca9d2-74f5-4982-bde8-bc0bd8b1181f",
      "type": "component",
      "name": "供电",
      "x": 1,
      "y": 1,
      "rotation": 180,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "5V",
          "labelDx": 0,
          "labelDy": -0.55
        },
        {
          "x": 1,
          "y": 0,
          "label": "GND",
          "labelDx": 0,
          "labelDy": -0.55
        }
      ]
    },
    {
      "id": "92f539b7-690e-47fc-960a-e029a511a7ce",
      "type": "component",
      "name": "LED",
      "x": 2,
      "y": 5,
      "rotation": 180,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "+",
          "labelDx": 0,
          "labelDy": -0.55
        },
        {
          "x": 1,
          "y": 0,
          "label": "-",
          "labelDx": 0,
          "labelDy": -0.55
        }
      ]
    },
    {
      "id": "33606d1c-eb0c-4ef9-bd2c-1f60677bc50b",
      "type": "component",
      "name": "LED限流 R3 220",
      "x": 0,
      "y": 2,
      "rotation": 90,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 0,
          "label": "",
          "labelDx": 0.45,
          "labelDy": 0
        }
      ]
    },
    {
      "id": "4b85f4b4-9aa5-4acc-ba05-811ca5744adc",
      "type": "component",
      "name": "R1 1K",
      "x": 7,
      "y": 1,
      "rotation": 90,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 0,
          "label": "",
          "labelDx": 0.45,
          "labelDy": 0
        }
      ]
    },
    {
      "id": "e217187c-c7ae-4cc9-af1b-efba5e0ad6ca",
      "type": "component",
      "name": "R2 47K",
      "x": 8,
      "y": 2,
      "rotation": 90,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 3,
          "y": 0,
          "label": "",
          "labelDx": 0.45,
          "labelDy": 0
        }
      ]
    },
    {
      "id": "774c1b44-5c64-4f01-94e8-23b4e02cda0c",
      "type": "component",
      "name": "退耦电容 C1 220nF",
      "x": 4,
      "y": 2,
      "rotation": 0,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "1",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 2,
          "y": 0,
          "label": "2",
          "labelDx": 0.45,
          "labelDy": 0
        }
      ]
    },
    {
      "id": "ee603241-4dec-4399-9f93-22e717321ecf",
      "type": "component",
      "name": "C2 10nF",
      "x": 6,
      "y": 7,
      "rotation": 0,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "1",
          "labelDx": -0.45,
          "labelDy": 0
        },
        {
          "x": 2,
          "y": 0,
          "label": "2",
          "labelDx": 0.45,
          "labelDy": 0
        }
      ]
    },
    {
      "id": "ba5c085d-f324-4aa4-a492-9f26eab2e6d5",
      "type": "component",
      "name": "C 10uF",
      "x": 8,
      "y": 6,
      "rotation": 0,
      "pins": [
        {
          "x": 0,
          "y": 0,
          "label": "+",
          "labelDx": 0,
          "labelDy": -0.55
        },
        {
          "x": 1,
          "y": 0,
          "label": "-",
          "labelDx": 0,
          "labelDy": -0.55
        }
      ]
    },
    {
      "id": "fcc76957-0548-4544-ac30-82ca6698af20",
      "type": "solder",
      "name": "T2",
      "points": [
        {
          "x": 3,
          "y": 3
        },
        {
          "x": 3,
          "y": 2
        }
      ]
    },
    {
      "id": "51411c4e-62f6-4afe-87a1-17bd787571f0",
      "type": "solder",
      "name": "T3",
      "points": [
        {
          "x": 1,
          "y": 1
        },
        {
          "x": 6,
          "y": 1
        },
        {
          "x": 6,
          "y": 2
        }
      ]
    },
    {
      "id": "9b986939-c2fe-4db7-bf7b-0d88cf934327",
      "type": "solder",
      "name": "T4",
      "points": [
        {
          "x": 6,
          "y": 2
        },
        {
          "x": 6,
          "y": 3
        }
      ]
    },
    {
      "id": "27b4cfec-2ddf-4edc-b5c6-045dc4755100",
      "type": "solder",
      "name": "T5",
      "points": [
        {
          "x": 6,
          "y": 3
        },
        {
          "x": 7,
          "y": 3
        },
        {
          "x": 7,
          "y": 1
        }
      ]
    },
    {
      "id": "41de79d3-cbfd-46df-b43d-cfbcd8c8e19e",
      "type": "solder",
      "name": "T6",
      "points": [
        {
          "x": 7,
          "y": 4
        },
        {
          "x": 6,
          "y": 4
        }
      ]
    },
    {
      "id": "5433957e-dded-47b9-b267-e3a94272754f",
      "type": "solder",
      "name": "T7",
      "points": [
        {
          "x": 7,
          "y": 4
        },
        {
          "x": 8,
          "y": 4
        },
        {
          "x": 8,
          "y": 2
        }
      ]
    },
    {
      "id": "746729cf-c480-4f5e-b4b6-68dbc66f0079",
      "type": "solder",
      "name": "T8",
      "points": [
        {
          "x": 8,
          "y": 5
        },
        {
          "x": 6,
          "y": 5
        }
      ]
    },
    {
      "id": "b63c8eaf-f8c6-42d4-bc07-49776f46d908",
      "type": "solder",
      "name": "T9",
      "points": [
        {
          "x": 8,
          "y": 6
        },
        {
          "x": 8,
          "y": 5
        }
      ]
    },
    {
      "id": "7406c616-6e5e-4b1d-aba2-771a2631b14e",
      "type": "solder",
      "name": "T10",
      "points": [
        {
          "x": 8,
          "y": 7
        },
        {
          "x": 9,
          "y": 7
        },
        {
          "x": 9,
          "y": 6
        }
      ]
    },
    {
      "id": "4aa00789-02a0-4ae8-8d1c-14632ce1adb9",
      "type": "solder",
      "name": "T11",
      "points": [
        {
          "x": 6,
          "y": 7
        },
        {
          "x": 6,
          "y": 6
        }
      ]
    },
    {
      "id": "514c5a26-e2f9-47f7-bee7-d249a4c8fa44",
      "type": "solder",
      "name": "T12",
      "points": [
        {
          "x": 3,
          "y": 4
        },
        {
          "x": 5,
          "y": 4
        },
        {
          "x": 5,
          "y": 5
        },
        {
          "x": 6,
          "y": 5
        }
      ]
    },
    {
      "id": "bb2135ad-8d7f-4a29-b9ce-417a40cf3fd1",
      "type": "solder",
      "name": "T14",
      "points": [
        {
          "x": 1,
          "y": 5
        },
        {
          "x": 0,
          "y": 5
        }
      ]
    },
    {
      "id": "8ffbb37d-88e3-47a3-9d56-4bbe574eff98",
      "type": "solder",
      "name": "T1",
      "points": [
        {
          "x": 0,
          "y": 1
        },
        {
          "x": 0,
          "y": 2
        },
        {
          "x": 4,
          "y": 2
        }
      ]
    },
    {
      "id": "002927a0-3791-4a31-9ea1-2745442afde5",
      "type": "wire",
      "name": "W1",
      "points": [
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 5,
          "y": 3
        }
      ],
      "mode": "direct",
      "color": "#dc6654",
      "allowanceStart": 3,
      "allowanceEnd": 3
    },
    {
      "id": "cc26f3db-bdf3-4a1a-9729-d04fbcf7b83b",
      "type": "solder",
      "name": "T13",
      "points": [
        {
          "x": 3,
          "y": 6
        },
        {
          "x": 4,
          "y": 6
        }
      ]
    },
    {
      "id": "226dffb6-c234-45f2-9c60-0567b72a5d21",
      "type": "solder",
      "name": "T15",
      "points": [
        {
          "x": 6,
          "y": 3
        },
        {
          "x": 5,
          "y": 3
        }
      ]
    },
    {
      "id": "f7d1c1e8-ed3f-43f4-8fd8-1db0a2ba32df",
      "type": "wire",
      "name": "W2",
      "points": [
        {
          "x": 9,
          "y": 5
        },
        {
          "x": 9,
          "y": 0
        },
        {
          "x": 0,
          "y": 0
        }
      ],
      "mode": "orthogonal",
      "color": "#dc6654",
      "allowanceStart": 3,
      "allowanceEnd": 3
    },
    {
      "id": "2a01488e-ae94-4e67-80d7-ceeb00b11cd1",
      "type": "solder",
      "name": "T16",
      "points": [
        {
          "x": 0,
          "y": 1
        },
        {
          "x": 0,
          "y": 0
        }
      ]
    },
    {
      "id": "f15e059b-f00d-483a-82f3-a088a920314e",
      "type": "solder",
      "name": "T17",
      "points": [
        {
          "x": 9,
          "y": 6
        },
        {
          "x": 9,
          "y": 5
        }
      ]
    },
    {
      "id": "95b2dacf-d62c-43bd-a875-07d9724f5b6b",
      "type": "solder",
      "name": "T18",
      "points": [
        {
          "x": 2,
          "y": 5
        },
        {
          "x": 3,
          "y": 5
        }
      ]
    }
  ],
  "reference": {
    "name": "SCH.png",
    "dataUrl": "data:image/webp;base64,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",
    "naturalWidth": 854,
    "naturalHeight": 786,
    "x": 8,
    "y": 60,
    "width": 360,
    "opacity": 1,
    "visible": true
  }
};
