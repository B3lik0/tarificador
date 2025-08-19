# Tarificador: Watcher SFTP + Procesamiento CSV a MySQL

Esta aplicación en Node.js:

- Se conecta a un servidor SFTP y revisa periódicamente archivos CSV en un directorio remoto.
- Descarga los CSV que no existan aún al directorio local ./files.
- Registra eventos en un log de texto en la raíz del proyecto: ./log.txt (configurable con LOG_PATH).
- Opcionalmente, procesa el CSV más reciente con excel_a_sql.js para:
  - Generar un archivo ./sql.txt con un INSERT INTO multi-valor.
  - Insertar los datos en la base de datos MySQL (tabla cdr_avaya.tarificador), usando mysql2.

## Estructura principal

- watcher-sftp.js: Servicio principal que se conecta por SFTP, descarga CSVs y dispara el procesamiento.
- excel_a_sql.js: Toma el CSV más reciente en ./files, genera sql.txt e inserta las filas en MySQL.
- Dockerfile, docker-compose.yml: Contenedorización y orquestación básica.
- files/: Carpeta donde se guardan los CSV descargados (montada como volumen en Docker).
- log.txt: Log de texto en la raíz del proyecto.

## Requisitos

- Node.js 18+ (se usa Node 22 en Docker) y npm
- Acceso al servidor SFTP (host, puerto, usuario, contraseña)
- Acceso a MySQL (host, puerto, usuario, contraseña) con la base cdr_avaya y la tabla tarificador

Dependencias principales (package.json):

- ssh2-sftp-client, chokidar, dotenv
- csv-parse, xlsx (si fuese necesario en el futuro)
- mysql2 (para inserción en DB)

## Configuración (variables de entorno)

Crea un archivo .env en la raíz con, por ejemplo:

SFTP_HOST=example.com
SFTP_PORT=22
SFTP_USER=usuario
SFTP_PASSWORD=********

# Directorios

LOCAL_PATH=files       # directorio local donde guardar CSVs
REMOTE_PATH=/          # directorio remoto en el SFTP a observar

# Base de datos MySQL

DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=********
DB_PORT=3306

# Log opcional (por defecto ./log.txt)

# LOG_PATH=C:\\ruta\\a\\log.txt    # en Windows

# LOG_PATH=/ruta/a/log.txt             # en Linux/Mac/Docker

Notas:

- LOG_PATH es opcional. Si no se define, el log se escribe en ./log.txt (raíz del proyecto o /app en Docker).
- LOCAL_PATH por defecto es files; REMOTE_PATH por defecto es /. Modifícalos según tu servidor.

## Ejecución local

1) Instalar dependencias:
   npm install

2) Asegurar carpeta de archivos:
   mkdir -p files

3) Crear .env con tus credenciales (ver sección de Configuración).

4) Ejecutar el watcher:
   node watcher-sftp.js

El servicio:

- Conecta al SFTP.
- Descarga CSVs que no existan en ./files.
- Escribe logs en ./log.txt.
- Invoca excel_a_sql.js cuando detecta nuevos CSV para generar sql.txt e insertar en MySQL.

Para sólo generar/insertar desde el CSV más reciente manualmente:
   node excel_a_sql.js

Esto crea/actualiza ./sql.txt e inserta en la tabla configurada.

## Ejecución con Docker

Construir e iniciar en segundo plano:
   docker compose build
   docker compose up -d

El docker-compose.yml:

- Construye la imagen con la app en /app.
- Monta volúmenes:
  - ./files -> /app/files
  - ./log.txt -> /app/log.txt (persistencia del log en el host)
  - ./.env -> /app/.env (solo lectura)
- Define LOCAL_PATH=/app/files dentro del contenedor.

Ver logs del contenedor:
   docker compose logs -f watcher

El log de la app también queda en ./log.txt del host.

## Tabla y columnas esperadas en MySQL

excel_a_sql.js construye un INSERT multi-valor para cdr_avaya.tarificador

Asegúrate de que la tabla y las columnas existan con tipos compatibles.

## Comportamiento del log

- Ubicación por defecto: ./log.txt (raíz del proyecto). Puede cambiarse con LOG_PATH.
- El contenido es texto plano, con líneas timestamped.
- En Docker, ./log.txt del host se vincula a /app/log.txt del contenedor para persistir.

## Solución de problemas

- No descarga archivos:
  - Verifica SFTP_HOST/USER/PASSWORD/PORT y REMOTE_PATH.
  - Revisa ./log.txt para mensajes de error.
- No inserta en MySQL:
  - Verifica DB_HOST/USER/PASSWORD/PORT y accesibilidad de la base cdr_avaya.
  - Revisa si la tabla y columnas coinciden.
- No se genera sql.txt:
  - Asegúrate de que existan CSV en ./files y que excel_a_sql.js tenga permisos.
- Permisos en Docker:
  - Los volúmenes deben montarse correctamente; en Windows, verifica rutas y permisos.

## Seguridad

- Las credenciales se leen desde .env. No las incluyas en commits.
- En producción, usa mecanismos seguros para validar la clave del host SFTP (y ajusta hostVerifier) y no aceptes cualquier fingerprint.

## Licencia

ISC
