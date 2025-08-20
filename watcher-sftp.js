const SftpClient = require('ssh2-sftp-client');
const chokidar = require('chokidar');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const sftp = new SftpClient();
const LOCAL_DIR = process.env.LOCAL_PATH || 'files';
const LOG_FILE = process.env.LOG_PATH
    ? path.resolve(process.env.LOG_PATH)
    : path.resolve(process.cwd(), 'log.txt');
const REMOTE_DIR = process.env.REMOTE_PATH || '/'; // cambiar por la ruta remota real

function logMessage(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    console.log(line.trim());
}

// Configuración SFTP
const config = {
    host: process.env.SFTP_HOST,
    port: Number(process.env.SFTP_PORT || 22),
    username: process.env.SFTP_USER,
    password: process.env.SFTP_PASSWORD,
    algorithms: {
        kex: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1'],
    },
    hostVerifier: (hash) => {
        logMessage(`Host fingerprint: ${hash}`);
        return true;
    },
};

let reconnecting = false;

// Conectar y mantener la sesión
async function initSFTP() {
    try {
        await sftp.connect(config);
        logMessage('✅ Conectado al SFTP y sesión mantenida');

        await descargarCSV();

        chokidar
            .watch(LOCAL_DIR, { persistent: true, ignoreInitial: true, depth: 0 })
            .on('add', (filePath) => {
                if (filePath.toLowerCase().endsWith('.csv')) {
                    const fileName = path.basename(filePath);
                    logMessage(`📂 Nuevo archivo detectado: ${fileName}`);
                }
            });

        // Loop periódico para revisar nuevos archivos remotos
        setInterval(descargarCSV, 50 * 60 * 1000); // cada 50 minutos
    } catch (err) {
        logMessage(`❌ Error inicial de SFTP: ${err.message}`);
        await handleReconnect();
    }
}

// Manejo de reconexión
async function handleReconnect() {
    if (reconnecting) return;
    reconnecting = true;

    logMessage('🔄 Intentando reconectar al SFTP en 30s...');
    sftp.end().catch(() => { });

    setTimeout(async () => {
        reconnecting = false;
        await initSFTP();
    }, 30 * 1000);
}

// Función para descargar CSVs
async function descargarCSV() {
    try {
        const list = await sftp.list(REMOTE_DIR);

        for (const file of list) {
            if (file.name.toLowerCase().endsWith('.csv')) {
                const localPath = path.join(LOCAL_DIR, file.name);
                if (!fs.existsSync(localPath)) {
                    await sftp.get(`${REMOTE_DIR}/${file.name}`, localPath);
                    logMessage(`📥 Descargado: ${file.name}`);
                    try {
                        await procesarCSV(localPath);
                    } catch (err) {
                        logMessage(`❌ Error al procesar CSV: ${err.message}`);
                    }
                } else {
                    logMessage(`CSV ya existente: ${file.name}`);
                }
            }
        }
    } catch (err) {
        logMessage(`❌ Error descargando CSVs: ${err.message}`);
        await handleReconnect();
    }
}

// Función para procesar CSV con excel_a_sql.js
function procesarCSV(localPath) {
    return new Promise((resolve, reject) => {
        logMessage(`▶ Procesando archivo: ${path.basename(localPath)}`);

        const child = spawn('node', ['excel_a_sql.js'], {
            stdio: 'inherit',
            env: process.env,
        });

        child.on('close', (code) => {
            if (code === 0) {
                logMessage(
                    `✅ Archivo procesado correctamente: ${path.basename(localPath)}`
                );
                resolve();
            } else {
                logMessage(
                    `❌ Error procesando archivo: ${path.basename(
                        localPath
                    )} (code ${code})`
                );
                reject(new Error(`excel_a_sql.js falló con código ${code}`));
            }
        });
    });
}

initSFTP();
