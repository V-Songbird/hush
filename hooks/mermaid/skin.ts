// Stands in for skins' skin.ts: only the colour names the chart code reads.

export type Slot =
  | 'read'
  | 'search'
  | 'web'
  | 'mcp'
  | 'user'
  | 'fg'
  | 'muted'
  | 'ok'
  | 'err'
  | 'warn'

export type Palette = Readonly<Record<Slot, string>>
