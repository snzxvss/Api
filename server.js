import express from 'express';
import axios from 'axios';
import fs from 'fs';
import yts from 'yt-search';
import path from 'path';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import Tiktok from "@tobyg74/tiktok-api-dl";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Definir __dirname manualmente
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 80;

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

    const cookiesPath = path.join(__dirname, 'cookies.txt'); // Ruta al archivo de cookies
    const tempCookiesPath = path.join(__dirname, `${requestId}_cookies.txt`); // Ruta temporal al archivo de cookies

    // Copiar el archivo de cookies a una ubicación temporal
    fs.copyFileSync(cookiesPath, tempCookiesPath);

    const mediaBuffer = await downloadMedia(url, type, tempCookiesPath, requestId);

    // Eliminar el archivo de cookies temporal
    fs.unlink(tempCookiesPath, (err) => {
      if (err) console.error('Error deleting temp cookies file:', err);
    });

    res.set('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    res.send(mediaBuffer);
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).send('Error fetching media');
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

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

async function search(query, options = {}) {
  const search = await yts.search({ query, hl: 'es', gl: 'ES', ...options });
  return search.videos;
}

async function downloadMedia(url, type, cookiesPath, requestId) {
  return new Promise((resolve) => {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const outputFilePath = path.join(tempDir, `${requestId}_media.${type === 'audio' ? 'webm' : 'mp4'}`);
    const ytDlpPath = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
    const format = type === 'audio' ? 'bestaudio' : 'bestvideo[height<=480]+bestaudio';
    const mergeOutputFormat = type === 'audio' ? '' : '--merge-output-format mp4';
    const command = `"${ytDlpPath}" ${url} --no-playlist --output "${outputFilePath}" --format "${format}" ${mergeOutputFormat} --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" --add-header "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8" --add-header "Accept-Language: en-US,en;q=0.9" --add-header "Referer: https://www.youtube.com/" --cookies "${cookiesPath}" --ignore-errors --no-simulate --verbose`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`yt-dlp Error: ${stderr}`);
        resolve(Buffer.from('')); // Return an empty buffer on error
        return;
      }

      console.log(`yt-dlp Output: ${stdout}`);

      if (type === 'video') {
        const convertedFilePath = path.join(tempDir, `${requestId}_converted_media.mp4`);
        ffmpeg(outputFilePath)
          .output(convertedFilePath)
          .on('end', () => {
            fs.readFile(convertedFilePath, (err, data) => {
              if (err) {
                console.error('Error reading converted file:', err);
                resolve(Buffer.from('')); // Return an empty buffer on error
              } else {
                resolve(data);
                fs.unlink(outputFilePath, (unlinkErr) => {
                  if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
                });
                fs.unlink(convertedFilePath, (unlinkErr) => {
                  if (unlinkErr) console.error('Error deleting converted temp file:', unlinkErr);
                });
              }
            });
          })
          .on('error', (err) => {
            console.error('ffmpeg Error:', err);
            resolve(Buffer.from('')); // Return an empty buffer on error
          })
          .run();
      } else {
        const convertedFilePath = path.join(tempDir, `${requestId}_converted_media.mp3`);
        ffmpeg(outputFilePath)
          .output(convertedFilePath)
          .on('end', () => {
            fs.readFile(convertedFilePath, (err, data) => {
              if (err) {
                console.error('Error reading converted file:', err);
                resolve(Buffer.from('')); // Return an empty buffer on error
              } else {
                resolve(data);
                fs.unlink(outputFilePath, (unlinkErr) => {
                  if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
                });
                fs.unlink(convertedFilePath, (unlinkErr) => {
                  if (unlinkErr) console.error('Error deleting converted temp file:', unlinkErr);
                });
              }
            });
          })
          .on('error', (err) => {
            console.error('ffmpeg Error:', err);
            resolve(Buffer.from('')); // Return an empty buffer on error
          })
          .run();
      }
    });
  });
}