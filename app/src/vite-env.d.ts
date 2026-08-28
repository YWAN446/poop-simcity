/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which dataset the build opens on (see app/.env, app/.env.sdc-10k). */
  readonly VITE_DEFAULT_DATASET?: string;
  /**
   * CARTO basemap key. Optional: without it the map still renders, but CARTO
   * watermarks every tile at source. Put the real key in app/.env.local, which
   * is gitignored.
   */
  readonly VITE_CARTO_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
