interface RegisterOptions {
  readonly onNeedRefresh?: () => void;
  readonly onRegisterError?: (error: unknown) => void;
}

export function registerSW(options: RegisterOptions = {}): (reloadPage?: boolean) => Promise<void> {
  void options;
  return async () => undefined;
}
