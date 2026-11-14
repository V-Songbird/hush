// Stands in for skins' skin.ts: only the colour names the chart code reads.

export type Slot =
  | 'read'
  | 'write'
  | 'run'
  | 'search'
  | 'web'
  | 'mcp'
  | 'other'
  | 'user'
  | 'fg'
  | 'muted'
  | 'surface'
  | 'zebra'
  | 'ok'
  | 'err'
  | 'warn'

export type Palette = Readonly<Record<Slot, string>>
