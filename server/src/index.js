import { config } from './config.js';
import { crearDbMysql } from './db/mysql.js';
import { crearApp } from './app.js';

const db = crearDbMysql(config.db);
const app = crearApp({ db, carpetaWeb: config.carpetaWeb });

app.listen(config.puerto, () => {
  console.log(`BX escuchando en http://localhost:${config.puerto}`);
});

const salir = async () => { app.close(); await db.cerrar(); process.exit(0); };
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
