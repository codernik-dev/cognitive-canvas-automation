/**
 * Settings > Appearance as the app defines it (build c54e7e2): the global accents, the Styles and each
 * Style's own accents with their primary shades 300-700. Copied from the app's
 * components/shared/settings/AppearanceSection.tsx and config/styleAccents.ts on 2026-11-10; a test that
 * finds anything else on screen has found a change in the app.
 */
export interface Accent { id: string; name: string; description: string }
export interface StyleAccent extends Accent { /** --color-primary-300 to -700, in that order. */ shades: string[] }
export interface Style extends Accent { accents: StyleAccent[] }

/** The global accents, shown under the Default style. The first is the default (no class on <html>). */
export const ACCENTS: Accent[] = [
  {
    id: 'royal-purple',
    name: 'Royal Purple (Default)',
    description: 'Rich purple, confident and bold'
  },
  {
    id: 'emerald-night',
    name: 'Emerald Night',
    description: 'Fresh green, calm and focused'
  },
  {
    id: 'ocean-depth',
    name: 'Ocean Depth',
    description: 'Deep blue, professional and clean'
  },
  {
    id: 'sunset-flame',
    name: 'Sunset Flame',
    description: 'Warm orange, energetic and creative'
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    description: 'Elegant rose, refined and striking'
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    description: 'Premium gold, luxurious and warm'
  },
  {
    id: 'arctic-frost',
    name: 'Arctic Frost',
    description: 'Cool indigo, crisp and modern'
  },
  {
    id: 'cyber-teal',
    name: 'Cyber Teal',
    description: 'Vibrant teal, techy and fresh'
  },
  {
    id: 'midnight-cherry',
    name: 'Midnight Cherry',
    description: 'Hot pink, playful and expressive'
  }
]

