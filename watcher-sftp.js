const SftpClient = require('ssh2-sftp-client');
const chokidar = require('chokidar');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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
        kex: [
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
        ],
    },
    hostVerifier: (hash) => {
        logMessage(`Host fingerprint: ${hash}`);
        return true;
    },
};

let reconnecting = false;
let sftp = null;

// Conectar y mantener la sesión
async function initSFTP() {
    sftp = new SftpClient();

    try {
        await sftp.connect(config);
        logMessage('✅ Conectado al SFTP y sesión mantenida');

        // Descargar archivos al conectar
        await descargarCSV();

        // Configurar watcher para archivos locales
        chokidar
            .watch(LOCAL_DIR, { persistent: true, ignoreInitial: true, depth: 0 })
            .on('add', (filePath) => {
                if (filePath.toLowerCase().endsWith('.csv')) {
                    const fileName = path.basename(filePath);
                    logMessage(`📂 Nuevo archivo detectado: ${fileName}`);
                }
            });

        logMessage('⏱️ Iniciando revisor de archivos remotos cada 50 minutos');
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
    if (sftp) {
        sftp.end().catch(() => { });
    }

    setTimeout(async () => {
        reconnecting = false;
        await initSFTP();
    }, 30 * 1000);
}

// Función para descargar CSVs
async function descargarCSV() {
    if (!sftp) {
        logMessage('⚠️  Conexión SFTP no disponible');
        return;
    }

    try {
        // Crear carpeta local si no existe
        if (!fs.existsSync(LOCAL_DIR)) {
            fs.mkdirSync(LOCAL_DIR, { recursive: true });
            logMessage(`📁 Carpeta local creada: ${LOCAL_DIR}`);
        }

        // Listar archivos remotos
        const remoteFiles = await sftp.list(REMOTE_DIR);
        const csvFilesRemote = remoteFiles
            .filter(file => file.name.toLowerCase().endsWith('.csv'))
            .map(file => file.name);

        // Listar archivos locales
        const localFiles = fs.existsSync(LOCAL_DIR) 
            ? fs.readdirSync(LOCAL_DIR).filter(f => f.toLowerCase().endsWith('.csv'))
            : [];

        logMessage(`📋 Directorio remoto: ${csvFilesRemote.length} CSV(s) | Directorio local: ${localFiles.length} CSV(s)`);

        // Descargar archivos que existen remotamente pero no localmente
        for (const fileName of csvFilesRemote) {
            if (!localFiles.includes(fileName)) {
                const localPath = path.join(LOCAL_DIR, fileName);
                const remotePath = `${REMOTE_DIR}/${fileName}`.replace(/\/\//g, '/');
                
                logMessage(`📥 Descargando: ${fileName}`);
                await sftp.get(remotePath, localPath);
                logMessage(`✅ Descargado: ${fileName}`);
                
                try {
                    await procesarCSV(localPath);
                } catch (err) {
                    logMessage(`❌ Error al procesar CSV: ${err.message}`);
                }
            }
        }

        if (csvFilesRemote.length === localFiles.length && csvFilesRemote.length > 0) {
            logMessage(`✔️ Todos los archivos CSV están sincronizados`);
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
