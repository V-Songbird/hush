export type FoldState = {
  /** The row that draws the line: `text:<first words>` or a tool call id. */
  head: string
  /** First words of each folded text. */
  texts: string[]
  /** Every tool call id of the reply. */
  tools: string[]
  errors: number
  warnings: number
}

declare module 'claude-code' {
  interface PluginState {
    hush: {
      /** Each finished reply's fold, oldest first. */
      folds: Shaped<FoldState[]>
      /** The heads of the folds the person opened. */
      open: Shaped<string[]>
    }
  }
}
