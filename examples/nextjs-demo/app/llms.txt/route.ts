/**
 * Route handler dla /llms.txt
 */

import { createLlmsTxtRoute } from '@vidok/site-to-mcp/next';
import config from '../../s2m.config.json';

export const GET = createLlmsTxtRoute(config);
