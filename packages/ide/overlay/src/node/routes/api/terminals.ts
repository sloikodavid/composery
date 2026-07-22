// The slice of VS Code's pty host this package uses. code-server compiles
// separately from lib/vscode, so the shape is declared rather than imported -
// the same way `IVSCodeServerAPI` in routes/vscode.ts declares the server's.
// If upstream changes one of these signatures, this file stops compiling
// against the real service, which is the point.

// Workspace of a terminal created outside any editor window. The API has no
// editor and so no workspace to belong to; a terminal carrying this belongs to
// whichever window asks for its layout. Must equal API_TERMINAL_WORKSPACE_ID in
// lib/vscode/src/vs/platform/terminal/node/ptyService.ts (api.diff);
// a test pins the two together.
export const API_TERMINAL_WORKSPACE_ID = "composery-api-terminal"

export interface Disposable {
  dispose(): void
}

export type Event<T> = (listener: (event: T) => void) => Disposable

export interface ShellLaunchConfig {
  name?: string
  executable?: string
  args?: string[] | string
  cwd?: string
  env?: Record<string, string | null | undefined>
}

export interface TerminalProcessOptions {
  shellIntegration: { enabled: boolean; suggestEnabled: boolean; nonce: string }
  windowsUseConptyDll: boolean
  environmentVariableCollections: undefined
  workspaceFolder: undefined
  isScreenReaderOptimized: boolean
}

export interface TerminalLaunchError {
  message: string
  code?: number
}

export interface PtyService {
  readonly onProcessData: Event<{ id: number; event: string | { data: string } }>
  readonly onProcessExit: Event<{ id: number; event: number | undefined }>

  createProcess(
    shellLaunchConfig: ShellLaunchConfig,
    cwd: string,
    cols: number,
    rows: number,
    unicodeVersion: "6" | "11",
    env: Record<string, string | undefined>,
    executableEnv: Record<string, string | undefined>,
    options: TerminalProcessOptions,
    shouldPersist: boolean,
    workspaceId: string,
    workspaceName: string,
  ): Promise<number>
  start(id: number): Promise<TerminalLaunchError | { injectedArgs: string[] } | undefined>
  input(id: number, data: string): Promise<void>
  resize(id: number, cols: number, rows: number): Promise<void>
  acknowledgeDataEvent(id: number, charCount: number): Promise<void>
  shutdown(id: number, immediate: boolean): Promise<void>
}
