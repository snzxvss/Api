import express from 'express';
import axios from 'axios';
import fs from 'fs';
import yts from 'yt-search';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import Tiktok from "@tobyg74/tiktok-api-dl";
import os from 'os';

// Definir __dirname manualmente
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ruta al archivo de cookies original
const ORIGINAL_COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Inicializar Express
const app = express();
const port = 81;

// Función para manejar errores de spawn y limpiar archivos temporales
const handleSpawnError = (processName, err, tempDir, reject) => {
  console.error(`Error al iniciar el proceso ${processName}:`, err.message);
  // Eliminar el directorio temporal si existe
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  reject(err); // Rechazar la promesa en lugar de salir del proceso
};

/**
 * Función para descargar media usando yt-dlp y ffmpeg mediante child_process.spawn
 * @param {string} url - URL del video de YouTube
 * @param {string} type - Tipo de descarga ('audio' o 'video')
 * @param {string} requestId - ID único para la solicitud
 * @returns {Promise<Buffer>} - Buffer con los datos del media descargado
 */
async function downloadMedia(url, type, requestId) {
  return new Promise((resolve, reject) => {
    // Crear un directorio temporal único
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `download_${requestId}_`));

    // Ruta al archivo de cookies temporal
    const tempCookiesPath = path.join(tempDir, `cookies_${requestId}.txt`);

    try {
      // Verificar si el archivo de cookies original existe
      if (!fs.existsSync(ORIGINAL_COOKIES_PATH)) {
        throw new Error(`El archivo de cookies original no existe: ${ORIGINAL_COOKIES_PATH}`);
      }
    
      // Copiar el archivo de cookies original al temporal
      fs.copyFileSync(ORIGINAL_COOKIES_PATH, tempCookiesPath);
      console.log(`cookies.txt copiado exitosamente a ${tempCookiesPath}`);
    } catch (err) {
      console.error('Error al copiar el archivo de cookies:', err);
      fs.rmSync(tempDir, { recursive: true, force: true });
      return reject(err);
    }

    const outputFilePath = path.join(tempDir, `${requestId}_media.${type === 'audio' ? 'mp3' : 'mp4'}`);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

    // Iniciar el proceso de ffmpeg sin la barra de progreso
    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', '8', '-hide_banner',
      '-i', 'pipe:3', // Entrada de audio
      '-i', 'pipe:4', // Entrada de video
      '-map', '0:a',
      '-map', '1:v',
      '-c:v', 'copy',
      outputFilePath,
    ], {
      stdio: [
        'inherit', // stdin
        'inherit', // stdout
        'inherit', // stderr
        'pipe',    // pipe:3 (audio)
        'pipe',    // pipe:4 (video)
      ],
    });

    // Manejar errores de ffmpeg
    ffmpeg.on('error', (err) => {
      handleSpawnError('ffmpeg', err, tempDir, reject);
    });

    // Manejar el cierre de ffmpeg
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        // Leer el archivo de salida y resolver la promesa
        fs.readFile(outputFilePath, (err, data) => {
          // Eliminar el directorio temporal
          fs.rmSync(tempDir, { recursive: true, force: true });

          if (err) {
            console.error('Error leyendo el archivo descargado:', err);
            return reject(err);
          }
          // Resolver con los datos del archivo
          resolve(data);
        });
      } else {
        console.error(`ffmpeg salió con el código ${code}`);
        // Eliminar el directorio temporal
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    // Descarga audio con yt-dlp usando el archivo de cookies temporal y el user-agent
    const audio = spawn('yt-dlp', [
      '-f', 'bestaudio',
      '--cookies', tempCookiesPath,
      '--user-agent', userAgent,
      '-o', '-', url
    ], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, 'YTDLP_USE_UNPAID_API': 'true' }, // Opcional: Añadir variables de entorno si es necesario
    });

    audio.on('error', (err) => {
      handleSpawnError('yt-dlp (audio)', err, tempDir, reject);
    });

    audio.stdout.pipe(ffmpeg.stdio[3]);

    audio.on('close', (code) => {
      if (code !== 0) {
        console.error(`yt-dlp para audio salió con código ${code}`);
        // No rechazar aquí para permitir que ffmpeg procese lo que se pueda
      }
    });

    // Descarga video con yt-dlp usando el archivo de cookies temporal y el user-agent
    const video = spawn('yt-dlp', [
      '-f', 'bestvideo',
      '--cookies', tempCookiesPath,
      '--user-agent', userAgent,
      '-o', '-', url
    ], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, 'YTDLP_USE_UNPAID_API': 'true' }, // Opcional: Añadir variables de entorno si es necesario
    });

    video.on('error', (err) => {
      handleSpawnError('yt-dlp (video)', err, tempDir, reject);
    });

    video.stdout.pipe(ffmpeg.stdio[4]);

    video.on('close', (code) => {
      if (code !== 0) {
        console.error(`yt-dlp para video salió con código ${code}`);
        // No rechazar aquí para permitir que ffmpeg procese lo que se pueda
      }
    });
  });
}

// Endpoint para descargar videos de YouTube
app.get('/download', async (req, res) => {
  const { url, type } = req.query;

  if (!url || !type) {
    return res.status(400).send('Missing url or type parameter');
  }

  try {
    const requestId = uuidv4();
    const requestInfo = {
      requestId,
      url,
      type,
      origin: req.headers['origin'] || 'unknown',
      time: new Date().toISOString(),
      userAgent: req.headers['user-agent']
    };
    console.log('Request Info:', requestInfo);

    const mediaBuffer = await downloadMedia(url, type, requestId);

    res.set('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    res.send(mediaBuffer);
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).send('Error fetching media');
  }
});

// Endpoint para descargar videos de TikTok
app.get('/downloadtiktok', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    console.log(`Received request for URL: ${url}`);
    const result = await Tiktok.Downloader(url, { version: "v1" });
    console.log('TikTok Downloader result:', result);
    if (result.status === "success") {
      const videoUrl = result.result.video.downloadAddr;
      console.log('Video URL:', videoUrl);
      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://www.tiktok.com/'
        }
      });
      console.log('Response status:', response.status);
      res.set('Content-Type', 'video/mp4');
      res.send(response.data);
    } else {
      console.error('TikTok Downloader error:', result.message);
      res.status(500).send('Error fetching media');
    }
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).send('Error fetching media');
  }
});

// Función de búsqueda
async function search(query, options = {}) {
  const search = await yts.search({ query, hl: 'es', gl: 'ES', ...options });
  return search.videos;
}

// Iniciar el servidor en el puerto 81
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});