/** The Styles; Default first. Each other Style lists its own accents, the first being its default. */
export const STYLES: Style[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Follows Mode + Accent above',
    accents: []
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Serif on warm paper',
    accents: [
      {
        id: 'clay',
        name: 'Clay',
        description: 'Warm terracotta, earthy and calm',
        shades: [
          '#d7a483',
          '#c88a6a',
          '#b5714a',
          '#96543a',
          '#7c4530'
        ]
      },
      {
        id: 'olive',
        name: 'Olive',
        description: 'Muted olive, natural and grounded',
        shades: [
          '#a8b57a',
          '#8a9a5f',
          '#6b7a3a',
          '#566230',
          '#444d26'
        ]
      },
      {
        id: 'ink',
        name: 'Ink Blue',
        description: 'Deep ink blue, classic and sober',
        shades: [
          '#7fa3c2',
          '#567ea0',
          '#3a5a7a',
          '#2e4860',
          '#223650'
        ]
      },
      {
        id: 'oxblood',
        name: 'Oxblood',
        description: 'Rich oxblood, vintage and bold',
        shades: [
          '#d18f8e',
          '#b56060',
          '#9e3b3a',
          '#7f2f2e',
          '#632523'
        ]
      }
    ]
  },
  {
    id: 'noir',
    name: 'Noir',
    description: 'Dark serif, gold on charcoal',
    accents: [
      {
        id: 'gold',
        name: 'Gold',
        description: 'Antique gold, warm and refined',
        shades: [
          '#e6cf92',
          '#d8bd82',
          '#c6a86e',
          '#a5843c',
          '#866a2f'
        ]
      },
      {
        id: 'silver',
        name: 'Champagne',
        description: 'Cool champagne, quiet and elegant',
        shades: [
          '#d8dbe0',
          '#b8bcc4',
          '#9aa0aa',
          '#7a808a',
          '#5f646e'
        ]
      },
      {
        id: 'copper',
        name: 'Copper',
        description: 'Burnished copper, warm metallic',
        shades: [
          '#e0a884',
          '#cf8a60',
          '#b56a43',
          '#96543a',
          '#7c4530'
        ]
      },
      {
        id: 'sage',
        name: 'Sage',
        description: 'Soft sage, muted and calm',
        shades: [
          '#a8b59a',
          '#8a9a7a',
          '#6f7f5c',
          '#566349',
          '#444d3a'
        ]
      }
    ]
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Green monospace, CRT',
    accents: [
      {
        id: 'green',
        name: 'Phosphor',
        description: 'Classic green phosphor glow',
        shades: [
          '#8effb5',
          '#6effa0',
          '#33ff77',
          '#1fbf5a',
          '#159945'
        ]
      },
      {
        id: 'amber',
        name: 'Amber',
        description: 'Retro amber CRT',
        shades: [
          '#ffd98a',
          '#ffc24d',
          '#ffab1f',
          '#d98a10',
          '#b56e0a'
        ]
      },
      {
        id: 'cyan',
        name: 'Cyan',
        description: 'Electric cyan, cool and crisp',
        shades: [
          '#8ff5ff',
          '#4de5ff',
          '#1fd0ff',
          '#10a5d9',
          '#0a82b5'
        ]
      },
      {
        id: 'magenta',
        name: 'Magenta',
        description: 'Hot magenta, high energy',
        shades: [
          '#ff9ae0',
          '#ff5bd0',
          '#ff1fbf',
          '#d910a0',
          '#b50a85'
        ]
      }
    ]
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Frosted over a gradient',
    accents: [
      {
        id: 'violet',
        name: 'Violet',
        description: 'Soft violet, the house tint',
        shades: [
          '#b3a4ff',
          '#9c86ff',
          '#7b6bff',
          '#5a4bef',
          '#4436c8'
        ]
      },
      {
        id: 'azure',
        name: 'Azure',
        description: 'Bright azure, cool and clear',
        shades: [
          '#8fc0ff',
          '#5a9dff',
          '#2b7bff',
          '#1f5fd9',
          '#1548b5'
        ]
      },
      {
        id: 'rose',
        name: 'Rose',
        description: 'Vivid rose, a warm accent',
        shades: [
          '#ffa4c8',
          '#ff6ea3',
          '#ff3d82',
          '#d92f68',
          '#b52350'
        ]
      },
      {
        id: 'aqua',
        name: 'Aqua',
        description: 'Fresh aqua, calm and clean',
        shades: [
          '#7ff0e0',
          '#3fdcc8',
          '#14c2ab',
          '#0f9d8a',
          '#0a7d6e'
        ]
      }
    ]
  },
  {
    id: 'halo',
    name: 'Halo',
    description: 'Void with a violet glow',
    accents: [
      {
        id: 'violet',
        name: 'Violet',
        description: 'Signature violet bloom',
        shades: [
          '#d8b4fe',
          '#c084fc',
          '#a855f7',
          '#8b3aed',
          '#6d28d9'
        ]
      },
      {
        id: 'cyan',
        name: 'Cyan',
        description: 'Cool cyan glow',
        shades: [
          '#8ff5ff',
          '#4de5ff',
          '#1fd0ff',
          '#10a5d9',
          '#0a82b5'
        ]
      },
      {
        id: 'magenta',
        name: 'Magenta',
        description: 'Neon magenta glow',
        shades: [
          '#ff9ae0',
          '#ff5bd0',
          '#ec1fbf',
          '#c910a0',
          '#a50a85'
        ]
      },
      {
        id: 'lime',
        name: 'Lime',
        description: 'Electric lime, high contrast',
        shades: [
          '#d6ff8a',
          '#bcff4d',
          '#9ee81f',
          '#7dbf14',
          '#63990f'
        ]
      }
    ]
  },
  {
    id: 'spectra',
    name: 'Spectra',
    description: 'Clean white, colour-coded',
    accents: [
      {
        id: 'rose',
        name: 'Rose',
        description: 'Warm rose, the default hue',
        shades: [
          '#ffb0c2',
          '#ff8aa3',
          '#ff5b7f',
          '#e8365f',
          '#c22548'
        ]
      },
      {
        id: 'blue',
        name: 'Blue',
        description: 'Clear blue, calm and clean',
        shades: [
          '#9dc4ff',
          '#6a9dff',
          '#3d8bff',
          '#2b6fd9',
          '#1f56b5'
        ]
      },
      {
        id: 'amber',
        name: 'Amber',
        description: 'Sunny amber, a warm pop',
        shades: [
          '#ffd98a',
          '#ffc24d',
          '#f5a623',
          '#d98910',
          '#b56e0a'
        ]
      },
      {
        id: 'emerald',
        name: 'Emerald',
        description: 'Fresh emerald, crisp and clean',
        shades: [
          '#7fe8b0',
          '#3fd98a',
          '#12b886',
          '#0f9770',
          '#0a7757'
        ]
      }
    ]
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Aurora: violet, pink, amber',
    accents: [
      {
        id: 'violet',
        name: 'Violet',
        description: 'Deep violet, the aurora core',
        shades: [
          '#e0aaff',
          '#d08aff',
          '#b56bff',
          '#9333ea',
          '#7c22ce'
        ]
      },
      {
        id: 'magenta',
        name: 'Magenta',
        description: 'Bright magenta, aurora pink',
        shades: [
          '#ff9ad8',
          '#ff6ec7',
          '#ec4899',
          '#d92777',
          '#b51d5f'
        ]
      },
      {
        id: 'teal',
        name: 'Teal',
        description: 'Cool teal, the aurora edge',
        shades: [
          '#7ff0e0',
          '#3fdcc8',
          '#14b8a6',
          '#0f9788',
          '#0a776b'
        ]
      },
      {
        id: 'amber',
        name: 'Amber',
        description: 'Warm amber, the aurora glow',
        shades: [
          '#ffd98a',
          '#fbbf24',
          '#f59e0b',
          '#d97706',
          '#b45309'
        ]
      }
    ]
  },
  {
    id: 'amberline',
    name: 'Amberline',
    description: 'Warm amber on black',
    accents: [
      {
        id: 'amber',
        name: 'Amber',
        description: 'Signature warm amber',
        shades: [
          '#fcd34d',
          '#fbbf24',
          '#f59e0b',
          '#d97706',
          '#b45309'
        ]
      },
      {
        id: 'ember',
        name: 'Ember',
        description: 'Fiery ember, orange-red',
        shades: [
          '#ff9a6e',
          '#ff6e3d',
          '#f0501f',
          '#c93d14',
          '#a5300f'
        ]
      },
      {
        id: 'gold',
        name: 'Gold',
        description: 'Muted antique gold',
        shades: [
          '#f0d98a',
          '#e0c15a',
          '#cfa62e',
          '#a5841f',
          '#866a15'
        ]
      },
      {
        id: 'honey',
        name: 'Honey',
        description: 'Golden honey, warm and soft',
        shades: [
          '#ffe08a',
          '#ffcf4d',
          '#f0b91f',
          '#d99a10',
          '#b57c0a'
        ]
      }
    ]
  }
]
