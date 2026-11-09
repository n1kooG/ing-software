import { crearApp } from './app.js';
import { config } from './config.js';
import { iniciarCache } from './cache.js';

await iniciarCache();
crearApp().listen(config.port, () => console.log(`SGI Oregón API escuchando en http://localhost:${config.port}`));
