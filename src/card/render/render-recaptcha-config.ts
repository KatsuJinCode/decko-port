export interface RenderRecaptchaConfig {
  siteKey: string;
  secretKey: string;
}

let renderConfig: RenderRecaptchaConfig | undefined;

export function setRenderRecaptchaConfig(config: RenderRecaptchaConfig | undefined): void {
  renderConfig = config;
}

export function renderRecaptchaConfig(): RenderRecaptchaConfig | undefined {
  return renderConfig;
}
