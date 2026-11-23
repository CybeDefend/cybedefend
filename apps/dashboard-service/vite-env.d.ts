/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GATEWAY_URL: string;
    /** @deprecated IAM service removed — use Logto instead */
    readonly VITE_APP_URL_EU: string;
    readonly VITE_APP_URL_US: string;
    readonly VITE_REGION: string;
    readonly VITE_GITHUB_INTEGRATION_URL: string;
    readonly VITE_LOGTO_ENDPOINT: string;
    readonly VITE_LOGTO_APP_ID: string;
    readonly VITE_LOGTO_API_RESOURCE: string;
    /** Bare https origin serving the onboarding videos; unset means no video. */
    readonly VITE_ONBOARDING_MEDIA_BASE_URL?: string;
    /** Build edition: unset or '' means 'cloud' (see src/edition/edition.ts). */
    readonly VITE_EDITION?: 'community' | 'cloud' | 'enterprise';
}
  
interface ImportMeta {
    readonly env: ImportMetaEnv;
}
  