export type AssetRefreshMode = "eager" | "cautious" | "never";

export interface ReadAssetRefreshOptions {
  readonly mode: AssetRefreshMode;
  readonly sharedCache?: boolean;
  readonly refresh: () => Promise<void>;
}

export interface ReadAssetRefresh {
  beforeRead(request?: { readonly explicitFile?: boolean }): Promise<boolean>;
}

export function createReadAssetRefresh(options: ReadAssetRefreshOptions): ReadAssetRefresh {
  const sharedCache = options.sharedCache ?? true;
  let refreshed = false;

  const refreshesNow = (): boolean => {
    switch (options.mode) {
      case "eager":
        return true;
      case "never":
        return false;
      case "cautious":
        if (!sharedCache) return false;
        if (refreshed) return false;
        refreshed = true;
        return true;
    }
  };

  return {
    async beforeRead(request = {}) {
      if (request.explicitFile === true) return false;
      if (!refreshesNow()) return false;
      await options.refresh();
      return true;
    },
  };
}
