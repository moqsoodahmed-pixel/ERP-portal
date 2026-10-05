import { identityModels } from './identity.js';
import { businessModels } from './business.js';
import { platformModels } from './platform.js';
import { documentModels } from './document.js';

/** Registry of all Mongoose models. The composition root receives this map so tests can substitute fakes. */
export const models = Object.freeze({ ...identityModels, ...businessModels, ...platformModels, ...documentModels });
