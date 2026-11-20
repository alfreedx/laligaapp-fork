import packageJson from '../../package.json';

/** Versión mostrada en la interfaz. */
export const APP_VERSION = process.env.REACT_APP_VERSION || packageJson.version;
