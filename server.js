import express from 'express';
import axios from 'axios';
import fs from 'fs';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ytDlp from 'yt-dlp-exec';
import yts from 'yt-search';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import Tiktok from '@tobyg74/tiktok-api-dl';
import os from 'os';
import fluentFfmpeg from 'fluent-ffmpeg';

// Configurar la ruta de ffmpeg para fluent-ffmpeg
fluentFfmpeg.setFfmpegPath(ffmpegPath.path);

// Definir __dirname manualmente
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ruta al archivo de cookies original
const ORIGINAL_COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Inicializar Express
const app = express();
const port = 81;

// Función para manejar errores y limpiar archivos temporales
const handleError = (error, tempDir, reject) => {
  console.error('Error:', error.message);
  // Eliminar el directorio temporal si existe
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  reject(error);
};

/**
 * Función para descargar media usando yt-dlp-exec y fluent-ffmpeg
 * @param {string} url - URL del video de YouTube
 * @param {string} type - Tipo de descarga ('audio' o 'video')
 * @param {string} requestId - ID único para la solicitud
 * @returns {Promise<Buffer>} - Buffer con los datos del media descargado
 */
async function downloadMedia(url, type, requestId) {
  return new Promise(async (resolve, reject) => {
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

    const tempAudioPath = path.join(tempDir, `${requestId}_audio.m4a`);
    const tempVideoPath = path.join(tempDir, `${requestId}_video.mp4`);
    const outputFilePath = path.join(tempDir, `${requestId}_media.${type === 'audio' ? 'mp3' : 'mp4'}`);
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

    try {
      // Descargar audio usando yt-dlp-exec
      await ytDlp(url, {
        output: tempAudioPath,
        format: 'bestaudio',
        cookies: tempCookiesPath,
        userAgent: userAgent,
      });

      // Descargar video usando yt-dlp-exec (solo si se requiere video)
      if (type === 'video') {
        await ytDlp(url, {
          output: tempVideoPath,
          format: 'bestvideo',
          cookies: tempCookiesPath,
          userAgent: userAgent,
        });
      }

      // Procesar con fluent-ffmpeg
      if (type === 'video') {
        // Combinar audio y video
        fluentFfmpeg()
          .input(tempVideoPath)
          .input(tempAudioPath)
          .outputOptions('-c:v copy')
          .save(outputFilePath)
          .on('end', () => {
            fs.readFile(outputFilePath, (err, data) => {
              fs.rmSync(tempDir, { recursive: true, force: true });
              if (err) {
                return reject(err);
              }
              resolve(data);
            });
          })
          .on('error', (err) => {
            handleError(err, tempDir, reject);
          });
      } else {
        // Solo audio - convertir a mp3 si es necesario
        fluentFfmpeg(tempAudioPath)
          .outputOptions('-c:a libmp3lame')
          .save(outputFilePath)
          .on('end', () => {
            fs.readFile(outputFilePath, (err, data) => {
              fs.rmSync(tempDir, { recursive: true, force: true });
              if (err) {
                return reject(err);
              }
              resolve(data);
            });
          })
          .on('error', (err) => {
            handleError(err, tempDir, reject);
          });
      }
    } catch (error) {
      handleError(error, tempDir, reject);
    }
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
      userAgent: req.headers['user-agent'],
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
    const result = await Tiktok.Downloader(url, { version: 'v1' });
    console.log('TikTok Downloader result:', result);
    if (result.status === 'success') {
      const videoUrl = result.result.video.downloadAddr;
      console.log('Video URL:', videoUrl);
      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          Referer: 'https://www.tiktok.com/',
        },
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